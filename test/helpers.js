'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Party } = require('../lib/party');
const { Store } = require('../lib/store');

const ROOT = path.join(__dirname, '..');
const SEED = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'seed.json'), 'utf8'));
const SAMPLE_JPEG = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-preview-600.jpg'));

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diwali-test-'));
  fs.mkdirSync(path.join(dir, 'photos'));
  return dir;
}

/** A hub that records what would have been sent. */
function fakeHub() {
  return { changes: 0, fxList: [], guestFx: [], changed() { this.changes += 1; }, fx(data) { this.fxList.push(data); }, toGuest(id, data) { this.guestFx.push({ id, data }); } };
}

/** An AI stub that answers instantly (or returns the fallback). */
function fakeAi(answer = null) {
  return { calls: [], ask(prompt, fallback) { this.calls.push(prompt); return Promise.resolve(answer ?? fallback); } };
}

/** Records system-audio calls instead of running osascript. */
function fakeSystemAudio() {
  const calls = [];
  const op = (action) => () => { calls.push(action); return Promise.resolve({ ok: true, action, detail: '' }); };
  return { calls, play: op('play'), pause: op('pause'), next: op('next'), release: op('release') };
}

function makeParty({ dataDir = tempDir(), ai = fakeAi(), now, systemAudio = fakeSystemAudio(), features } = {}) {
  const store = new Store({ dataDir, seed: SEED });
  const hub = fakeHub();
  const party = new Party({ store, hub, ai, seed: SEED, photoDir: path.join(dataDir, 'photos'), previewDir: path.join(dataDir, 'previews'), systemAudio, features, now });
  return { party, store, hub, ai, dataDir, systemAudio };
}

const about = (over = {}) => ({ funFact: 'I once ran a marathon', talent: 'Juggling', sweet: 'jalebi', superpower: 'teleport', arrival: 'first', ...over });

module.exports = { SEED, SAMPLE_JPEG, tempDir, makeParty, fakeSystemAudio, about, ROOT };
