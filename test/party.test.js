'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { Store } = require('../lib/store');
const { publicView, hostView } = require('../lib/views');
const { SEED, SAMPLE_JPEG, makeParty, about } = require('./helpers');

test('join balances teams and keeps identity on re-join', () => {
  const { party } = makeParty();
  const ids = [];
  for (let i = 0; i < 8; i += 1) ids.push(party.join({ id: `guest_test${i}xx`, nickname: `G${i}`, about: about() }).id);
  const counts = {};
  for (const g of Object.values(party.state.guests)) counts[g.teamId] = (counts[g.teamId] || 0) + 1;
  assert.deepEqual(Object.values(counts), [2, 2, 2, 2]);
  const before = party.state.guests[ids[0]].teamId;
  party.join({ id: ids[0], nickname: 'Renamed', about: about({ sweet: 'ladoo', arrival: 'fashionably late' }) });
  assert.equal(party.state.guests[ids[0]].teamId, before);
  assert.equal(party.state.guests[ids[0]].title, 'Minister of Late Ladoos');
});

test('every sweet + arrival combination has a fallback title', () => {
  for (const sweet of SEED.aboutOptions.sweet) {
    for (const arrival of SEED.aboutOptions.arrival) assert.ok(SEED.titles[sweet][arrival], `${sweet}/${arrival}`);
  }
});

test('AI title replaces the preset when it lands and is pushed to the phone', async () => {
  const { party, hub } = makeParty({ ai: { ask: () => Promise.resolve('Chief Jalebi Officer') } });
  const g = party.join({ nickname: 'Priya', about: about() });
  assert.equal(g.title, 'Jalebi Early Bird');
  await new Promise((r) => setImmediate(r));
  assert.equal(party.state.guests[g.id].title, 'Chief Jalebi Officer');
  assert.deepEqual(hub.guestFx[0], { id: g.id, data: { type: 'title', title: 'Chief Jalebi Officer' } });
});

test('public view never leaks answers, authors, cards or pending photos', () => {
  const { party } = makeParty();
  const a = party.join({ nickname: 'Asha', about: about() });
  const b = party.join({ nickname: 'Bala', about: about({ funFact: 'Bala fact', talent: 'Bala talent' }) });
  party.updateSettings({ approvalMode: true });
  party.addPhoto(a.id, SAMPLE_JPEG, 'pending one');
  const quiz = party.state.questions.quiz[0];
  party.launchRound('quiz', quiz.id);
  const others = (view) => JSON.stringify({ ...view, me: undefined });
  const guestView = publicView(party, { guestId: b.id });
  assert.equal(guestView.round.answer, undefined);
  assert.ok(!/"answer"/.test(others(guestView)), 'quiz answer leaked');
  assert.ok(!others(guestView).includes('pending one'), 'pending photo leaked');
  assert.ok(!others(guestView).includes('airport'), "another guest's card leaked");
  assert.ok(!JSON.stringify(publicView(party, {})).includes('airport'), 'About Me card leaked to TV');
  const gw = party.state.questions.guessWho.find((q) => q.authorId === a.id);
  party.launchRound('guessWho', gw.id);
  const tv = JSON.stringify(publicView(party, {}));
  assert.ok(!tv.includes('authorId'), 'guess who author leaked');
  assert.equal(publicView(party, {}).round.results, null);
  assert.equal(publicView(party, { guestId: a.id }).me.round.canVote, false);
  assert.ok(hostView(party, { hostExtra: () => ({ pin: '987654' }) }).host.pin, 'host sees PIN');
  assert.ok(!tv.includes('987654'));
});

