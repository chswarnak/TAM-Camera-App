'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createSystemAudio } = require('../lib/system-audio');

/** Fake execFile: answers osascript calls from a table and records the scripts. */
function fakeRun(answers) {
  const scripts = [];
  const run = (cmd, args, opts, cb) => {
    const script = args[1];
    scripts.push(script);
    const a = answers(script);
    setImmediate(() => (a instanceof Error ? cb(a, '', a.message) : cb(null, `${a}\n`, '')));
  };
  return { run, scripts };
}

test('Spotify running: play and pause go to Spotify', async () => {
  const f = fakeRun((s) => (s.includes('is running') ? 'true' : ''));
  const audio = createSystemAudio({ run: f.run });
  assert.equal((await audio.play()).action, 'Spotify play');
  assert.equal((await audio.pause()).action, 'Spotify pause');
  assert.equal((await audio.next()).action, 'Spotify next track');
  assert.ok(f.scripts.includes('tell application "Spotify" to pause'));
  assert.ok(!f.scripts.some((s) => s.includes('muted')), 'never mutes when Spotify works');
});

test('Spotify not running: mute on stop, unmute on start', async () => {
  const f = fakeRun((s) => (s.includes('is running') ? 'false' : ''));
  const audio = createSystemAudio({ run: f.run });
  assert.equal((await audio.pause()).action, 'mute Mac');
  assert.equal((await audio.play()).action, 'unmute Mac');
  assert.deepEqual(f.scripts.filter((s) => s.includes('muted')), ['set volume output muted true', 'set volume output muted false', 'set volume output muted false']);
  assert.equal((await audio.next()).ok, false);
  await audio.pause();
  assert.equal((await audio.release()).action, 'unmute Mac', 'ending the game undoes our mute');
  assert.equal((await audio.release()).action, 'nothing to restore');
});

test('a mute we applied is undone when Spotify takes over, and failures never throw', async () => {
  let spotify = 'false';
  const f = fakeRun((s) => (s.includes('is running') ? spotify : ''));
  const audio = createSystemAudio({ run: f.run });
  await audio.pause();
  spotify = 'true';
  assert.equal((await audio.play()).action, 'Spotify play');
  assert.ok(f.scripts.includes('set volume output muted false'));
  const broken = createSystemAudio({ run: fakeRun(() => new Error('osascript: not allowed')).run });
  const r = await broken.pause();
  assert.equal(r.ok, false);
  assert.match(r.detail, /not allowed/);
});

test('a Spotify that does not answer (pending permission) falls back to mute within the deadline', async () => {
  const run = (cmd, args, opts, cb) => {
    if (args[1].includes('is running')) setImmediate(() => cb(null, 'true\n', ''));
    else if (args[1].startsWith('tell application "Spotify"')) setTimeout(() => cb(null, '', ''), 5000).unref();
    else setImmediate(() => cb(null, '\n', ''));
  };
  const audio = createSystemAudio({ run, spotifyDeadlineMs: 100 });
  const started = Date.now();
  const r = await audio.pause();
  assert.equal(r.action, 'mute Mac');
  assert.ok(Date.now() - started < 1000, 'stop is not held up by Spotify');
});
