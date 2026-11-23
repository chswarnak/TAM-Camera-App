'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');

const { SseHub } = require('../lib/sse');

/** Minimal stand-ins for an http request/response pair. */
function fakeClient() {
  const req = new EventEmitter();
  const res = new EventEmitter();
  Object.assign(res, {
    chunks: [], destroyed: false, writableEnded: false,
    writeHead() {}, write(text) { this.chunks.push(text); }, end() { this.writableEnded = true; },
  });
  return { req, res };
}

function hub(opts = {}) {
  const warnings = [];
  const h = new SseHub({ snapshotFor: (role) => ({ role }), log: { warn: (m) => warnings.push(m) }, ...opts });
  return { h, warnings };
}

test('a closed or errored connection is dropped from the hub', () => {
  const { h } = hub();
  const a = fakeClient();
  const b = fakeClient();
  const c = fakeClient();
  h.attach(a.req, a.res, { role: 'guest', guestId: 'g1' });
  h.attach(b.req, b.res, { role: 'guest', guestId: 'g2' });
  h.attach(c.req, c.res, { role: 'tv' });
  assert.deepEqual(h.counts(), { total: 3, guest: 2, tv: 1, host: 0 });
  a.req.emit('close');
  b.res.emit('error', new Error('EPIPE'));
  assert.deepEqual(h.counts(), { total: 1, guest: 0, tv: 1, host: 0 });
  assert.ok(b.res.writableEnded, 'errored response is ended');
  h.close();
});

test('a socket that died without a close event is dropped on the next heartbeat', () => {
  const { h } = hub();
  const a = fakeClient();
  h.attach(a.req, a.res, { role: 'guest', guestId: 'g1' });
  a.res.destroyed = true;
  h.ping();
  assert.equal(h.counts().total, 0);
  h.close();
});

test('warns once when live connections climb past the threshold, again after it recovers', () => {
  const { h, warnings } = hub({ warnAt: 3 });
  const clients = Array.from({ length: 5 }, fakeClient);
  for (const c of clients) h.attach(c.req, c.res, { role: 'guest', guestId: 'g' });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /4 open live connections/);
  for (const c of clients.slice(0, 3)) c.req.emit('close');
  const more = Array.from({ length: 2 }, fakeClient);
  for (const c of more) h.attach(c.req, c.res, { role: 'guest', guestId: 'g' });
  assert.equal(warnings.length, 2);
  h.close();
});
