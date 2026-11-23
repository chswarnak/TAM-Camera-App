'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const slideshow = require('./slideshow');
const { newId, TEAM_COLORS } = require('./store');

const MAX_TEAMS = 6;
const SHOUTOUT_LIMIT_PER_HOUR = 10;
const QUIZ_GRACE_MS = 1500;
const BEST_PHOTO_BONUS = 20;
const ROUND_POINTS = 10;
const AUDIO_MODES = ['playlist', 'system'];
const RANDOM_STOP_MIN_MS = 8000;
const RANDOM_STOP_MAX_MS = 25000;

/** Thrown for anything a client got wrong; the router turns it into a 4xx. */
class PartyError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'PartyError';
    this.status = status;
  }
}

const clean = (value, max = 80) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

/**
 * All party rules live here. Routes call these methods; each mutating method
 * saves state and notifies SSE clients. AI calls never block a method: they
 * run in the background and patch state when they land.
 */
class Party {
  constructor({ store, hub, ai, seed, photoDir, previewDir, systemAudio, features = { backdrop: false }, now = () => Date.now() }) {
    this.store = store;
    this.hub = hub;
    this.ai = ai;
    this.seed = seed;
    this.photoDir = photoDir;
    this.previewDir = previewDir;
    this.now = now;
    this.timers = { round: null, physical: null };
    this.commentIndex = 0;
    this.tvStatus = { lastSeen: 0, audioUnlocked: false };
    this.systemAudio = systemAudio;
    this.features = features;
    this.systemAudioStatus = null;
    this.recoverAfterRestart();
  }

  get state() {
    return this.store.state;
  }

  commit() {
    this.store.save();
    this.hub.changed();
  }

  /** Timers do not survive a restart, so settle anything that was mid-flight. */
  recoverAfterRestart() {
    const { round, physical } = this.state;
    if (round && round.status === 'open' && round.endsAt) {
      if (round.endsAt <= this.now()) round.status = 'closed';
      else this.scheduleRoundClose(round);
    }
    if (!AUDIO_MODES.includes(physical.audioMode)) physical.audioMode = 'playlist';
    if (!this.state.slideshow) this.state.slideshow = slideshow.emptyCursor();
    if (physical.status === 'playing') {
      physical.status = 'stopped';
      physical.stopAt = null;
    }
  }

  // ---------------------------------------------------------------- guests

  join({ id, nickname, about = {} }) {
    const name = clean(nickname, 24);
    if (!name) throw new PartyError('Please type a nickname');
    const card = this.cleanAbout(about);
    let guest = id ? this.state.guests[id] : null;
    if (!guest) {
      const guestId = /^[a-z0-9_-]{8,64}$/i.test(id || '') ? id : newId('guest');
      guest = { id: guestId, nickname: name, teamId: this.smallestTeamId(), about: card, title: '', joinedAt: this.now() };
      this.state.guests[guest.id] = guest;
    } else {
      guest.nickname = name;
      guest.about = card;
    }
    guest.title = this.fallbackTitle(card);
    guest.titleSource = 'preset';
    this.syncGuessWhoFromCard(guest);
    this.commit();
    this.generateTitle(guest.id);
    return guest;
  }

  cleanAbout(about) {
    const opts = this.seed.aboutOptions;
    const oneOf = (value, list) => (list.includes(value) ? value : list[0]);
    return {
      company: clean(about.company, 60),
      funFact: clean(about.funFact, 140),
      talent: clean(about.talent, 100),
      sweet: oneOf(about.sweet, opts.sweet),
      superpower: oneOf(about.superpower, opts.superpower),
      arrival: oneOf(about.arrival, opts.arrival),
    };
  }

  guest(id) {
    const guest = this.state.guests[id];
    if (!guest) throw new PartyError('Please join the party first', 401);
    return guest;
  }

  smallestTeamId() {
    const counts = new Map(this.state.teams.map((t) => [t.id, 0]));
    for (const g of Object.values(this.state.guests)) {
      if (counts.has(g.teamId)) counts.set(g.teamId, counts.get(g.teamId) + 1);
    }
    const min = Math.min(...counts.values());
    return pick([...counts].filter(([, n]) => n === min).map(([teamId]) => teamId));
  }

  fallbackTitle(card) {
    return this.seed.titles[card.sweet]?.[card.arrival] || 'Diwali Superstar';
  }

