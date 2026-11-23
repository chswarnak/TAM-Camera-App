'use strict';

const { execFile } = require('node:child_process');

/**
 * "System audio" mode for the floor games: instead of the TV page's MP3
 * playlist, control whatever the Mac is playing. Spotify is driven over
 * AppleScript when it is running; otherwise we unmute/mute the Mac's output.
 * Every call resolves to { ok, action, detail } and never throws, so a stop
 * can never be blocked by a failing osascript.
 */
const OSASCRIPT_TIMEOUT_MS = 5000;
// A stop must be near-instant. If Spotify hasn't confirmed by then (busy, or macOS is still
// asking for Automation permission), fall back to muting rather than letting music run on.
const SPOTIFY_DEADLINE_MS = 1000;

/** Resolves like `promise`, or with `fallback` once `ms` have passed. */
function within(promise, ms, fallback) {
  let timer;
  return Promise.race([promise, new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); })])
    .finally(() => clearTimeout(timer));
}

function osascript(script, run = execFile) {
  return new Promise((resolve) => {
    run('osascript', ['-e', script], { timeout: OSASCRIPT_TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, out: '', detail: (stderr || err.message).trim().slice(0, 200) });
      else resolve({ ok: true, out: String(stdout).trim(), detail: '' });
    });
  });
}

function createSystemAudio({ run = execFile, spotifyDeadlineMs = SPOTIFY_DEADLINE_MS } = {}) {
  const exec = (script) => osascript(script, run);
  let mutedByUs = false;

  async function spotifyRunning() {
    // `application "X" is running` does not launch the app, unlike `tell application`.
    const r = await exec('application "Spotify" is running');
    return r.ok && r.out === 'true';
  }

  const LATE = { ok: false, out: '', detail: `Spotify did not answer within ${spotifyDeadlineMs} ms (check System Settings → Privacy & Security → Automation)` };
  const spotify = (command) => within(exec(`tell application "Spotify" to ${command}`), spotifyDeadlineMs, LATE);

  function report(action, result) {
    if (!result.ok) console.warn(`[system-audio] ${action} failed: ${result.detail}`);
    return { ok: result.ok, action, detail: result.detail };
  }

  return {
    /** Start Round: resume Spotify, or unmute the Mac. */
    async play() {
      if (mutedByUs) {
        const u = await exec('set volume output muted false');
        if (u.ok) mutedByUs = false;
      }
      if (await spotifyRunning()) {
        const r = await spotify('play');
        if (r.ok) return report('Spotify play', r);
        console.warn(`[system-audio] Spotify play failed, unmuting instead: ${r.detail}`);
      }
      const r = await exec('set volume output muted false');
      if (r.ok) mutedByUs = false;
      return report('unmute Mac', r);
    },

    /** Stop: pause Spotify; fall back to muting the Mac if Spotify isn't running or refuses. */
    async pause() {
      if (await spotifyRunning()) {
        const r = await spotify('pause');
        if (r.ok) return report('Spotify pause', r);
        console.warn(`[system-audio] Spotify pause failed, muting instead: ${r.detail}`);
      }
      const r = await exec('set volume output muted true');
      if (r.ok) mutedByUs = true;
      return report('mute Mac', r);
    },

    /** End of the game: undo a mute we applied, so the party isn't left silent. */
    async release() {
      if (!mutedByUs) return { ok: true, action: 'nothing to restore', detail: '' };
      const r = await exec('set volume output muted false');
      if (r.ok) mutedByUs = false;
      return report('unmute Mac', r);
    },

    /** Next Track: only possible with Spotify. */
    async next() {
      if (!(await spotifyRunning())) return { ok: false, action: 'next track', detail: 'Spotify is not running' };
      return report('Spotify next track', await spotify('next track'));
    },
  };
}

module.exports = { createSystemAudio };