test('quiz: 10 points per correct answer to the team, late answers rejected', () => {
  let clock = 1_000_000;
  const { party } = makeParty({ now: () => clock });
  const a = party.join({ nickname: 'A', about: about() });
  const b = party.join({ nickname: 'B', about: about() });
  const q = party.state.questions.quiz[0];
  const round = party.launchRound('quiz', q.id);
  assert.equal(round.endsAt, clock + 20000);
  party.submit(a.id, round.id, q.answer);
  party.submit(b.id, round.id, (q.answer + 1) % 4);
  assert.throws(() => party.submit(a.id, round.id, q.answer), /already answered/);
  const c = party.join({ nickname: 'C', about: about() });
  clock += 25000;
  assert.throws(() => party.submit(c.id, round.id, q.answer), /Time is up/);
  party.revealRound();
  const totals = party.teamTotals();
  assert.equal(totals[a.teamId], 10);
  assert.equal(totals[b.teamId] || 0, a.teamId === b.teamId ? 10 : 0);
  assert.equal(party.state.round.results.correct, q.answer);
  party.adjustScore(b.teamId, -5);
  assert.equal(party.teamTotals()[b.teamId], (a.teamId === b.teamId ? 10 : 0) - 5);
});

test('guess who: author cannot vote, correct guessers score', () => {
  const { party } = makeParty();
  const author = party.join({ nickname: 'Author', about: about() });
  const guesser = party.join({ nickname: 'Guesser', about: about({ funFact: '', talent: '' }) });
  const q = party.state.questions.guessWho.find((x) => x.authorId === author.id && x.field === 'funFact');
  const round = party.launchRound('guessWho', q.id);
  assert.throws(() => party.submit(author.id, round.id, guesser.id), /own fact/);
  party.submit(guesser.id, round.id, author.id);
  party.revealRound();
  assert.equal(party.state.round.results.author.nickname, 'Author');
  assert.equal(party.teamTotals()[guesser.teamId], 10);
});

test('most likely to polls take guest ids as answers', () => {
  const { party } = makeParty();
  const a = party.join({ nickname: 'A', about: about() });
  const b = party.join({ nickname: 'B', about: about() });
  const poll = party.state.questions.poll.find((p) => p.mostLikely);
  const round = party.launchRound('poll', poll.id);
  assert.throws(() => party.submit(a.id, round.id, 0), /Pick someone/);
  party.submit(a.id, round.id, b.id);
  party.submit(b.id, round.id, b.id);
  party.revealRound();
  assert.deepEqual(party.state.round.results.options[0], { id: b.id, label: 'B', teamId: b.teamId, votes: 2 });
});

test('photos: hearts once per guest, hide removes from public view, best photo awards 20', () => {
  const { party, hub } = makeParty();
  const a = party.join({ nickname: 'A', about: about() });
  const b = party.join({ nickname: 'B', about: about() });
  const p1 = party.addPhoto(a.id, SAMPLE_JPEG, 'one');
  assert.ok(hub.fxList.some((f) => f.type === 'newPhoto' && f.photoId === p1.id));
  party.heart(b.id, p1.id);
  party.heart(b.id, p1.id);
  assert.equal(party.photo(p1.id).hearts.length, 1);
  assert.throws(() => party.addPhoto(a.id, Buffer.from('not a jpeg at all, definitely not, no no no no no no no no no no no no no no no no no no no no no no no no'), ''), /JPEG/);
  party.awardBestPhoto();
  assert.equal(party.teamTotals()[a.teamId], 20);
  assert.equal(party.state.trophy.kind, 'bestPhoto');
  party.setPhotoStatus(p1.id, 'hidden');
  assert.equal(publicView(party, {}).photos.length, 0);
});

test('shout-outs are limited to 10 per guest per hour', () => {
  let clock = 0;
  const { party } = makeParty({ now: () => clock });
  const a = party.join({ nickname: 'A', about: about() });
  const b = party.join({ nickname: 'B', about: about() });
  for (let i = 0; i < 10; i += 1) party.shoutout(a.id, b.id, 'diya');
  assert.throws(() => party.shoutout(a.id, b.id, 'diya'), /10 shout-outs/);
  assert.throws(() => party.shoutout(b.id, b.id, 'diya'), /someone else/);
  clock += 3600 * 1000 + 1;
  party.shoutout(a.id, b.id, 'mvp');
});