  generateTitle(guestId) {
    const guest = this.state.guests[guestId];
    const card = guest.about;
    const nick = guest.nickname.replace(/"/g, '');
    const prompt = [
      `Invent a playful party title of at most five words for a guest nicknamed "${nick}" at a family Diwali party.`,
      `Favourite Diwali sweet: ${card.sweet}. Dream superpower: ${card.superpower}. Arrives at parties: ${card.arrival}.`,
      'Example style: Chief Jalebi Officer. Family-friendly. Do not include the nickname or any other name in the title.',
      'Answer with the title only, on one line, no quotes.',
    ].join(' ');
    const fallback = guest.title;
    this.ai.ask(prompt, fallback, { validate: (t) => !t.includes('\n') && t.length <= 48 && t.split(' ').length <= 7 })
      .then((title) => {
        const current = this.state.guests[guestId];
        if (!current || title === fallback) return;
        current.title = title;
        current.titleSource = 'ai';
        this.commit();
        this.hub.toGuest(guestId, { type: 'title', title });
      });
  }

  syncGuessWhoFromCard(guest) {
    const list = this.state.questions.guessWho;
    const entries = [
      ['funFact', guest.about.funFact && `Fun fact: ${guest.about.funFact}`],
      ['talent', guest.about.talent && `Secret talent: ${guest.about.talent}`],
    ];
    for (const [field, text] of entries) {
      const existing = list.find((q) => q.source === 'card' && q.authorId === guest.id && q.field === field);
      if (text && existing) existing.text = text;
      else if (text) list.push({ id: newId('g'), text, source: 'card', field, authorId: guest.id });
      else if (existing) list.splice(list.indexOf(existing), 1);
    }
  }

  // ---------------------------------------------------------------- teams

  teamTotals() {
    const totals = Object.fromEntries(this.state.teams.map((t) => [t.id, 0]));
    for (const entry of this.state.ledger) {
      if (entry.teamId in totals) totals[entry.teamId] += entry.points;
    }
    return totals;
  }

  award(teamId, points, reason, guestId = null) {
    if (!teamId || !points) return;
    this.state.ledger.push({ teamId, guestId, points, reason, at: this.now() });
  }

  addTeam(name) {
    if (this.state.teams.length >= MAX_TEAMS) throw new PartyError(`At most ${MAX_TEAMS} teams`);
    const used = new Set(this.state.teams.map((t) => t.color));
    const color = TEAM_COLORS.find((c) => !used.has(c)) || TEAM_COLORS[0];
    this.state.teams.push({ id: newId('team'), name: clean(name, 20) || `Team ${this.state.teams.length + 1}`, color });
    this.commit();
  }

  renameTeam(teamId, name, color) {
    const team = this.team(teamId);
    if (clean(name, 20)) team.name = clean(name, 20);
    if (/^#[0-9a-f]{6}$/i.test(color || '')) team.color = color;
    this.commit();
  }

  removeTeam(teamId) {
    this.team(teamId);
    if (this.state.teams.length <= 2) throw new PartyError('Keep at least two teams');
    if (Object.values(this.state.guests).some((g) => g.teamId === teamId)) {
      throw new PartyError('Move everyone off this team first');
    }
    this.state.teams = this.state.teams.filter((t) => t.id !== teamId);
    this.commit();
  }

  team(teamId) {
    const team = this.state.teams.find((t) => t.id === teamId);
    if (!team) throw new PartyError('No such team', 404);
    return team;
  }

  moveGuest(guestId, teamId) {
    this.team(teamId);
    this.guest(guestId).teamId = teamId;
    this.commit();
  }

  removeGuest(guestId) {
    this.guest(guestId);
    delete this.state.guests[guestId];
    this.state.questions.guessWho = this.state.questions.guessWho.filter((q) => !(q.source === 'card' && q.authorId === guestId));
    this.commit();
  }

  adjustScore(teamId, points) {
    this.team(teamId);
    const n = Math.round(Number(points));
    if (!Number.isFinite(n) || n === 0) throw new PartyError('Enter a number of points');
    this.award(teamId, n, 'host adjustment');
    this.commit();
  }

  // ---------------------------------------------------------------- photos

  addPhoto(guestId, buffer, caption) {
    const guest = this.guest(guestId);
    if (!buffer || buffer.length < 100 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
      throw new PartyError('That upload is not a JPEG photo');
    }
    const id = newId('photo');
    const file = `${id}.jpg`;
    fs.writeFileSync(path.join(this.photoDir, file), buffer);
    const photo = {
      id, guestId, file, caption: clean(caption, 80), autoCaption: false,
      status: this.state.settings.approvalMode ? 'pending' : 'live',
      hearts: [], createdAt: this.now(),
    };
    this.state.photos.push(photo);
    this.commit();
    if (photo.status === 'live') this.announcePhoto(photo, guest);
    if (!photo.caption) this.autoCaption(photo.id);
    return photo;
  }

  announcePhoto(photo, guest = this.state.guests[photo.guestId]) {
    slideshow.queueJump(this.state.slideshow, photo.id);
    this.store.save();
    this.hub.fx({ type: 'newPhoto', photoId: photo.id, nickname: guest?.nickname || 'A guest' }, ['tv', 'host']);
  }

  photo(photoId) {
    const photo = this.state.photos.find((p) => p.id === photoId);
    if (!photo) throw new PartyError('No such photo', 404);
    return photo;
  }

  setPhotoStatus(photoId, status) {
    if (!['live', 'hidden', 'pending'].includes(status)) throw new PartyError('Bad status');
    const photo = this.photo(photoId);
    const wasLive = photo.status === 'live';
    photo.status = status;
    this.commit();
    if (status === 'live' && !wasLive) this.announcePhoto(photo);
  }

  deletePhoto(photoId) {
    const photo = this.photo(photoId);
    this.state.photos = this.state.photos.filter((p) => p !== photo);
    fs.rmSync(path.join(this.photoDir, photo.file), { force: true });
    this.commit();
  }

  heart(guestId, photoId) {
    this.guest(guestId);
    const photo = this.photo(photoId);
    if (photo.status !== 'live') throw new PartyError('That photo is not on the wall', 404);
    if (photo.hearts.includes(guestId)) return { hearted: true, hearts: photo.hearts.length };
    photo.hearts.push(guestId);
    this.commit();
    return { hearted: true, hearts: photo.hearts.length };
  }

  editCaption(guestId, photoId, caption) {
    const photo = this.photo(photoId);
    if (photo.guestId !== guestId) throw new PartyError('Only the person who shared it can edit the caption', 403);
    photo.caption = clean(caption, 80);
    photo.autoCaption = false;
    this.commit();
  }

  captionPrompt(imagePath, { frame, props } = {}) {
    const decor = [
      frame ? `It has the "${clean(frame, 40)}" frame` : '',
      props?.length ? `stickers: ${props.map((p) => clean(p, 30)).join(', ')}` : '',
    ].filter(Boolean).join('; ');
    return [
      `Look at the photo at ${imagePath}. It was taken at a family Diwali party${decor ? ` (${decor})` : ''}.`,
      'Write three different funny, warm, family-friendly Diwali captions, each under 8 words,',
      'that react to what is visible: props, poses, how many people, the mood.',
      'Never guess names or ages and never comment on anyone\'s appearance or body.',
      'Reply with exactly three lines containing only the captions.',
    ].join(' ');
  }

  parseCaptions(text) {
    return text.split('\n').map((c) => clean(c, 60)).filter(Boolean).slice(0, 3);
  }

  /**
   * Starts a caption suggestion. Returns presets immediately; the AI result
   * is pushed to the guest's phone as an `fx` event with the same requestId.
   */
  suggestCaptions(guestId, buffer, decor) {
    this.guest(guestId);
    if (!buffer || buffer[0] !== 0xff || buffer[1] !== 0xd8) throw new PartyError('Preview must be a JPEG');
    const requestId = newId('cap');
    fs.mkdirSync(this.previewDir, { recursive: true });
    const file = path.join(this.previewDir, `${requestId}.jpg`);
    fs.writeFileSync(file, buffer);
    this.ai.ask(this.captionPrompt(file, decor), '', { imagePath: file })
      .then((text) => {
        const captions = this.parseCaptions(text);
        this.hub.toGuest(guestId, { type: 'captions', requestId, captions, source: captions.length ? 'ai' : 'preset' });
      })
      .finally(() => fs.rmSync(file, { force: true }));
    return { requestId, presets: this.seed.captions };
  }

  autoCaption(photoId) {
    const photo = this.state.photos.find((p) => p.id === photoId);
    if (!photo) return;
    const fallback = pick(this.seed.captions);
    this.ai.ask(this.captionPrompt(path.join(this.photoDir, photo.file)), fallback, { imagePath: path.join(this.photoDir, photo.file) })
      .then((text) => {
        const current = this.state.photos.find((p) => p.id === photoId);
        if (!current || current.caption) return;
        current.caption = this.parseCaptions(text)[0] || fallback;
        current.autoCaption = true;
        this.commit();
      });
  }

  awardBestPhoto() {
    const candidates = this.state.photos.filter((p) => p.status === 'live');
    if (!candidates.length) throw new PartyError('No photos on the wall yet');
    const best = candidates.reduce((a, b) => (b.hearts.length > a.hearts.length ? b : a));
    const guest = this.state.guests[best.guestId];
    if (guest) this.award(guest.teamId, BEST_PHOTO_BONUS, 'Best Photo', guest.id);
    this.showTrophy({
      kind: 'bestPhoto', title: 'Best Photo', name: guest?.nickname || 'Mystery guest',
      subtitle: `${best.hearts.length} ❤️ · +${BEST_PHOTO_BONUS} points`, teamId: guest?.teamId || null,
      guestTitle: guest?.title || '', photoId: best.id,
    });
    return best;
  }

  // ---------------------------------------------------------------- shout-outs

  shoutout(fromId, toId, stickerId) {
    const from = this.guest(fromId);
    const to = this.state.guests[toId];
    if (!to) throw new PartyError('Pick someone from the list');
    if (toId === fromId) throw new PartyError('Shout-outs are for someone else!');
    const sticker = this.seed.stickers.find((s) => s.id === stickerId);
    if (!sticker) throw new PartyError('Pick a sticker');
    if (this.shoutoutsLeft(fromId) <= 0) throw new PartyError('That is 10 shout-outs this hour. Take a breather and try again soon!', 429);
    const entry = { id: newId('so'), from: from.id, to: to.id, sticker: sticker.id, at: this.now() };
    this.state.shoutouts.push(entry);
    if (this.state.shoutouts.length > 300) this.state.shoutouts.splice(0, this.state.shoutouts.length - 300);
    this.commit();
    this.hub.fx({ type: 'shoutout', from: from.nickname, to: to.nickname, emoji: sticker.emoji, text: sticker.text }, ['tv', 'host']);
    return entry;
  }

  shoutoutsLeft(guestId) {
    const since = this.now() - 3600 * 1000;
    const used = this.state.shoutouts.filter((s) => s.from === guestId && s.at > since).length;
    return Math.max(0, SHOUTOUT_LIMIT_PER_HOUR - used);
  }

  // ---------------------------------------------------------------- rounds

  question(type, questionId) {
    const list = this.state.questions[type];
    if (!list) throw new PartyError('Unknown question type');
    const q = list.find((x) => x.id === questionId);
    if (!q) throw new PartyError('No such question', 404);
    return q;
  }

  launchRound(type, questionId) {
    if (!['poll', 'quiz', 'guessWho'].includes(type)) throw new PartyError('Unknown round type');
    const q = this.question(type, questionId);
    if (type === 'guessWho' && Object.keys(this.state.guests).length < 2) {
      throw new PartyError('Guess Who needs at least two guests');
    }
    this.archiveRound();
    const round = {
      id: newId('r'), type, questionId: q.id, status: 'open', openedAt: this.now(),
      endsAt: null, seconds: type === 'quiz' ? q.seconds || 20 : null,
      submissions: {}, results: null, revealedAt: null,
      number: this.state.roundHistory.filter((r) => r.type === type).length + 1,
    };
    this.state.round = round;
    this.state.trophy = null;
    if (type === 'quiz') this.startTimer(round.seconds, false);
    this.commit();
    this.hub.fx({ type: 'roundOpen', roundType: type }, ['guest', 'tv']);
    return round;
  }

  /** Launches the next question of the current (or given) type that has not been asked yet. */
  nextQuestion(type) {
    const kind = type || this.state.round?.type || 'quiz';
    const asked = new Set([...this.state.roundHistory, this.state.round].filter(Boolean).filter((r) => r.type === kind).map((r) => r.questionId));
    const list = this.state.questions[kind] || [];
    const next = list.find((q) => !asked.has(q.id)) || list[0];
    if (!next) throw new PartyError('No questions of that type yet');
    return this.launchRound(kind, next.id);
  }

  currentRound() {
    const round = this.state.round;
    if (!round) throw new PartyError('No round is running');
    return round;
  }

  startTimer(seconds, commit = true) {
    const round = this.currentRound();
    if (round.status !== 'open') throw new PartyError('Round is not open');
    const secs = Math.min(120, Math.max(5, Number(seconds) || round.seconds || 20));
    round.seconds = secs;
    round.endsAt = this.now() + secs * 1000;
    this.scheduleRoundClose(round);
    if (commit) this.commit();
  }

  scheduleRoundClose(round) {
    clearTimeout(this.timers.round);
    this.timers.round = setTimeout(() => {
      if (this.state.round?.id === round.id && round.status === 'open') {
        round.status = 'closed';
        this.commit();
      }
    }, Math.max(0, round.endsAt - this.now() + QUIZ_GRACE_MS));
    this.timers.round.unref?.();
  }

  closeRound() {
    const round = this.currentRound();
    if (round.status === 'open') round.status = 'closed';
    clearTimeout(this.timers.round);
    this.commit();
  }

  submit(guestId, roundId, answer) {
    const guest = this.guest(guestId);
    const round = this.state.round;
    if (!round || round.id !== roundId) throw new PartyError('That question has finished', 409);
    if (round.status !== 'open' || (round.endsAt && this.now() > round.endsAt + QUIZ_GRACE_MS)) {
      throw new PartyError('Time is up for this one!', 409);
    }
    if (round.submissions[guest.id] !== undefined) throw new PartyError('You already answered', 409);
    const q = this.question(round.type, round.questionId);
    if (this.usesGuestOptions(round.type, q)) {
      if (!this.state.guests[answer]) throw new PartyError('Pick someone from the list');
      if (round.type === 'guessWho' && q.authorId === guest.id) throw new PartyError('No voting on your own fact!', 403);
    } else if (!Number.isInteger(answer) || answer < 0 || answer >= q.options.length) {
      throw new PartyError('Pick one of the answers');
    }
    round.submissions[guest.id] = answer;
    this.commit();
    return { ok: true };
  }

  usesGuestOptions(type, q) {
    return type === 'guessWho' || (type === 'poll' && q.mostLikely);
  }

  revealRound() {
    const round = this.currentRound();
    if (round.status === 'revealed') return round;
    clearTimeout(this.timers.round);
    const q = this.question(round.type, round.questionId);
    const guests = this.state.guests;
    const tally = new Map();
    for (const answer of Object.values(round.submissions)) tally.set(answer, (tally.get(answer) || 0) + 1);
    const teamCorrect = Object.fromEntries(this.state.teams.map((t) => [t.id, 0]));
    let correctAnswer = null;
    if (round.type === 'quiz') correctAnswer = q.answer;
    if (round.type === 'guessWho' && q.authorId && guests[q.authorId]) correctAnswer = q.authorId;
    if (correctAnswer !== null && round.type !== 'poll') {
      for (const [guestId, answer] of Object.entries(round.submissions)) {
        const g = guests[guestId];
        if (g && answer === correctAnswer) {
          teamCorrect[g.teamId] = (teamCorrect[g.teamId] || 0) + 1;
          this.award(g.teamId, ROUND_POINTS, `${round.type} correct`, g.id);
        }
      }
    }
    let options;
    if (this.usesGuestOptions(round.type, q)) {
      options = [...tally].map(([id, votes]) => ({ id, label: guests[id]?.nickname || 'Someone', teamId: guests[id]?.teamId || null, votes }))
        .sort((a, b) => b.votes - a.votes).slice(0, 8);
    } else {
      options = q.options.map((label, i) => ({ id: i, label, votes: tally.get(i) || 0 }));
    }
    const author = round.type === 'guessWho' && q.authorId ? guests[q.authorId] : null;
    round.results = {
      options, correct: correctAnswer, teamCorrect,
      author: author ? { id: author.id, nickname: author.nickname, title: author.title, teamId: author.teamId } : null,
      total: Object.keys(round.submissions).length,
    };
    round.status = 'revealed';
    round.revealedAt = this.now();
    this.commit();
    this.hub.fx({ type: 'reveal', roundType: round.type, confetti: round.type !== 'poll' }, ['guest', 'tv']);
    if (round.type !== 'poll') this.comment();
    return round;
  }

  archiveRound() {
    const round = this.state.round;
    if (!round) return;
    clearTimeout(this.timers.round);
    this.state.roundHistory.push(round);
    this.state.round = null;
  }

  endRound() {
    this.archiveRound();
    this.commit();
  }

  // ---------------------------------------------------------------- couples quiz

  addPair(aId, bId) {
    if (aId === bId) throw new PartyError('Pick two different people');
    this.guest(aId);
    this.guest(bId);
    const taken = new Set(this.state.couples.pairs.flatMap((p) => [p.a, p.b]));
    if (taken.has(aId) || taken.has(bId)) throw new PartyError('One of them is already in a couple');
    this.state.couples.pairs.push({ id: newId('pair'), a: aId, b: bId });
    this.commit();
  }

  removePair(pairId) {
    this.state.couples.pairs = this.state.couples.pairs.filter((p) => p.id !== pairId);
    this.commit();
  }

  startCouples(questionIds) {
    if (!this.state.couples.pairs.length) throw new PartyError('Add at least one couple first');
    const all = this.state.questions.couples;
    const chosen = (questionIds?.length ? questionIds : all.slice(0, 5).map((q) => q.id)).filter((id) => all.some((q) => q.id === id)).slice(0, 5);
    if (!chosen.length) throw new PartyError('Pick some couples questions');
    this.archiveRound();
    this.state.trophy = null;
    this.state.couples.session = { id: newId('cq'), questionIds: chosen, status: 'answering', revealIndex: -1, answers: {}, matches: {} };
    this.commit();
    this.hub.fx({ type: 'roundOpen', roundType: 'couples' }, ['guest', 'tv']);
  }

  pairOf(guestId) {
    return this.state.couples.pairs.find((p) => p.a === guestId || p.b === guestId) || null;
  }

  answerCouples(guestId, questionId, choiceGuestId) {
    const session = this.state.couples.session;
    if (!session || session.status === 'done') throw new PartyError('The couples quiz is not running', 409);
    const pair = this.pairOf(guestId);
    if (!pair) throw new PartyError('You are not in a couple for this quiz', 403);
    if (!session.questionIds.includes(questionId)) throw new PartyError('No such question');
    if (session.questionIds.indexOf(questionId) <= session.revealIndex) throw new PartyError('That one was already revealed', 409);
    if (![pair.a, pair.b].includes(choiceGuestId)) throw new PartyError('Pick one of the two names');
    session.answers[guestId] = session.answers[guestId] || {};
    session.answers[guestId][questionId] = choiceGuestId;
    this.commit();
  }

  revealNextCouples() {
    const session = this.state.couples.session;
    if (!session) throw new PartyError('Start the couples quiz first');
    if (session.revealIndex >= session.questionIds.length - 1) return this.finishCouples();
    session.status = 'revealing';
    session.revealIndex += 1;
    const qid = session.questionIds[session.revealIndex];
    for (const pair of this.state.couples.pairs) {
      const a = session.answers[pair.a]?.[qid];
      const b = session.answers[pair.b]?.[qid];
      if (a && a === b) {
        session.matches[pair.id] = (session.matches[pair.id] || 0) + 1;
        this.awardCouple(pair, ROUND_POINTS);
      }
    }
    this.commit();
    this.hub.fx({ type: 'reveal', roundType: 'couples', confetti: false }, ['tv']);
    return session;
  }

  /** A match earns 10 points for each partner's team; once if they share a team. */
  awardCouple(pair, points) {
    for (const teamId of this.coupleTeamIds(pair)) this.award(teamId, points, 'couples match');
  }

  coupleTeamIds(pair) {
    const ids = [pair.a, pair.b].map((id) => this.state.guests[id]?.teamId).filter(Boolean);
    return [...new Set(ids)];
  }

  finishCouples() {
    const session = this.state.couples.session;
    if (!session) throw new PartyError('Start the couples quiz first');
    session.status = 'done';
    const ranked = this.state.couples.pairs.map((p) => ({ p, n: session.matches[p.id] || 0 })).sort((x, y) => y.n - x.n);
    const best = ranked[0];
    if (best) {
      const names = [best.p.a, best.p.b].map((id) => this.state.guests[id]?.nickname || '?').join(' & ');
      this.showTrophy({
        kind: 'couples', title: 'Most In Sync Couple', name: names,
        subtitle: `${best.n} of ${session.questionIds.length} answers matched`, teamId: this.state.guests[best.p.a]?.teamId || null,
      });
    } else this.commit();
    return session;
  }

  endCouples() {
    this.state.couples.session = null;
    this.commit();
  }

  // ---------------------------------------------------------------- physical games

  startPhysical(game, remaining) {
    if (!this.seed.physicalGames[game]) throw new PartyError('Unknown game');
    clearTimeout(this.timers.physical);
    this.archiveRound();
    const p = this.state.physical;
    Object.assign(p, { game, status: 'ready', round: 0, remaining: Math.max(1, Number(remaining) || 8), stopAt: null, stoppedAt: null });
    this.state.trophy = null;
    this.commit();
  }

  physical() {
    const p = this.state.physical;
    if (!p.game) throw new PartyError('Pick a physical game first');
    return p;
  }

  startMusicRound() {
    const p = this.physical();
    clearTimeout(this.timers.physical);
    p.status = 'playing';
    p.round += 1;
    p.stoppedAt = null;
    p.stopAt = null;
    if (p.randomStop) {
      const ms = RANDOM_STOP_MIN_MS + Math.floor(Math.random() * (RANDOM_STOP_MAX_MS - RANDOM_STOP_MIN_MS + 1));
      p.stopAt = this.now() + ms;
      this.timers.physical = setTimeout(() => this.stopMusic('random'), ms);
      this.timers.physical.unref?.();
    }
    this.commit();
    if (p.audioMode === 'system') this.runSystemAudio('play');
    this.hub.fx({ type: 'music', action: 'play', volume: p.volume, audioMode: p.audioMode }, ['tv', 'host']);
  }

  /** Fire-and-forget osascript call; the outcome is shown on the host page. */
  runSystemAudio(action) {
    if (!this.systemAudio) return;
    this.systemAudio[action]().then((result) => {
      this.systemAudioStatus = { ...result, at: this.now() };
      this.hub.changed();
    });
  }

  stopMusic(reason = 'host') {
    const p = this.physical();
    clearTimeout(this.timers.physical);
    if (p.status !== 'playing') return;
    p.status = 'stopped';
    p.stopAt = null;
    p.stoppedAt = this.now();
    if (p.audioMode === 'system') this.runSystemAudio('pause');
    this.commit();
    this.hub.fx({ type: 'music', action: 'stop', game: p.game, reason, audioMode: p.audioMode }, ['tv', 'host', 'guest']);
  }

  setPhysicalOptions({ randomStop, volume, audioMode }) {
    const p = this.state.physical;
    if (typeof randomStop === 'boolean') p.randomStop = randomStop;
    if (audioMode !== undefined) {
      if (!AUDIO_MODES.includes(audioMode)) throw new PartyError('Unknown audio mode');
      if (p.status === 'playing') throw new PartyError('Stop the music before switching the audio mode');
      p.audioMode = audioMode;
    }
    if (volume !== undefined) {
      p.volume = Math.min(1, Math.max(0, Number(volume)));
      this.hub.fx({ type: 'music', action: 'volume', volume: p.volume }, ['tv']);
    }
    this.commit();
  }

  nextTrack() {
    if (this.state.physical.audioMode === 'system') {
      this.runSystemAudio('next');
      return;
    }
    this.state.physical.trackIndex += 1;
    this.commit();
    this.hub.fx({ type: 'music', action: 'next', playing: this.state.physical.status === 'playing' }, ['tv']);
  }

  eliminate(delta = -1) {
    const p = this.physical();
    p.remaining = Math.max(0, p.remaining + Number(delta || -1));
    this.commit();
  }

  physicalWinner({ name, teamId, points }) {
    const p = this.physical();
    const bonus = Math.max(0, Math.round(Number(points) || 0));
    if (teamId) {
      this.team(teamId);
      if (bonus) this.award(teamId, bonus, `${p.game} winner`);
    }
    const game = this.seed.physicalGames[p.game];
    this.showTrophy({
      kind: 'game', title: `${game.name} Winner`, name: clean(name, 40) || this.state.teams.find((t) => t.id === teamId)?.name || 'Champions',
      subtitle: bonus ? `+${bonus} points` : '', teamId: teamId || null,
    });
  }

  endPhysical() {
    clearTimeout(this.timers.physical);
    if (this.state.physical.audioMode === 'system') {
      // Pause first if a round is running, then undo any mute the hub applied.
      const pausing = this.state.physical.status === 'playing' ? this.systemAudio?.pause() : null;
      Promise.resolve(pausing).then(() => this.runSystemAudio('release'));
    }
    Object.assign(this.state.physical, { game: null, status: 'idle', round: 0, stopAt: null, stoppedAt: null });
    this.commit();
    this.hub.fx({ type: 'music', action: 'stop', game: null, reason: 'end', silent: true }, ['tv']);
  }

  // ---------------------------------------------------------------- TV, trophy, commentator

  showTrophy(trophy) {
    this.state.trophy = { id: newId('trophy'), at: this.now(), line: this.nextPresetComment(), ...trophy };
    this.commit();
    this.hub.fx({ type: 'trophy', confetti: true }, ['tv', 'guest']);
    this.comment(this.state.trophy.id);
  }

  clearTrophy() {
    this.state.trophy = null;
    this.commit();
  }

  setTv({ pinned, paused }) {
    const modes = [null, 'welcome', 'slideshow', 'wall', 'leaderboard', 'whoshere'];
    if (pinned !== undefined) {
      if (!modes.includes(pinned)) throw new PartyError('Unknown TV mode');
      this.state.tv.pinned = pinned;
    }
    if (typeof paused === 'boolean') this.state.tv.paused = paused;
    this.commit();
  }

  /**
   * Next slideshow photo for the TV (see lib/slideshow.js). Saved but not broadcast:
   * only the TV that asked needs the answer, and phones should not refresh every 8 s.
   */
  nextSlide(from = null) {
    const live = this.state.photos.filter((p) => p.status === 'live');
    const photoId = slideshow.advance(this.state.slideshow, live, from || null);
    this.store.save();
    return { photoId };
  }

  tvHello({ audioUnlocked }) {
    const changed = this.tvStatus.audioUnlocked !== Boolean(audioUnlocked) || this.now() - this.tvStatus.lastSeen > 30000;
    this.tvStatus = { lastSeen: this.now(), audioUnlocked: Boolean(audioUnlocked) };
    if (changed) this.hub.changed();
  }

  nextPresetComment() {
    const lines = this.seed.commentator;
    const line = lines[this.commentIndex % lines.length];
    this.commentIndex += 1;
    return line;
  }

  /** Background commentator line about the scores; lands on the trophy or as commentary. */
  comment(trophyId = null) {
    if (!this.state.settings.commentator) return;
    const totals = this.teamTotals();
    const scores = this.state.teams.map((t) => `${t.name} ${totals[t.id]}`).join(', ');
    const fallback = trophyId ? this.state.trophy.line : this.nextPresetComment();
    if (!trophyId) {
      this.state.commentary = { text: fallback, at: this.now(), source: 'preset' };
      this.commit();
    }
    const prompt = [
      'You are a cheerful game-show commentator at a family Diwali party.',
      `Team scores right now: ${scores}.`,
      'Write one short, friendly line of commentary (under 15 words) about the race.',
      'Family-friendly, mention only these team names, no other names. One line only.',
    ].join(' ');
    this.ai.ask(prompt, fallback, { validate: (t) => !t.includes('\n') && t.length <= 140 }).then((text) => {
      if (text === fallback) return;
      if (trophyId && this.state.trophy?.id === trophyId) this.state.trophy.line = text;
      else if (!trophyId) this.state.commentary = { text, at: this.now(), source: 'ai' };
      else return;
      this.commit();
    });
  }

  // ---------------------------------------------------------------- questions (host)

  addQuestion(type, data) {
    const list = this.state.questions[type];
    if (!list) throw new PartyError('Unknown question type');
    const q = { id: newId(type[0]), ...this.validQuestion(type, data) };
    list.push(q);
    this.commit();
    return q;
  }

  updateQuestion(type, questionId, data) {
    const q = this.question(type, questionId);
    Object.assign(q, this.validQuestion(type, { ...q, ...data }));
    this.commit();
    return q;
  }

  validQuestion(type, data) {
    const text = clean(data.text, 160);
    if (!text) throw new PartyError('Question text is required');
    if (type === 'quiz') {
      const options = (data.options || []).map((o) => clean(o, 60)).filter(Boolean);
      const answer = Number(data.answer);
      if (options.length < 2 || options.length > 6) throw new PartyError('A quiz needs 2 to 6 options');
      if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) throw new PartyError('Mark the correct option');
      return { text, options, answer, category: clean(data.category, 30) || 'Quiz', seconds: Number(data.seconds) || 20, points: ROUND_POINTS };
    }
    if (type === 'poll') {
      const mostLikely = Boolean(data.mostLikely);
      const options = mostLikely ? [] : (data.options || []).map((o) => clean(o, 60)).filter(Boolean);
      if (!mostLikely && options.length < 2) throw new PartyError('A poll needs at least 2 options');
      return { text, mostLikely, options };
    }
    if (type === 'guessWho') {
      const authorId = data.authorId && this.state.guests[data.authorId] ? data.authorId : null;
      return { text, source: data.source || 'host', authorId, ...(data.field ? { field: data.field } : {}) };
    }
    return { text };
  }

  deleteQuestion(type, questionId) {
    const q = this.question(type, questionId);
    this.state.questions[type] = this.state.questions[type].filter((x) => x !== q);
    this.commit();
  }

  moveQuestion(type, questionId, delta) {
    const list = this.state.questions[type];
    const i = list.findIndex((q) => q.id === questionId);
    const j = i + Math.sign(Number(delta));
    if (i < 0) throw new PartyError('No such question', 404);
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.commit();
  }

  /**
   * One AI call that turns guests' facts and talents (anonymised as numbered
   * items) into Guess Who riddles and Most Likely To prompts, held for host review.
   */
  async generatePartyQuestions() {
    const items = [];
    for (const g of Object.values(this.state.guests)) {
      if (g.about.funFact) items.push({ authorId: g.id, text: `Fun fact: ${g.about.funFact}` });
      if (g.about.talent) items.push({ authorId: g.id, text: `Secret talent: ${g.about.talent}` });
    }
    if (items.length < 2) throw new PartyError('Wait until a few guests have filled in their About Me card');
    const prompt = [
      'Below are numbered fun facts and secret talents written by guests at a family Diwali party.',
      'Rewrite five of them as playful one-line "Guess who" riddles that hint without repeating the fact word for word.',
      'Then write three new "Most likely to ..." prompts for a family Diwali party.',
      'Use no names at all. Reply with exactly eight lines in this format and nothing else:',
      'R <item number> | <riddle>',
      'M | Most likely to <...>',
      '',
      'Items:',
      ...items.map((it, i) => `${i + 1}. ${it.text}`),
    ].join('\n');
    const text = await this.ai.ask(prompt, '', { validate: (t) => /^R\s*\d+\s*\|/m.test(t) || /^M\s*\|/m.test(t) });
    const pending = [];
    for (const line of text.split('\n')) {
      const riddle = line.match(/^R\s*(\d+)\s*\|\s*(.+)$/);
      const ml = line.match(/^M\s*\|\s*(.+)$/);
      if (riddle && items[Number(riddle[1]) - 1]) {
        pending.push({ id: newId('ai'), kind: 'guessWho', text: clean(riddle[2], 160), authorId: items[Number(riddle[1]) - 1].authorId });
      } else if (ml) {
        pending.push({ id: newId('ai'), kind: 'poll', text: clean(ml[1], 160) });
      }
    }
    this.state.pendingAiQuestions.push(...pending);
    this.commit();
    return { added: pending.length, usedFallback: pending.length === 0 };
  }

  approveAiQuestion(id) {
    const item = this.state.pendingAiQuestions.find((q) => q.id === id);
    if (!item) throw new PartyError('Already handled', 404);
    if (item.kind === 'guessWho') this.state.questions.guessWho.push({ id: newId('g'), text: item.text, source: 'ai', authorId: item.authorId });
    else this.state.questions.poll.push({ id: newId('p'), text: item.text, mostLikely: true, options: [] });
    this.dropAiQuestion(id);
  }

  dropAiQuestion(id) {
    this.state.pendingAiQuestions = this.state.pendingAiQuestions.filter((q) => q.id !== id);
    this.commit();
  }

  // ---------------------------------------------------------------- setup

  updateSettings({ partyName, hosts, approvalMode, commentator }) {
    const s = this.state.settings;
    if (clean(partyName, 40)) s.partyName = clean(partyName, 40);
    if (Array.isArray(hosts)) {
      const list = hosts.map((h) => clean(h, 24)).filter(Boolean).slice(0, 8);
      if (list.length) s.hosts = list;
    }
    if (typeof approvalMode === 'boolean') s.approvalMode = approvalMode;
    if (typeof commentator === 'boolean') s.commentator = commentator;
    this.commit();
  }

  resetEvent() {
    clearTimeout(this.timers.round);
    clearTimeout(this.timers.physical);
    for (const f of fs.readdirSync(this.photoDir)) {
      if (f.endsWith('.jpg')) fs.rmSync(path.join(this.photoDir, f), { force: true });
    }
    this.store.reset();
    this.hub.changed();
    this.hub.fx({ type: 'reset' });
  }
}

module.exports = { Party, PartyError, hashPin: (pin) => crypto.createHash('sha256').update(String(pin)).digest() };
