'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const express = require('express');
const qrcodeTerminal = require('qrcode-terminal');

const ai = require('./lib/ai');
const { lanAddresses } = require('./lib/net');
const { Party, PartyError } = require('./lib/party');
const { partyOverridesFromEnv, seedPartyWithEnv } = require('./lib/party-config');
const { SseHub } = require('./lib/sse');
const { createSystemAudio } = require('./lib/system-audio');
const { Store } = require('./lib/store');
const { publicView, hostView } = require('./lib/views');

const ROOT = __dirname;
const MEDIA_EXT = /\.(mp3|m4a|aac|wav|ogg)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

/** Reads HOST_PIN from .env, or generates one and writes it there so it survives restarts. */
function resolvePin(envFile) {
  if (fs.existsSync(envFile)) require('dotenv').config({ path: envFile });
  if (process.env.HOST_PIN && /^\S{4,32}$/.test(process.env.HOST_PIN)) return { pin: process.env.HOST_PIN, generated: false };
  const pin = String(crypto.randomInt(100000, 1000000));
  fs.appendFileSync(envFile, `${fs.existsSync(envFile) ? '\n' : ''}HOST_PIN=${pin}\n`);
  return { pin, generated: true };
}

function listFiles(dir, pattern) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => pattern.test(f) && !f.startsWith('.')).sort();
}

