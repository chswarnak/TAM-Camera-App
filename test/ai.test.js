'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { tempDir } = require('./helpers');

/** Writes a fake `claude` CLI so the wiring is tested without network or login. */
function fakeCli(body) {
  const file = path.join(tempDir(), 'claude');
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
}

function freshAi(env) {
  Object.assign(process.env, env);
  delete require.cache[require.resolve('../lib/ai')];
  return require('../lib/ai');
}

test('stripMarkdown removes decoration but keeps lines', () => {
  const { stripMarkdown } = freshAi({});
  assert.equal(stripMarkdown('**Chief Jalebi Officer**'), 'Chief Jalebi Officer');
  assert.equal(stripMarkdown('1. "Lit, literally"\n- `Sparkle season`\n\n# Hi'), 'Lit, literally\nSparkle season\nHi');
});

test('returns the CLI answer, passes print-mode flags, and caches repeats', async () => {
  const log = path.join(tempDir(), 'args.txt');
  const ai = freshAi({ CLAUDE_BIN: fakeCli(`echo "$@" >> ${log}\necho "**Captain Kaju Katli**"`), AI_TIMEOUT_MS: '5000', AI_ENABLED: '' });
  assert.equal(await ai.ask('title please', 'fallback'), 'Captain Kaju Katli');
  assert.equal(await ai.ask('title please', 'fallback'), 'Captain Kaju Katli');
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
  assert.equal(calls.length, 1, 'second ask should be served from cache');
  assert.match(calls[0], /-p title please --model haiku --output-format text --no-session-persistence/);
});

test('falls back when the CLI is missing, fails, is slow, or answers badly', async () => {
  let ai = freshAi({ CLAUDE_BIN: '/nonexistent/claude', AI_TIMEOUT_MS: '5000' });
  assert.equal(await ai.ask('a', 'fb-missing'), 'fb-missing');
  ai = freshAi({ CLAUDE_BIN: fakeCli('echo boom >&2; exit 3') });
  assert.equal(await ai.ask('b', 'fb-error'), 'fb-error');
  ai = freshAi({ CLAUDE_BIN: fakeCli('sleep 5; echo late'), AI_TIMEOUT_MS: '300' });
  const started = Date.now();
  assert.equal(await ai.ask('c', 'fb-slow'), 'fb-slow');
  assert.ok(Date.now() - started < 2000, 'timeout must cut the call short');
  ai = freshAi({ CLAUDE_BIN: fakeCli('echo "way too many words in this answer for a title"'), AI_TIMEOUT_MS: '5000' });
  assert.equal(await ai.ask('d', 'fb-invalid', { validate: (t) => t.split(' ').length <= 5 }), 'fb-invalid');
  ai = freshAi({ AI_ENABLED: 'false' });
  assert.equal(await ai.ask('e', 'fb-off'), 'fb-off');
  freshAi({ AI_ENABLED: '', CLAUDE_BIN: '', AI_TIMEOUT_MS: '' });
});
