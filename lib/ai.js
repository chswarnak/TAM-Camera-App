'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * All AI goes through the Claude Code CLI in print mode (`claude -p`), so the
 * host needs no API key. Flags verified against Claude Code 2.1.x on macOS:
 *   -p <prompt>                 non-interactive, prints the answer and exits
 *   --model haiku               fastest model alias (override with AI_MODEL)
 *   --output-format text        plain text on stdout
 *   --no-session-persistence    don't litter ~/.claude with party sessions
 *   --setting-sources ""        skip user/project hooks and settings
 *   --strict-mcp-config         load no MCP servers (faster start)
 *   --tools ""                  no tools for text prompts
 *   --tools Read --add-dir DIR  vision: the model may only read the preview image
 * The process runs in a private temp folder so no project CLAUDE.md is loaded.
 */
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 20000);
const MAX_CONCURRENT = 3;
const WORK_DIR = path.join(os.tmpdir(), 'diwali-party-ai');

const cache = new Map();
const queue = [];
let running = 0;
let lastStatus = { ok: null, at: null, detail: 'not used yet' };

function claudeBin() {
  return process.env.CLAUDE_BIN || 'claude';
}

/** AI is on unless AI_ENABLED is set to false/0/no/off in .env. */
function isDisabled() {
  return /^(false|0|no|off)$/i.test(String(process.env.AI_ENABLED ?? '').trim());
}

/** Removes markdown decoration and wrapping quotes, line by line. */
function stripMarkdown(text) {
  return String(text)
    .split('\n')
    .map((line) => line
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
      .replace(/(\*\*|__|`)/g, '')
      .replace(/^\*(.+)\*$/, '$1')
      .replace(/^["“'](.+)["”']$/, '$1')
      .trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function runClaude(prompt, imagePath) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(WORK_DIR, { recursive: true });
    const args = [
      '-p', prompt,
      '--model', process.env.AI_MODEL || 'haiku',
      '--output-format', 'text',
      '--no-session-persistence',
      '--setting-sources', '',
      '--strict-mcp-config',
    ];
    if (imagePath) {
      args.push('--tools', 'Read', '--allowed-tools', 'Read', '--add-dir', path.dirname(imagePath));
    } else {
      args.push('--tools', '');
    }
    let child;
    try {
      child = spawn(claudeBin(), args, { cwd: WORK_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err);
      return;
    }
    let out = '';
    let errOut = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`claude -p timed out after ${TIMEOUT_MS} ms`));
    }, TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { errOut += d; });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`claude -p exited ${code}: ${errOut.trim().slice(0, 300)}`));
      else resolve(out);
    });
  });
}

function pump() {
  while (running < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    running += 1;
    runClaude(job.prompt, job.imagePath)
      .then(job.resolve, job.reject)
      .finally(() => {
        running -= 1;
        pump();
      });
  }
}

function enqueue(prompt, imagePath) {
  return new Promise((resolve, reject) => {
    queue.push({ prompt, imagePath, resolve, reject });
    pump();
  });
}

function fileHash(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

/**
 * Ask Claude for a short answer. Never throws: any failure (CLI missing, slow,
 * offline, empty answer, rejected by `validate`) returns `fallback`.
 * Results are cached by prompt (+ image content) so a repeat is free.
 *
 * @param {string} prompt
 * @param {string} fallback
 * @param {{ imagePath?: string, validate?: (text: string) => boolean }} [opts]
 * @returns {Promise<string>}
 */
async function ask(prompt, fallback, opts = {}) {
  if (isDisabled()) return fallback;
  let key = prompt;
  try {
    if (opts.imagePath) key += `#${fileHash(opts.imagePath)}`;
  } catch (err) {
    console.warn(`[ai] cannot read image ${opts.imagePath}: ${err.message}`);
    return fallback;
  }
  if (cache.has(key)) return cache.get(key);
  const started = Date.now();
  try {
    const text = stripMarkdown(await enqueue(prompt, opts.imagePath));
    if (!text || (opts.validate && !opts.validate(text))) {
      throw new Error(`unusable answer: ${JSON.stringify(text.slice(0, 120))}`);
    }
    cache.set(key, text);
    lastStatus = { ok: true, at: Date.now(), detail: `answered in ${Date.now() - started} ms` };
    return text;
  } catch (err) {
    lastStatus = { ok: false, at: Date.now(), detail: err.message };
    console.warn(`[ai] using fallback: ${err.message}`);
    return fallback;
  }
}

function status() {
  return { disabled: isDisabled(), queued: queue.length, running, ...lastStatus };
}

module.exports = { ask, stripMarkdown, status, WORK_DIR };
