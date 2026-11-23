'use strict';

const os = require('node:os');

/**
 * IPv4 LAN addresses, best guess first: Wi-Fi/Ethernet (en*) and private
 * ranges before VPN/bridge interfaces.
 */
function lanAddresses() {
  const found = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const isPrivate = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address);
      const score = (name.startsWith('en') ? 0 : 2) + (isPrivate ? 0 : 1) + (/^(utun|bridge|vmnet|docker)/.test(name) ? 4 : 0);
      found.push({ name, address: a.address, score });
    }
  }
  return found.sort((x, y) => x.score - y.score).map(({ name, address }) => ({ name, address }));
}

module.exports = { lanAddresses };
