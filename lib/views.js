'use strict';

/**
 * Role-specific snapshots pushed over SSE. The public view (guest + TV) is
 * the privacy boundary: it never contains correct answers, Guess Who authors
 * before reveal, About Me cards, pending/hidden photos, the PIN, or the
 * random-stop time.
 */

const RECENT_SHOUTOUTS = 15;
const TOP_GUESTS_PER_TEAM = 3;
const COUPLE_POINTS = 10;

function guestName(state, id) {
  return state.guests[id]?.nickname || 'A guest';
}

function photoView(state, p) {
  const g = state.guests[p.guestId];
  return {
    id: p.id, url: `/photos/${p.file}`, caption: p.caption, autoCaption: p.autoCaption,
    guestId: p.guestId, nickname: g?.nickname || 'A guest', title: g?.title || '', teamId: g?.teamId || null,
    hearts: p.hearts.length, createdAt: p.createdAt,
  };
}

function leaderboard(party) {
  const { state } = party;
  const totals = party.teamTotals();
  const guestPoints = {};
  for (const e of state.ledger) if (e.guestId) guestPoints[e.guestId] = (guestPoints[e.guestId] || 0) + e.points;
  return state.teams.map((t) => ({
    id: t.id, name: t.name, color: t.color, score: totals[t.id],
    members: Object.values(state.guests).filter((g) => g.teamId === t.id).length,
    top: Object.values(state.guests).filter((g) => g.teamId === t.id)
      .map((g) => ({ id: g.id, nickname: g.nickname, title: g.title, points: guestPoints[g.id] || 0 }))
      .sort((a, b) => b.points - a.points || a.nickname.localeCompare(b.nickname))
      .slice(0, TOP_GUESTS_PER_TEAM),
  })).sort((a, b) => b.score - a.score);
}

function roundView(party) {
  const { state } = party;
  const r = state.round;
  if (!r) return null;
  const q = state.questions[r.type].find((x) => x.id === r.questionId);
  if (!q) return null;
  const guestOptions = party.usesGuestOptions(r.type, q);
  return {
    id: r.id, type: r.type, number: r.number, status: r.status,
    text: q.text, category: r.type === 'quiz' ? q.category : r.type === 'guessWho' ? 'Guess Who' : q.mostLikely ? 'Most Likely To' : 'Party Poll',
    options: guestOptions ? null : q.options, optionsFrom: guestOptions ? 'guests' : 'list',
    seconds: r.seconds, endsAt: r.endsAt, openedAt: r.openedAt, revealedAt: r.revealedAt,
    submissions: Object.keys(r.submissions).length,
    results: r.status === 'revealed' ? r.results : null,
  };
}

function couplesView(party, guestId) {
  const { state } = party;
  const s = state.couples.session;
  if (!s) return null;
  const questions = s.questionIds.map((id) => state.questions.couples.find((q) => q.id === id)).filter(Boolean);
  const revealed = questions.slice(0, s.revealIndex + 1).map((q) => ({
    id: q.id, text: q.text,
    pairs: state.couples.pairs.map((p) => {
      const a = s.answers[p.a]?.[q.id];
      const b = s.answers[p.b]?.[q.id];
      const match = Boolean(a && a === b);
      const awards = match ? party.coupleTeamIds(p).map((teamId) => ({ teamId, team: state.teams.find((t) => t.id === teamId)?.name || 'Team', points: COUPLE_POINTS })) : [];
      return { pairId: p.id, a: guestName(state, p.a), b: guestName(state, p.b), aSays: a ? guestName(state, a) : null, bSays: b ? guestName(state, b) : null, match, awards };
    }),
  }));
  const view = {
    id: s.id, status: s.status, revealIndex: s.revealIndex,
    questions: questions.map((q) => ({ id: q.id, text: q.text })),
    pairs: state.couples.pairs.map((p) => ({
      id: p.id, a: guestName(state, p.a), b: guestName(state, p.b), teamId: state.guests[p.a]?.teamId || null,
      matches: s.matches[p.id] || 0,
      answered: Object.keys(s.answers[p.a] || {}).length + Object.keys(s.answers[p.b] || {}).length,
    })),
    revealed,
  };
  if (guestId) {
    const pair = party.pairOf(guestId);
    view.me = pair ? {
      pairId: pair.id,
      choices: [{ id: pair.a, nickname: guestName(state, pair.a) }, { id: pair.b, nickname: guestName(state, pair.b) }],
      answers: s.answers[guestId] || {},
    } : null;
  }
  return view;
}

/**
 * Who's-here graph edges: couples, plus any two guests linked by a shout-out
 * (either direction). One edge per pair of guests; "couple" wins over "shoutout".
 */
function connections(state) {
  const edges = new Map();
  const add = (a, b, kind) => {
    if (!state.guests[a] || !state.guests[b] || a === b) return;
    const key = [a, b].sort().join('|');
    if (!edges.has(key) || kind === 'couple') edges.set(key, { a, b, kind });
  };
  for (const s of state.shoutouts) add(s.from, s.to, 'shoutout');
  for (const p of state.couples.pairs) add(p.a, p.b, 'couple');
  return [...edges.values()];
}