function prettyName(file) {
  return file.replace(/\.[^.]+$/, '').replace(/^\d+[-_]/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function createApp({ dataDir = path.join(ROOT, 'data'), port = 3000, pin, seed, systemAudio = createSystemAudio(), features, env = process.env } = {}) {
  const photoDir = path.join(dataDir, 'photos');
  const musicDir = path.join(dataDir, 'music');
  fs.mkdirSync(photoDir, { recursive: true });
  fs.mkdirSync(musicDir, { recursive: true });
  const rawSeed = seed || JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'seed.json'), 'utf8'));
  // PARTY_NAME / HOST_NAMES in .env win over the seed (fresh state and resets)
  // and over saved state (so editing .env and restarting takes effect).
  const seedData = { ...rawSeed, party: seedPartyWithEnv(rawSeed.party, env) };
  const store = new Store({ dataDir, seed: seedData });
  const envParty = partyOverridesFromEnv(env);
  if (Object.keys(envParty).length) {
    Object.assign(store.state.settings, envParty);
    store.save();
  }

  const lan = lanAddresses();
  const joinUrl = `http://${lan[0]?.address || 'localhost'}:${port}`;
  const musicTracks = () => listFiles(musicDir, MEDIA_EXT).map((f) => ({ name: prettyName(f), url: `/music/${encodeURIComponent(f)}` }));
  const hostExtra = () => ({
    pin, lanUrls: lan.map((a) => `http://${a.address}:${port}`), ai: ai.status(),
    tracks: musicTracks().length, tvClients: hub.count('tv'), guestClients: hub.count('guest'),
  });

  let party;
  const hub = new SseHub({
    snapshotFor: (role, guestId) => (role === 'host'
      ? hostView(party, { joinUrl, hostExtra })
      : publicView(party, { guestId, joinUrl })),
  });
  // Backdrop swap is hidden unless BACKDROP_ENABLED=true in .env (the code is kept).
  const featureFlags = features || { backdrop: env.BACKDROP_ENABLED === 'true' };
  party = new Party({ store, hub, ai, seed: seedData, photoDir, previewDir: path.join(ai.WORK_DIR, 'previews'), systemAudio, features: featureFlags });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  // --- host auth: PIN on every host request (header, or ?pin= for SSE and <img>)
  const failures = new Map();
  const pinBuf = Buffer.from(String(pin));
  function pinOk(candidate) {
    const buf = Buffer.from(String(candidate || ''));
    return buf.length === pinBuf.length && crypto.timingSafeEqual(buf, pinBuf);
  }
  function requireHost(req, res, next) {
    const ip = req.ip;
    const f = failures.get(ip);
    if (f && f.count >= 20 && Date.now() - f.since < 5 * 60 * 1000) {
      res.status(429).json({ error: 'Too many wrong PINs. Wait five minutes.' });
      return;
    }
    if (pinOk(req.get('x-host-pin') || req.query.pin)) {
      failures.delete(ip);
      next();
      return;
    }
    const entry = f && Date.now() - f.since < 5 * 60 * 1000 ? f : { count: 0, since: Date.now() };
    entry.count += 1;
    failures.set(ip, entry);
    res.status(401).json({ error: 'Wrong PIN' });
  }

  /** Wraps a handler: PartyError → 4xx with a friendly message; anything else → logged 500. */
  const act = (fn) => async (req, res) => {
    try {
      const result = await fn(req, res);
      if (!res.headersSent) res.json(result ?? { ok: true });
    } catch (err) {
      if (err instanceof PartyError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      console.error(`[server] ${req.method} ${req.path} failed:`, err);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  };
  const jpeg = express.raw({ type: ['image/jpeg', 'application/octet-stream'], limit: '15mb' });
  const header = (req, name) => {
    try {
      return decodeURIComponent(req.get(name) || '');
    } catch {
      throw new PartyError(`Bad ${name} header`);
    }
  };

  // --- pages and static files
  const sendPage = (file) => (req, res) => res.sendFile(path.join(ROOT, 'public', file));
  app.get('/', sendPage('index.html'));
  app.get('/tv', sendPage('tv.html'));
  app.get('/host', sendPage('host.html'));
  app.get('/favicon.ico', (req, res) => res.redirect(301, '/props/diya.png'));
  app.use(express.static(path.join(ROOT, 'public'), { maxAge: '1h', index: false }));
  app.use('/music', express.static(musicDir, { maxAge: '1h' }));
  app.get('/photos/:file', (req, res) => {
    const photo = store.state.photos.find((p) => p.file === req.params.file);
    if (!photo || (photo.status !== 'live' && !pinOk(req.query.pin))) {
      res.status(404).end();
      return;
    }
    res.set('Cache-Control', 'public, max-age=86400');
    res.sendFile(path.join(photoDir, photo.file));
  });

  // --- guest + TV API
  app.get('/api/events', (req, res) => {
    const role = ['guest', 'tv', 'host'].includes(req.query.role) ? req.query.role : 'guest';
    if (role === 'host' && !pinOk(req.query.pin)) {
      res.status(401).json({ error: 'Wrong PIN' });
      return;
    }
    hub.attach(req, res, { role, guestId: role === 'guest' ? String(req.query.guestId || '') : null });
  });
  app.get('/api/state', act((req) => publicView(party, { guestId: req.query.guestId ? String(req.query.guestId) : null, joinUrl })));
  app.post('/api/join', act((req) => {
    const g = party.join(req.body || {});
    return { me: publicView(party, { guestId: g.id, joinUrl }).me, team: store.state.teams.find((t) => t.id === g.teamId) };
  }));
  app.post('/api/photos', jpeg, act((req) => {
    const photo = party.addPhoto(header(req, 'x-guest-id'), req.body, header(req, 'x-caption'));
    return { id: photo.id, url: `/photos/${photo.file}`, status: photo.status };
  }));
  app.post('/api/photos/:id/heart', act((req) => party.heart(req.body.guestId, req.params.id)));
  app.post('/api/photos/:id/caption', act((req) => party.editCaption(req.body.guestId, req.params.id, req.body.caption)));
  app.post('/api/caption', jpeg, act((req) => party.suggestCaptions(header(req, 'x-guest-id'), req.body, {
    frame: header(req, 'x-frame'),
    props: header(req, 'x-props').split(',').filter(Boolean),
  })));
  app.post('/api/rounds/:id/answer', act((req) => party.submit(req.body.guestId, req.params.id, req.body.answer)));
  app.post('/api/couples/answer', act((req) => party.answerCouples(req.body.guestId, req.body.questionId, req.body.choice)));
  app.post('/api/shoutouts', act((req) => party.shoutout(req.body.guestId, req.body.to, req.body.sticker)));
  app.get('/api/assets', act(() => {
    const list = (dir, pattern) => listFiles(path.join(ROOT, 'public', dir), pattern)
      .map((f) => ({ id: f.replace(/\.[^.]+$/, ''), name: prettyName(f), url: `/${dir}/${f}` }));
    return { frames: list('frames', /\.png$/i), props: list('props', /\.png$/i), backdrops: list('backdrops', IMAGE_EXT) };
  }));
  app.get('/api/music', act(() => ({ tracks: musicTracks() })));
  app.post('/api/tv/hello', act((req) => party.tvHello(req.body || {})));
  app.post('/api/tv/slideshow/next', act((req) => party.nextSlide(req.body?.from ? String(req.body.from) : null)));

  // --- host API (every route checks the PIN)
  const host = express.Router();
  host.use(requireHost);
  host.post('/login', act(() => ({ ok: true })));
  host.get('/state', act(() => hostView(party, { joinUrl, hostExtra })));
  host.post('/settings', act((req) => party.updateSettings(req.body)));
  host.post('/teams', act((req) => party.addTeam(req.body.name)));
  host.patch('/teams/:id', act((req) => party.renameTeam(req.params.id, req.body.name, req.body.color)));
  host.delete('/teams/:id', act((req) => party.removeTeam(req.params.id)));
  host.post('/guests/:id/move', act((req) => party.moveGuest(req.params.id, req.body.teamId)));
  host.delete('/guests/:id', act((req) => party.removeGuest(req.params.id)));
  host.post('/photos/:id/status', act((req) => party.setPhotoStatus(req.params.id, req.body.status)));
  host.delete('/photos/:id', act((req) => party.deletePhoto(req.params.id)));
  host.post('/award-best-photo', act(() => ({ photoId: party.awardBestPhoto().id })));
  host.post('/score', act((req) => party.adjustScore(req.body.teamId, req.body.points)));
  host.post('/questions/:type', act((req) => party.addQuestion(req.params.type, req.body)));
  host.put('/questions/:type/:id', act((req) => party.updateQuestion(req.params.type, req.params.id, req.body)));
  host.delete('/questions/:type/:id', act((req) => party.deleteQuestion(req.params.type, req.params.id)));
  host.post('/questions/:type/:id/move', act((req) => party.moveQuestion(req.params.type, req.params.id, req.body.delta)));
  host.post('/generate-questions', act(() => party.generatePartyQuestions()));
  host.post('/ai-questions/:id/approve', act((req) => party.approveAiQuestion(req.params.id)));
  host.delete('/ai-questions/:id', act((req) => party.dropAiQuestion(req.params.id)));
  host.post('/round/launch', act((req) => ({ id: party.launchRound(req.body.type, req.body.questionId).id })));
  host.post('/round/next', act((req) => ({ id: party.nextQuestion(req.body.type).id })));
  host.post('/round/timer', act((req) => party.startTimer(req.body.seconds)));
  host.post('/round/close', act(() => party.closeRound()));
  host.post('/round/reveal', act(() => ({ id: party.revealRound().id })));
  host.post('/round/end', act(() => party.endRound()));
  host.post('/couples/pairs', act((req) => party.addPair(req.body.a, req.body.b)));
  host.delete('/couples/pairs/:id', act((req) => party.removePair(req.params.id)));
  host.post('/couples/start', act((req) => party.startCouples(req.body.questionIds)));
  host.post('/couples/reveal-next', act(() => ({ revealIndex: party.revealNextCouples().revealIndex })));
  host.post('/couples/finish', act(() => ({ status: party.finishCouples().status })));
  host.post('/couples/end', act(() => party.endCouples()));
  host.post('/physical/start', act((req) => party.startPhysical(req.body.game, req.body.remaining)));
  host.post('/physical/round', act(() => party.startMusicRound()));
  host.post('/physical/stop', act(() => party.stopMusic('host')));
  host.post('/physical/options', act((req) => party.setPhysicalOptions(req.body)));
  host.post('/physical/next-track', act(() => party.nextTrack()));
  host.post('/physical/eliminate', act((req) => party.eliminate(req.body.delta)));
  host.post('/physical/winner', act((req) => party.physicalWinner(req.body)));
  host.post('/physical/end', act(() => party.endPhysical()));
  host.post('/tv', act((req) => party.setTv(req.body)));
  host.post('/trophy/clear', act(() => party.clearTrophy()));
  host.post('/reset', act((req) => {
    if (req.body.confirm !== 'RESET') throw new PartyError('Type RESET to confirm');
    party.resetEvent();
  }));
  app.use('/api/host', host);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Public on purpose: counts only, no PIN, names or answers.
  app.get('/health', (req, res) => {
    const mem = process.memoryUsage();
    const mb = (n) => Math.round(n / 1048576);
    res.set('Cache-Control', 'no-store').json({
      ok: true,
      uptimeSeconds: Math.round(process.uptime()),
      guests: Object.keys(store.state.guests).length,
      photos: store.state.photos.length,
      sse: hub.counts(),
      memoryMb: { rss: mb(mem.rss), heapUsed: mb(mem.heapUsed), heapTotal: mb(mem.heapTotal) },
    });
  });

  // Last resort for anything thrown outside act() (bad JSON body, oversized upload, a
  // bug in middleware): answer that one request and keep serving everyone else.
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(`[server] ${req.method} ${req.path} failed:`, err);
    if (res.headersSent) {
      next(err);
      return;
    }
    res.status(status).json({ error: status >= 500 ? 'Something went wrong. Please try again.' : err.message });
  });

  return { app, party, store, hub, joinUrl, lan };
}