test('couples quiz: a match pays 10 to each partner team, once when they share a team', () => {
  const { party } = makeParty();
  const a = party.join({ nickname: 'Ravi', about: about() });
  const b = party.join({ nickname: 'Priya', about: about() });
  const c = party.join({ nickname: 'Neel', about: about() });
  const d = party.join({ nickname: 'Tara', about: about() });
  b.teamId = a.teamId;
  d.teamId = party.state.teams.find((t) => t.id !== c.teamId).id;
  party.addPair(a.id, b.id);
  party.addPair(c.id, d.id);
  party.startCouples();
  const [q1, q2] = party.state.couples.session.questionIds;
  for (const [g, q, pick] of [[a, q1, b], [b, q1, b], [a, q2, a], [b, q2, b], [c, q1, d], [d, q1, d]]) party.answerCouples(g.id, q, pick.id);
  const before = party.teamTotals();
  party.revealNextCouples();
  const after = party.teamTotals();
  assert.equal(after[a.teamId] - before[a.teamId], 10 + (c.teamId === a.teamId ? 10 : 0) + (d.teamId === a.teamId ? 10 : 0), 'shared team gets 10 once');
  assert.equal(after[c.teamId] - before[c.teamId] >= 10, true);
  assert.equal(after[d.teamId] - before[d.teamId] >= 10, true);
  const view = publicView(party, { guestId: a.id }).couples;
  const sameTeam = view.revealed[0].pairs.find((p) => p.a === 'Ravi');
  const splitTeams = view.revealed[0].pairs.find((p) => p.a === 'Neel');
  assert.equal(sameTeam.awards.length, 1);
  assert.deepEqual(splitTeams.awards.map((w) => w.points), [10, 10]);
  assert.deepEqual(splitTeams.awards.map((w) => w.teamId).sort(), [c.teamId, d.teamId].sort());
  party.revealNextCouples();
  assert.throws(() => party.answerCouples(a.id, q1, a.id), /already revealed/);
  assert.equal(publicView(party, {}).couples.revealed[1].pairs.find((p) => p.a === 'Ravi').match, false);
  party.finishCouples();
  assert.equal(party.state.trophy.title, 'Most In Sync Couple');
});

test('system audio mode drives Spotify/mute on start, stop and end, and persists', async () => {
  const { party, store, dataDir, systemAudio, hub } = makeParty();
  party.startPhysical('hat', 4);
  party.startMusicRound();
  party.stopMusic('host');
  assert.deepEqual(systemAudio.calls, [], 'playlist mode never touches system audio');
  party.setPhysicalOptions({ audioMode: 'system' });
  party.startMusicRound();
  assert.throws(() => party.setPhysicalOptions({ audioMode: 'playlist' }), /Stop the music/);
  party.stopMusic('random');
  party.nextTrack();
  party.startMusicRound();
  party.endPhysical();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(systemAudio.calls, ['play', 'pause', 'next', 'play', 'pause', 'release']);
  const stop = hub.fxList.filter((f) => f.type === 'music' && f.action === 'stop' && !f.silent).pop();
  assert.equal(stop.audioMode, 'system', 'TV still gets the stop (buzzer + flash)');
  assert.equal(party.systemAudioStatus.action, 'release');
  assert.throws(() => party.setPhysicalOptions({ audioMode: 'radio' }), /Unknown audio mode/);
  store.flush();
  const reloaded = makeParty({ dataDir }).party;
  assert.equal(reloaded.state.physical.audioMode, 'system');
  assert.equal(publicView(reloaded, {}).physical.audioMode, 'system');
});

