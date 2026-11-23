'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { emptyCursor } = require('./slideshow');

const TEAM_COLORS = ['#D4A017', '#E0457B', '#2E9E5B', '#F07F1A', '#3A7BD5', '#8E44AD'];

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

/**
 * Builds a fresh event state from the seed file. Every question gets an id so
 * the dashboard can edit, reorder and delete it.
 */
function initialState(seed) {
  const withIds = (list, prefix) => list.map((q) => ({ id: newId(prefix), ...q }));
  return {
    version: 1,
    settings: {
      partyName: seed.party.name,
      hosts: [...seed.party.hosts],
      approvalMode: false,
      commentator: true,
    },
    teams: seed.teams.map((t, i) => ({ id: newId('team'), name: t.name, color: t.color || TEAM_COLORS[i] })),
    guests: {},
    photos: [],
    questions: {
      quiz: withIds(seed.quiz, 'q'),
      poll: withIds(seed.polls, 'p'),
      guessWho: withIds(seed.guessWho.map((text) => ({ text, source: 'host', authorId: null })), 'g'),
      couples: withIds(seed.couplesQuestions.map((text) => ({ text })), 'c'),
    },
    pendingAiQuestions: [],
    round: null,
    roundHistory: [],
    ledger: [],
    shoutouts: [],
    couples: { pairs: [], session: null },
    physical: {
      game: null, status: 'idle', round: 0, remaining: 0, randomStop: true,
      volume: 0.8, trackIndex: 0, stopAt: null, stoppedAt: null,
    },
    tv: { pinned: null, paused: false },
    slideshow: emptyCursor(),
    trophy: null,
    commentary: null,
  };
}

/**
 * Owns data/state.json. Writes are atomic (temp file + rename) and coalesced
 * so a burst of quiz submissions costs one disk write.
 */
class Store {
  constructor({ dataDir, seed }) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'state.json');
    this.seed = seed;
    this.saveTimer = null;
    this.state = this.load();
  }

  load() {
    if (!fs.existsSync(this.file)) {
      const fresh = initialState(this.seed);
      this.writeNow(fresh);
      return fresh;
    }
    const raw = fs.readFileSync(this.file, 'utf8');
    try {
      return JSON.parse(raw);
    } catch (err) {
      const backup = `${this.file}.corrupt-${Date.now()}`;
      fs.copyFileSync(this.file, backup);
      throw new Error(`data/state.json is not valid JSON (copied to ${backup}): ${err.message}`);
    }
  }

  writeNow(state = this.state) {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
    fs.renameSync(tmp, this.file);
  }

  /** Schedules an atomic write within 100 ms. */
  save() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.writeNow();
    }, 100);
  }

  flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.writeNow();
  }

  reset() {
    this.state = initialState(this.seed);
    this.flush();
  }
}

module.exports = { Store, initialState, newId, TEAM_COLORS };