function main() {
  const port = Number(process.env.PORT || 3000);
  const { pin, generated } = resolvePin(path.join(ROOT, '.env'));
  const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
  const { app, store, hub, joinUrl, lan } = createApp({ dataDir, port, pin });
  const server = app.listen(port, '0.0.0.0', () => {
    const line = '─'.repeat(56);
    console.log(`\n🪔  Diwali Party Hub is running\n${line}`);
    console.log(`  Guests join at:   ${joinUrl}`);
    for (const a of lan.slice(1)) console.log(`  (also reachable): http://${a.address}:${port}   [${a.name}]`);
    console.log(`  TV screen:        http://localhost:${port}/tv`);
    console.log(`  Host dashboard:   http://localhost:${port}/host`);
    console.log(`  Host PIN:         ${pin}${generated ? '   (new, saved to .env)' : '   (from .env)'}`);
    if (pin === 'changeme') console.log('  ⚠️  HOST_PIN is still "changeme". Set your own PIN in .env before the party.');
    console.log(line);
    qrcodeTerminal.generate(joinUrl, { small: true }, (qr) => console.log(`${qr}\n  Scan to join: ${joinUrl}\n`));
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') console.error(`Port ${port} is busy. Is the party hub already running? Try PORT=3001 npm start`);
    else console.error('[server] failed to start:', err);
    process.exit(1);
  });
  // Browsers (TV, phones) hold keep-alive and SSE sockets open, which would
  // keep server.close() waiting; drop them explicitly so a stop is immediate.
  const shutdown = () => {
    store.flush();
    hub.close();
    server.close(() => process.exit(0));
    server.closeAllConnections();
    setTimeout(() => process.exit(0), 1000);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // One bad async path (an AI reply, a timer) must not end the party for everyone.
  process.on('unhandledRejection', (reason) => console.error('[server] unhandled promise rejection:', reason));
  process.on('uncaughtException', (err) => console.error('[server] uncaught exception (still running):', err));
}

if (require.main === module) main();

module.exports = { createApp };