test("who's here: guests carry join time and couples/shout-outs become graph edges", () => {
  const { party } = makeParty();
  const [a, b, c] = ['A', 'B', 'C'].map((n) => party.join({ nickname: n, about: about() }));
  party.addPair(a.id, b.id);
  party.shoutout(a.id, b.id, 'diya');
  party.shoutout(c.id, a.id, 'mvp');
  party.shoutout(a.id, c.id, 'mvp');
  const view = publicView(party, {});
  assert.ok(view.guests.every((g) => typeof g.joinedAt === 'number'));
  assert.equal(view.connections.length, 2);
  assert.equal(view.connections.find((e) => [e.a, e.b].includes(b.id)).kind, 'couple');
  assert.equal(view.connections.find((e) => [e.a, e.b].includes(c.id)).kind, 'shoutout');
  party.setTv({ pinned: 'whoshere' });
  assert.equal(party.state.tv.pinned, 'whoshere');
});

test('backdrop feature flag reaches guests and defaults to off', () => {
  assert.equal(publicView(makeParty().party, {}).content.features.backdrop, false);
  assert.equal(publicView(makeParty({ features: { backdrop: true } }).party, {}).content.features.backdrop, true);
});

test('random stop fires between 8 and 25 seconds and keeps the round count', () => {
  let clock = 0;
  const { party, hub } = makeParty({ now: () => clock });
  party.startPhysical('hat', 6);
  for (let i = 0; i < 30; i += 1) {
    party.startMusicRound();
    const wait = party.state.physical.stopAt - clock;
    assert.ok(wait >= 8000 && wait <= 25000, `stop after ${wait} ms`);
    party.stopMusic('test');
  }
  assert.equal(party.state.physical.round, 30);
  assert.equal(party.state.physical.status, 'stopped');
  assert.ok(hub.fxList.some((f) => f.type === 'music' && f.action === 'stop'));
  party.eliminate(-1);
  assert.equal(party.state.physical.remaining, 5);
  assert.equal(publicView(party, {}).physical.stopAt, undefined, 'stop time must not reach the TV');
  party.endPhysical();
});

test('state survives a restart (scores, guests, questions, photos)', () => {
  const { party, store, dataDir } = makeParty();
  const a = party.join({ nickname: 'Keeper', about: about() });
  party.addPhoto(a.id, SAMPLE_JPEG, 'keep me');
  party.adjustScore(a.teamId, 30);
  party.addQuestion('quiz', { text: 'Custom?', options: ['x', 'y'], answer: 1 });
  store.flush();
  const reloaded = new Store({ dataDir, seed: SEED });
  assert.equal(reloaded.state.guests[a.id].nickname, 'Keeper');
  assert.equal(reloaded.state.photos[0].caption, 'keep me');
  assert.equal(reloaded.state.ledger.reduce((s, e) => s + e.points, 0), 30);
  assert.ok(reloaded.state.questions.quiz.some((q) => q.text === 'Custom?'));
});

test('generated party questions map riddles back to their authors', async () => {
  const ai = { ask: () => Promise.resolve('R 2 | Who juggles more than plates?\nM | Most likely to dance with a diya\nnoise line') };
  const { party } = makeParty({ ai });
  const a = party.join({ nickname: 'A', about: about() });
  party.join({ nickname: 'B', about: about() });
  const result = await party.generatePartyQuestions();
  assert.equal(result.added, 2);
  const riddle = party.state.pendingAiQuestions.find((q) => q.kind === 'guessWho');
  assert.equal(riddle.authorId, a.id);
  party.approveAiQuestion(riddle.id);
  assert.ok(party.state.questions.guessWho.some((q) => q.source === 'ai' && q.authorId === a.id));
});

test('TV header names the hosts with an ampersand', () => {
  const { party } = makeParty();
  party.updateSettings({ partyName: 'Diwali Night', hosts: ['Asha', 'Ravi', 'Neel', 'Tara'] });
  assert.equal(publicView(party).party.welcomeLine, 'Asha, Ravi, Neel & Tara welcome you to Diwali Night');
});
