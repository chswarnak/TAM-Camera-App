'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { emptyCursor, queueJump, advance, NEWEST_COUNT } = require('../lib/slideshow');
const { SAMPLE_JPEG, makeParty, about } = require('./helpers');

const photos = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${String(i).padStart(2, '0')}`, createdAt: 1000 + i }));

/** Advances `count` times as one TV would, passing the photo it is showing. */
function run(cursor, live, count, from = cursor.currentId) {
  const seen = [];
  let current = from;
  for (let i = 0; i < count; i += 1) {
    current = advance(cursor, live, current);
    seen.push(current);
  }
  return seen;
}

test('slideshow shows every photo before repeating, newest five twice per lap', () => {
  const live = photos(20);
  const cursor = emptyCursor();
  const lap = run(cursor, live, 25, null);
  const counts = {};
  for (const id of lap) counts[id] = (counts[id] || 0) + 1;
  assert.equal(Object.keys(counts).length, 20, 'every photo appears in one lap');
  const newest = live.slice(-NEWEST_COUNT).map((p) => p.id);
  for (const id of newest) assert.equal(counts[id], 2, `${id} (newest) twice`);
  for (const p of live.slice(0, 15)) assert.equal(counts[p.id], 1, `${p.id} once`);
  for (let i = 1; i < lap.length; i += 1) assert.notEqual(lap[i], lap[i - 1], 'never the same photo twice in a row');
});

test('slideshow is fair over a whole evening', () => {
  const live = photos(20);
  const cursor = emptyCursor();
  run(cursor, live, 2500, null);
  const shows = Object.values(cursor.shows);
  const older = live.slice(0, 15).map((p) => cursor.shows[p.id]);
  const newer = live.slice(15).map((p) => cursor.shows[p.id]);
  assert.equal(shows.length, 20);
  assert.ok(Math.max(...older) - Math.min(...older) <= 1, `older photos equal: ${older}`);
  assert.ok(Math.max(...newer) - Math.min(...newer) <= 1, `newest photos equal: ${newer}`);
  assert.ok(Math.abs(newer[0] / older[0] - 2) < 0.05, 'newest five shown about twice as often');
});

test('a new photo jumps the queue once, then the sequence continues', () => {
  const live = photos(20);
  const cursor = emptyCursor();
  const before = run(cursor, live, 7, null);
  const fresh = { id: 'new', createdAt: 5000 };
  live.push(fresh);
  queueJump(cursor, fresh.id);
  const after = run(cursor, live, 30);
  assert.equal(after[0], 'new', 'new photo shows immediately');
  assert.notEqual(after[1], 'new');
  const nextOld = after.slice(1).filter((id) => id !== 'new' && !before.includes(id));
  assert.ok(nextOld.length > 0, 'unseen photos keep coming after the jump');
  assert.ok(after.slice(1, 6).every((id) => !before.slice(-3).includes(id)), 'no restart from the photos just shown');
});

test('a burst of uploads shows the latest first and queues at most five jumps', () => {
  const cursor = emptyCursor();
  for (let i = 0; i < 8; i += 1) queueJump(cursor, `n${i}`);
  assert.deepEqual(cursor.jumps, ['n7', 'n6', 'n5', 'n4', 'n3']);
});

test('a second TV or a reload never skips or restarts the sequence', () => {
  const live = photos(5);
  const cursor = emptyCursor();
  const a = advance(cursor, live, null);
  const b = advance(cursor, live, a);
  assert.equal(advance(cursor, live, a), b, 'stale `from` returns the current photo');
  assert.equal(advance(cursor, live, null), b, 'a reloaded TV resumes the current photo');
  assert.equal(advance(cursor, [], b), null);
});

test('slideshow cursor resumes after leaving and returning, and after a restart (20 photos)', () => {
  const ctx = makeParty();
  const { party } = ctx;
  const g = party.join({ nickname: 'Priya', about: about() });
  for (let i = 0; i < 20; i += 1) party.addPhoto(g.id, SAMPLE_JPEG, `photo ${i}`);
  // Twenty fresh uploads: the newest five jump in (latest first), then the rest rotate in.
  let current = null;
  const firstPass = [];
  for (let i = 0; i < 20; i += 1) {
    current = party.nextSlide(current).photoId;
    firstPass.push(current);
  }
  const captions = Object.fromEntries(ctx.store.state.photos.map((p) => [p.id, p.caption]));
  assert.deepEqual(firstPass.slice(0, 5).map((id) => captions[id]), ['photo 19', 'photo 18', 'photo 17', 'photo 16', 'photo 15']);
  assert.equal(new Set(firstPass).size, 20, 'each upload shown once in the first 20 slides');

  const shown = [];
  for (let i = 0; i < 6; i += 1) {
    current = party.nextSlide(current).photoId;
    shown.push(current);
  }
  // TV leaves for the leaderboard / who's here / a question; nothing advances meanwhile.
  const back = party.nextSlide(current).photoId;
  assert.ok(!shown.includes(back), 'returning continues with a photo not just shown');
  assert.notEqual(back, firstPass[0]);

  ctx.store.flush();
  const again = makeParty({ dataDir: ctx.dataDir });
  assert.equal(again.party.nextSlide(null).photoId, back, 'a restarted server resumes the current photo');
  const afterRestart = again.party.nextSlide(back).photoId;
  assert.ok(![...shown, back].includes(afterRestart), 'and continues the sequence');
});
