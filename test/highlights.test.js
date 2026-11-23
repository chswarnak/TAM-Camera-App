'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const plan = require('../scripts/highlights-plan');

const state = () => ({
  settings: { partyName: 'Diwali Night 2026', hosts: ['A', 'B'] },
  teams: [{ id: 't1', name: 'Diya', color: '#D4A017' }, { id: 't2', name: 'Ladoo', color: '#F07F1A' }],
  guests: { g1: { id: 'g1', nickname: 'Priya', teamId: 't1' }, g2: { id: 'g2', nickname: 'Ravi', teamId: 't2' } },
  ledger: [],
  trophy: null,
  photos: [
    { id: 'p3', guestId: 'g2', file: 'c.jpg', caption: 'third', status: 'live', hearts: ['g1'], createdAt: 3 },
    { id: 'p1', guestId: 'g1', file: 'a.jpg', caption: 'first', status: 'live', hearts: ['g1', 'g2'], createdAt: 1 },
    { id: 'p2', guestId: 'g1', file: 'b.jpg', caption: 'hidden', status: 'hidden', hearts: ['g1', 'g2', 'x'], createdAt: 2 },
    { id: 'p4', guestId: 'gone', file: 'd.jpg', caption: 'left', status: 'live', hearts: ['g1', 'g2'], createdAt: 4 },
  ],
});

test('highlights use visible photos in share order, with the sharer\'s name', () => {
  const photos = plan.orderedPhotos(state());
  assert.deepEqual(photos.map((p) => p.id), ['p1', 'p3', 'p4']);
  assert.deepEqual(photos.map((p) => p.nickname), ['Priya', 'Ravi', 'A guest']);
});

test('photos are fitted, never stretched, and the Ken Burns zoom stays clear of the lower-third', () => {
  for (const [w, h] of [[1800, 2400], [2400, 1794], [4000, 1000], [1000, 4000], [1799, 2400]]) {
    const box = plan.photoBox(w, h);
    assert.ok(Math.abs(box.w / box.h - w / h) < 0.01, `${w}x${h} keeps its aspect ratio`);
    const zw = box.w * (1 + plan.KB_ZOOM);
    const zh = box.h * (1 + plan.KB_ZOOM);
    assert.ok(zw <= plan.W, `${w}x${h} zoomed width fits the frame`);
    assert.ok(box.cy + zh / 2 <= plan.PHOTO_AREA_H && box.cy - zh / 2 >= 0, `${w}x${h} zoomed photo stays above the lower-third`);
    assert.equal(box.w % 2, 0);
    assert.equal(box.h % 2, 0);
  }
});

test('timeline: 4 s title, 3 s per photo, closing cards, 0.5 s crossfades', () => {
  const { segments, duration } = plan.timeline(10);
  assert.equal(segments[0].kind, 'title');
  assert.equal(segments[1].offset, 4, 'first photo starts fading in at 4 s');
  assert.equal(segments[2].offset - segments[1].offset, 3);
  assert.deepEqual(segments.slice(-3).map((s) => s.kind), ['thanks', 'board', 'best']);
  assert.equal(segments[0].clip, 4 + plan.FADE);
  assert.equal(segments.at(-1).clip, segments.at(-1).seconds, 'last clip has no fade tail');
  assert.equal(duration, 4 + 10 * 3 + 3.5 + 5 + 5);
  assert.equal(duration, segments.at(-1).offset + segments.at(-1).clip);
});

test('standings and Best Photo follow the app\'s own rules', () => {
  const s = state();
  s.ledger = [{ teamId: 't2', points: 10 }, { teamId: 't1', points: 4 }];
  assert.deepEqual(plan.standings(s).map((t) => [t.name, t.score, t.members]), [['Ladoo', 10, ['Ravi']], ['Diya', 4, ['Priya']]]);
  const best = plan.bestPhoto(s);
  assert.equal(best.photo.id, 'p1', 'most hearts among visible photos, earliest wins the tie');
  assert.equal(best.awarded, false);
  s.trophy = { kind: 'bestPhoto', photoId: 'p3' };
  assert.deepEqual([plan.bestPhoto(s).photo.id, plan.bestPhoto(s).awarded], ['p3', true], 'the host\'s award wins');
});

test('WhatsApp bitrate keeps a long video under 64 MB', () => {
  for (const seconds of [60, 250, 600]) {
    const kbps = plan.whatsappVideoKbps(seconds);
    const bytes = ((kbps + 96) * 1000 * seconds) / 8;
    assert.ok(bytes < plan.WHATSAPP_MAX_BYTES * 0.9, `${seconds} s → ${kbps} kbps`);
  }
});