function banner(party) {
  const { state } = party;
  const r = state.round;
  const p = state.physical;
  const games = party.seed.physicalGames;
  if (r) {
    const label = { quiz: `Quiz question ${r.number}`, poll: 'Party Poll', guessWho: 'Guess Who' }[r.type];
    if (r.status === 'open') return `${label} is open. Answer now!`;
    if (r.status === 'closed') return `${label} is closed. Reveal coming up…`;
    return `${label} results are on the TV`;
  }
  if (state.couples.session && state.couples.session.status !== 'done') return 'Couples Quiz is on';
  if (p.game) return `${games[p.game].name}: round ${p.round || 1}${p.status === 'playing' ? ', music is playing!' : ''}`;
  if (state.trophy) return `🏆 ${state.trophy.title}: ${state.trophy.name}`;
  return 'Voting for Best Photo: heart your favourites on the Photo Wall';
}

function publicView(party, { guestId = null, joinUrl = '' } = {}) {
  const { state, seed } = party;
  const p = state.physical;
  const live = state.photos.filter((ph) => ph.status === 'live');
  const view = {
    serverNow: party.now(),
    party: {
      name: state.settings.partyName, hosts: state.settings.hosts,
      welcomeLine: `${joinNames(state.settings.hosts)} welcome you to ${state.settings.partyName}`,
    },
    joinUrl,
    teams: leaderboard(party),
    guests: Object.values(state.guests).map((g) => ({ id: g.id, nickname: g.nickname, teamId: g.teamId, title: g.title, joinedAt: g.joinedAt }))
      .sort((a, b) => a.nickname.localeCompare(b.nickname)),
    photos: live.map((ph) => photoView(state, ph)).sort((a, b) => b.createdAt - a.createdAt),
    connections: connections(state),
    round: roundView(party),
    couples: couplesView(party, guestId),
    physical: {
      game: p.game, status: p.status, round: p.round, remaining: p.remaining, randomStop: p.randomStop,
      volume: p.volume, trackIndex: p.trackIndex, stoppedAt: p.stoppedAt, audioMode: p.audioMode,
      info: p.game ? seed.physicalGames[p.game] : null,
    },
    tv: state.tv,
    trophy: trophyView(state),
    commentary: state.settings.commentator ? state.commentary : null,
    shoutouts: state.shoutouts.slice(-RECENT_SHOUTOUTS).reverse().map((s) => {
      const st = seed.stickers.find((x) => x.id === s.sticker);
      return { id: s.id, from: guestName(state, s.from), to: guestName(state, s.to), emoji: st?.emoji, text: st?.text, at: s.at };
    }),
    banner: banner(party),
    content: {
      stickers: seed.stickers, captions: seed.captions, aboutOptions: seed.aboutOptions, physicalGames: seed.physicalGames,
      features: party.features,
    },
  };
  if (guestId) view.me = meView(party, guestId);
  return view;
}

function meView(party, guestId) {
  const { state } = party;
  const g = state.guests[guestId];
  if (!g) return null;
  const r = state.round;
  let canVote = true;
  if (r?.type === 'guessWho') {
    const q = state.questions.guessWho.find((x) => x.id === r.questionId);
    canVote = q?.authorId !== guestId;
  }
  return {
    id: g.id, nickname: g.nickname, teamId: g.teamId, title: g.title, about: g.about,
    hearted: state.photos.filter((p) => p.hearts.includes(guestId)).map((p) => p.id),
    myPhotos: state.photos.filter((p) => p.guestId === guestId && p.status !== 'hidden').map((p) => ({ id: p.id, status: p.status })),
    round: r ? { id: r.id, answer: r.submissions[guestId] ?? null, canVote } : null,
    shoutoutsLeft: party.shoutoutsLeft(guestId),
  };
}

function trophyView(state) {
  if (!state.trophy) return null;
  const photo = state.trophy.photoId && state.photos.find((p) => p.id === state.trophy.photoId && p.status === 'live');
  return { ...state.trophy, photoUrl: photo ? `/photos/${photo.file}` : null };
}

function joinNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

/** Host sees everything, plus live server/TV/AI status. */
function hostView(party, extra) {
  const { state } = party;
  return {
    ...publicView(party, extra),
    host: {
      settings: state.settings,
      guests: Object.values(state.guests).sort((a, b) => a.nickname.localeCompare(b.nickname)),
      photos: [...state.photos].sort((a, b) => b.createdAt - a.createdAt).map((p) => ({ ...photoView(state, p), status: p.status })),
      questions: state.questions,
      pendingAiQuestions: state.pendingAiQuestions,
      round: state.round,
      roundHistory: state.roundHistory.map((r) => ({ type: r.type, questionId: r.questionId })),
      couples: state.couples,
      physical: state.physical,
      tvStatus: { ...party.tvStatus, connected: party.now() - party.tvStatus.lastSeen < 30000 },
      systemAudioStatus: party.systemAudioStatus,
      ...(extra.hostExtra ? extra.hostExtra() : {}),
    },
  };
}

module.exports = { publicView, hostView, joinNames };
