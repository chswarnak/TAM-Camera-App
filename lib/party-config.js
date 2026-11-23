'use strict';

/**
 * The party name and host names come from .env (PARTY_NAME, HOST_NAMES) so the
 * code and data/seed.json carry no family names. Whatever .env sets wins over
 * the seed and over saved state at every start; the host dashboard's Setup tab
 * can still change them for the current run.
 *
 * Limits match Party#updateSettings: name up to 40 characters, up to 8 hosts
 * of up to 24 characters each.
 */

const NAME_MAX = 40;
const HOST_MAX = 24;
const HOSTS_MAX = 8;

function trimTo(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** "Asha, Ravi & Tara" or "Asha,Ravi" → ['Asha', 'Ravi', 'Tara']. */
function splitHostNames(value) {
  return String(value ?? '')
    .split(/,|&/)
    .map((h) => trimTo(h, HOST_MAX))
    .filter(Boolean)
    .slice(0, HOSTS_MAX);
}

/** Returns only the settings that .env actually sets: { partyName?, hosts? }. */
function partyOverridesFromEnv(env = process.env) {
  const overrides = {};
  const partyName = trimTo(env.PARTY_NAME, NAME_MAX);
  if (partyName) overrides.partyName = partyName;
  const hosts = splitHostNames(env.HOST_NAMES);
  if (hosts.length) overrides.hosts = hosts;
  return overrides;
}

/** The seed's `party` block with .env values applied. */
function seedPartyWithEnv(seedParty, env = process.env) {
  const { partyName, hosts } = partyOverridesFromEnv(env);
  return { name: partyName || seedParty.name, hosts: hosts || [...seedParty.hosts] };
}

module.exports = { partyOverridesFromEnv, seedPartyWithEnv, splitHostNames };
