'use strict';

/**
 * Dev helper: fills a RUNNING party server with 30 demo guests (with party
 * titles), 6 couples and 10 shout-outs, through the normal HTTP API. Use it
 * against a throwaway instance, never the real party data:
 *
 *   DATA_DIR=/tmp/diwali-demo PORT=3400 AI_ENABLED=false npm start
 *   node scripts/seed-demo.js --url http://localhost:3400
 *
 * The host PIN comes from HOST_PIN (env) or the project's .env file.
 */
const fs = require('node:fs');
const path = require('node:path');

const GUEST_COUNT = 30;
const COUPLES = 6;
const SHOUTOUTS = 10;
const NAMES = [
  'Priya', 'Rahul', 'Ananya', 'Vikram', 'Meera', 'Arjun', 'Sana', 'Dev', 'Kavya', 'Rohan',
  'Isha', 'Aditya', 'Neha', 'Karan', 'Pooja', 'Sameer', 'Riya', 'Nikhil', 'Tara', 'Varun',
  'Diya', 'Kabir', 'Aisha', 'Manish', 'Leela', 'Omar', 'Shreya', 'Yash', 'Zara', 'Harsh',
];
const SWEETS = ['ladoo', 'jalebi', 'kaju katli', 'gulab jamun'];
const POWERS = ['teleport', 'invisibility', 'unlimited chai', 'mind reading'];
const ARRIVALS = ['first', 'on time', 'fashionably late', 'after the food'];
const FACTS = ['Has run a marathon', 'Speaks four languages', 'Has visited 22 countries', 'Won a dance-off in college', 'Collects vintage Bollywood posters'];
const TALENTS = ['Juggling', 'Whistling any song', 'Rangoli in 10 minutes', 'Card tricks', 'Mimicry'];
const STICKERS = ['diya', 'sweet', 'dance', 'karaoke', 'plate', 'photo', 'laugh', 'mvp'];

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
}

function hostPin() {
  if (process.env.HOST_PIN) return process.env.HOST_PIN;
  const envFile = path.join(__dirname, '..', '.env');
  const line = fs.existsSync(envFile) && fs.readFileSync(envFile, 'utf8').split('\n').find((l) => l.startsWith('HOST_PIN='));
  if (!line) throw new Error('No HOST_PIN in the environment or .env');
  return line.slice('HOST_PIN='.length).trim();
}

async function main() {
  const base = arg('--url');
  if (!base) throw new Error('Pass the dev server explicitly, e.g. --url http://localhost:3400 (this adds 30 fake guests)');
  const pin = hostPin();
  const call = async (p, body, host = false) => {
    const res = await fetch(base + p, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(host ? { 'x-host-pin': pin } : {}) },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${p} → ${res.status} ${data.error || ''}`);
    return data;
  };

  const ids = [];
  for (let i = 0; i < GUEST_COUNT; i += 1) {
    const { me } = await call('/api/join', {
      id: `guest_demo${String(i).padStart(4, '0')}seed`,
      nickname: NAMES[i % NAMES.length],
      about: {
        funFact: FACTS[i % FACTS.length], talent: TALENTS[(i * 3) % TALENTS.length],
        sweet: SWEETS[i % 4], superpower: POWERS[(i * 7) % 4], arrival: ARRIVALS[Math.floor(i / 4) % 4],
      },
    });
    ids.push(me.id);
    await new Promise((r) => setTimeout(r, 15));
  }
  for (let c = 0; c < COUPLES; c += 1) {
    await call('/api/host/couples/pairs', { a: ids[c * 2], b: ids[c * 2 + 1] }, true).catch((err) => console.warn(`couple ${c}: ${err.message}`));
  }
  for (let s = 0; s < SHOUTOUTS; s += 1) {
    const from = ids[(s * 7 + 3) % GUEST_COUNT];
    const to = ids[(s * 11 + 14) % GUEST_COUNT];
    if (from !== to) await call('/api/shoutouts', { guestId: from, to, sticker: STICKERS[s % STICKERS.length] });
  }
  console.log(`Seeded ${GUEST_COUNT} guests, ${COUPLES} couples and ${SHOUTOUTS} shout-outs into ${base}`);
}

main().catch((err) => {
  console.error('[seed-demo] failed:', err.message);
  process.exit(1);
});
