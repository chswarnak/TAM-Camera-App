'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

process.env.AI_ENABLED = 'false';
const { createApp } = require('../server');
const { SAMPLE_JPEG, fakeSystemAudio, tempDir } = require('./helpers');

const PIN = '424242';

async function boot(dataDir) {
  const ctx = createApp({ dataDir, port: 0, pin: PIN, systemAudio: fakeSystemAudio(), features: { backdrop: false } });
  const server = await new Promise((resolve) => { const s = ctx.app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, { method = 'GET', body, headers = {}, raw } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(raw ? { 'content-type': 'image/jpeg' } : body ? { 'content-type': 'application/json' } : {}), ...headers },
      body: raw || (body ? JSON.stringify(body) : undefined),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const stop = async () => {
    ctx.store.flush();
    ctx.hub.close();
    await new Promise((r) => server.close(r));
  };
  return { ...ctx, base, call, stop };
}

const host = { 'x-host-pin': PIN };

test('end to end over HTTP: join, photo, quiz, PIN, persistence', async () => {
  const dataDir = tempDir();
  let app = await boot(dataDir);

  // host routes reject missing or wrong PINs
  assert.equal((await app.call('/api/host/state')).status, 401);
  assert.equal((await app.call('/api/host/round/next', { method: 'POST', body: {}, headers: { 'x-host-pin': '000000' } })).status, 401);
  assert.equal((await app.call('/api/events?role=host&pin=nope')).status, 401);
  assert.equal((await app.call('/api/host/login', { method: 'POST', body: {}, headers: host })).status, 200);

  // join
  const joined = await app.call('/api/join', { method: 'POST', body: { id: 'guest_abcdef123456', nickname: 'Priya', about: { sweet: 'ladoo', arrival: 'fashionably late', funFact: 'Ran a marathon' } } });
  assert.equal(joined.status, 200);
  assert.equal(joined.json.me.title, 'Minister of Late Ladoos');
  const guestId = joined.json.me.id;

  // photo upload shows up in the slideshow feed
  const up = await app.call('/api/photos', { method: 'POST', raw: SAMPLE_JPEG, headers: { 'x-guest-id': guestId, 'x-caption': encodeURIComponent('Dil se Diwali ✨') } });
  assert.equal(up.status, 200);
  let state = (await app.call('/api/state')).json;
  assert.equal(state.photos[0].caption, 'Dil se Diwali ✨');
  const img = await fetch(app.base + state.photos[0].url);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');

  // quiz launch → answer → reveal, answers never in guest state before reveal
  const next = await app.call('/api/host/round/next', { method: 'POST', body: { type: 'quiz' }, headers: host });
  state = (await app.call(`/api/state?guestId=${guestId}`)).json;
  assert.equal(state.round.status, 'open');
  assert.equal(state.round.results, null);
  const hostState = (await app.call('/api/host/state', { headers: host })).json;
  const answer = hostState.host.questions.quiz.find((q) => q.id === hostState.host.round.questionId).answer;
  assert.equal((await app.call(`/api/rounds/${next.json.id}/answer`, { method: 'POST', body: { guestId, answer } })).status, 200);
  assert.equal((await app.call('/api/host/round/reveal', { method: 'POST', body: {}, headers: host })).status, 200);
  state = (await app.call('/api/state')).json;
  assert.equal(state.round.status, 'revealed');
  assert.equal(state.round.results.correct, answer);
  assert.equal(state.teams.find((t) => t.id === joined.json.me.teamId).score, 10);

  // restart: scores, guests, photos and questions survive
  await app.stop();
  app = await boot(dataDir);
  state = (await app.call(`/api/state?guestId=${guestId}`)).json;
  assert.equal(state.me.nickname, 'Priya');
  assert.equal(state.teams.find((t) => t.id === joined.json.me.teamId).score, 10);
  assert.equal(state.photos.length, 1);

  // hidden photos vanish from the feed and their file is no longer served
  await app.call(`/api/host/photos/${state.photos[0].id}/status`, { method: 'POST', body: { status: 'hidden' }, headers: host });
  assert.equal((await app.call('/api/state')).json.photos.length, 0);
  assert.equal((await fetch(app.base + state.photos[0].url)).status, 404);

  // reset requires the typed confirmation
  assert.equal((await app.call('/api/host/reset', { method: 'POST', body: { confirm: 'yes' }, headers: host })).status, 400);
  await app.stop();
});

test('health reports uptime, guests, live connections and memory; dropped streams are cleaned up', async () => {
  const app = await boot(tempDir());
  await app.call('/api/join', { method: 'POST', body: { nickname: 'Asha' } });
  const streams = await Promise.all([0, 1, 2].map(async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${app.base}/api/events?role=guest&guestId=x`, { signal: ctrl.signal });
    assert.equal(res.status, 200);
    return ctrl;
  }));
  let health = (await app.call('/health')).json;
  assert.equal(health.ok, true);
  assert.equal(health.guests, 1);
  assert.equal(health.sse.guest, 3);
  assert.ok(health.uptimeSeconds >= 0 && health.memoryMb.rss > 0);
  assert.ok(!JSON.stringify(health).includes(PIN), 'no PIN in health');

  for (const ctrl of streams) ctrl.abort();
  for (let i = 0; i < 50 && health.sse.total > 0; i += 1) {
    await new Promise((r) => setTimeout(r, 20));
    health = (await app.call('/health')).json;
  }
  assert.equal(health.sse.total, 0, 'closed phones leave no connections behind');
  await app.stop();
});

test('a malformed request gets a JSON error and the server keeps serving', async () => {
  const app = await boot(tempDir());
  const bad = await fetch(`${app.base}/api/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"nickname": ' });
  assert.equal(bad.status, 400);
  assert.ok((await bad.json()).error);
  const ok = await app.call('/api/join', { method: 'POST', body: { nickname: 'Ravi' } });
  assert.equal(ok.status, 200);
  await app.stop();
});
