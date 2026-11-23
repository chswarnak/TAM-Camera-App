/* TV audio: party playlist on an <audio> element plus a synthesised STOP buzzer.
 * Browsers block audio until a user gesture, so unlock() must run inside a click
 * or keydown handler; after that the page can play sound for the whole evening. */
(function () {
  'use strict';

  const BUZZER_SECONDS = 1;
  const BUZZER_FREQS = [110, 116];
  const BUZZER_PEAK_GAIN = 0.5;
  const CHIME_PEAK_GAIN = 0.25;
  const CHIME_SECONDS = 0.9;

  let audio;
  let audioCtx = null;
  let unlocked = false;
  let unlocking = null;
  let tracks = [];
  let trackIndex = null;
  let volume = 0.8;
  const listeners = new Set();

  function notify() {
    for (const fn of listeners) fn(unlocked);
  }

  function init(el) {
    audio = el;
    audio.addEventListener('ended', () => {
      advance();
      playCurrent();
    });
    audio.addEventListener('error', () => {
      console.error('[tv-audio] could not play track', audio.currentSrc);
    });
    // Chrome may already allow audio (e.g. a site the host uses often); if so, skip the button.
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) {
      audioCtx = new Ctx();
      if (audioCtx.state === 'running') {
        unlocked = true;
        notify();
      }
    }
  }

  /** Call from a user gesture. Resolves to true when audio is usable. */
  function unlock() {
    if (unlocked) return Promise.resolve(true);
    if (!unlocking) unlocking = doUnlock().finally(() => { unlocking = null; });
    return unlocking;
  }

  async function doUnlock() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!audioCtx && Ctx) audioCtx = new Ctx();
      if (audioCtx) await audioCtx.resume();
      if (!audio.src && tracks.length) loadCurrent();
      if (audio.src) {
        audio.muted = true;
        await audio.play();
        audio.pause();
        audio.muted = false;
      }
      unlocked = true;
    } catch (err) {
      console.error('[tv-audio] unlock failed', err);
      audio.muted = false;
      unlocked = Boolean(audioCtx && audioCtx.state === 'running');
    }
    notify();
    return unlocked;
  }

  function setTracks(list, startIndex) {
    const changed = list.map((t) => t.url).join('|') !== tracks.map((t) => t.url).join('|');
    tracks = list;
    if (trackIndex === null) trackIndex = Number(startIndex) || 0;
    if (changed && audio.paused) audio.removeAttribute('src');
  }

  function current() {
    return tracks.length ? tracks[((trackIndex % tracks.length) + tracks.length) % tracks.length] : null;
  }

  function loadCurrent() {
    const track = current();
    if (!track) return false;
    const url = new URL(track.url, location.href).href;
    if (audio.src !== url) {
      audio.src = url;
      audio.load();
    }
    return true;
  }

  function advance() {
    trackIndex = (trackIndex || 0) + 1;
    audio.removeAttribute('src');
  }

  function playCurrent() {
    if (!unlocked || !loadCurrent()) return false;
    audio.volume = volume;
    audio.play().catch((err) => console.error('[tv-audio] play failed', err));
    return true;
  }

  /** Resume the current track where it stopped. Returns false if audio is still locked. */
  function play(vol) {
    if (vol !== undefined) setVolume(vol);
    if (!unlocked) return false;
    return playCurrent();
  }

  function stop() {
    if (audio) audio.pause();
  }

  function next(keepPlaying) {
    advance();
    if (keepPlaying) playCurrent();
  }

  function setVolume(vol) {
    volume = Math.min(1, Math.max(0, Number(vol)));
    if (audio) audio.volume = volume;
  }

  /** One loud second of two detuned sawtooths: unmistakable over a noisy room. */
  function buzzer() {
    if (!audioCtx || audioCtx.state !== 'running') return;
    const t0 = audioCtx.currentTime;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(BUZZER_PEAK_GAIN, t0 + 0.02);
    gain.gain.setValueAtTime(BUZZER_PEAK_GAIN, t0 + BUZZER_SECONDS - 0.15);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + BUZZER_SECONDS);
    gain.connect(audioCtx.destination);
    for (const freq of BUZZER_FREQS) {
      const osc = audioCtx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(t0);
      osc.stop(t0 + BUZZER_SECONDS + 0.05);
    }
  }

  /** Short two-note bell (E6 then B6) for a guest arriving on the Who's here screen. */
  function chime() {
    if (!audioCtx || audioCtx.state !== 'running') return;
    const t0 = audioCtx.currentTime;
    [[1318.5, 0], [1975.5, 0.12]].forEach(([freq, delay]) => {
      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.0001, t0 + delay);
      gain.gain.exponentialRampToValueAtTime(CHIME_PEAK_GAIN, t0 + delay + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + CHIME_SECONDS);
      gain.connect(audioCtx.destination);
      const osc = audioCtx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(t0 + delay);
      osc.stop(t0 + delay + CHIME_SECONDS + 0.05);
    });
  }

  window.TvAudio = {
    init, unlock, setTracks, play, stop, next, setVolume, buzzer, chime,
    isUnlocked: () => unlocked,
    hasTrack: () => Boolean(current()),
    isPlaying: () => Boolean(audio && !audio.paused),
    onUnlockChange: (fn) => listeners.add(fn),
  };
})();
