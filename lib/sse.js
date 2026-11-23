'use strict';

const HEARTBEAT_MS = 15000;
const WARN_CONNECTIONS = 150;

/**
 * Server-Sent Events hub. Each client has a role (guest, tv, host) and an
 * optional guest id so events can go to one phone. Snapshots are role-specific
 * and coalesced: many changes in a burst produce one broadcast.
 */
class SseHub {
  constructor({ snapshotFor, coalesceMs = 150, warnAt = WARN_CONNECTIONS, log = console }) {
    this.clients = new Set();
    this.warnAt = warnAt;
    this.log = log;
    this.warned = false;
    this.snapshotFor = snapshotFor;
    this.coalesceMs = coalesceMs;
    this.pending = null;
    this.heartbeat = setInterval(() => this.ping(), HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  attach(req, res, { role, guestId = null }) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    const client = { res, role, guestId };
    this.clients.add(client);
    this.checkLoad();
    // Any of these means the phone is gone; drop it so dead sockets never pile up.
    const drop = () => this.drop(client);
    req.on('close', drop);
    res.on('close', drop);
    res.on('error', drop);
    this.send(client, 'state', this.snapshotFor(role, guestId));
  }

  drop(client) {
    if (!this.clients.delete(client)) return;
    if (this.clients.size < this.warnAt) this.warned = false;
    if (!client.res.writableEnded) client.res.end();
  }

  /** Logs once each time the open-connection count climbs past warnAt. */
  checkLoad() {
    if (this.warned || this.clients.size <= this.warnAt) return;
    this.warned = true;
    this.log.warn(`[sse] ${this.clients.size} open live connections (warning above ${this.warnAt}): ${JSON.stringify(this.counts())}`);
  }

  write(client, text) {
    if (client.res.destroyed || client.res.writableEnded) {
      this.drop(client);
      return;
    }
    client.res.write(text);
  }

  send(client, event, data) {
    this.write(client, `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  ping() {
    for (const client of this.clients) this.write(client, ': ping\n\n');
  }

  /** Queue a fresh state snapshot for every client. */
  changed() {
    if (this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = null;
      const cache = new Map();
      for (const client of this.clients) {
        const key = client.role === 'guest' ? `guest:${client.guestId}` : client.role;
        if (!cache.has(key)) cache.set(key, this.snapshotFor(client.role, client.guestId));
        this.send(client, 'state', cache.get(key));
      }
    }, this.coalesceMs);
  }

  /** One-off effect (burst, buzzer, confetti) for the given roles. */
  fx(data, roles = ['guest', 'tv', 'host']) {
    for (const client of this.clients) {
      if (roles.includes(client.role)) this.send(client, 'fx', data);
    }
  }

  /** Event for a single guest's phone(s). */
  toGuest(guestId, data) {
    for (const client of this.clients) {
      if (client.role === 'guest' && client.guestId === guestId) this.send(client, 'fx', data);
    }
  }

  count(role) {
    let n = 0;
    for (const client of this.clients) if (client.role === role) n += 1;
    return n;
  }

  /** Open connections by role, plus the total. */
  counts() {
    const out = { total: this.clients.size, guest: 0, tv: 0, host: 0 };
    for (const client of this.clients) out[client.role] += 1;
    return out;
  }

  close() {
    clearInterval(this.heartbeat);
    for (const client of this.clients) client.res.end();
    this.clients.clear();
  }
}

module.exports = { SseHub };
