'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { partyOverridesFromEnv, seedPartyWithEnv, splitHostNames } = require('../lib/party-config');
const { createApp } = require('../server');
const { publicView } = require('../lib/views');
const { SEED, fakeSystemAudio, tempDir } = require('./helpers');

test('seed.json ships placeholders only', () => {
  assert.deepEqual(SEED.party, { name: 'Diwali Night', hosts: ['Your Family'] });
  assert.deepEqual(SEED.guessWho, []);
});

test('HOST_NAMES splits on commas and ampersands, trims, and caps length and count', () => {
  assert.deepEqual(splitHostNames('Asha, Ravi & Tara'), ['Asha', 'Ravi', 'Tara']);
  assert.deepEqual(splitHostNames('  Your Family  '), ['Your Family']);
  assert.deepEqual(splitHostNames(',, ,'), []);
  assert.equal(splitHostNames('x'.repeat(50))[0].length, 24);
  assert.equal(splitHostNames(Array.from({ length: 12 }, (_, i) => `H${i}`).join(',')).length, 8);
});

test('only the values .env sets are overridden', () => {
  assert.deepEqual(partyOverridesFromEnv({}), {});
  assert.deepEqual(partyOverridesFromEnv({ PARTY_NAME: '  Lights Out  ' }), { partyName: 'Lights Out' });
  assert.deepEqual(seedPartyWithEnv(SEED.party, { HOST_NAMES: 'Asha & Ravi' }), { name: 'Diwali Night', hosts: ['Asha', 'Ravi'] });
});

test('.env names reach the welcome line, win over saved state, and survive a reset', () => {
  const dataDir = tempDir();
  const boot = (env) => createApp({ dataDir, port: 0, pin: '424242', systemAudio: fakeSystemAudio(), features: { backdrop: false }, env });

  let ctx = boot({});
  assert.equal(publicView(ctx.party).party.welcomeLine, 'Your Family welcome you to Diwali Night');
  ctx.store.flush();
  ctx.hub.close();

  ctx = boot({ PARTY_NAME: 'Festival of Lights', HOST_NAMES: 'Asha, Ravi & Tara' });
  assert.equal(publicView(ctx.party).party.welcomeLine, 'Asha, Ravi & Tara welcome you to Festival of Lights');
  assert.equal(publicView(ctx.party).party.name, 'Festival of Lights');
  ctx.party.resetEvent();
  assert.deepEqual(ctx.store.state.settings.hosts, ['Asha', 'Ravi', 'Tara']);
  ctx.store.flush();
  ctx.hub.close();
});
