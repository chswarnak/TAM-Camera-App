'use strict';

/**
 * Generates every bundled image and the placeholder music loop locally, so the
 * app needs no downloads at party time. Run with `npm run assets` (needs the
 * dev dependencies `sharp` and `lamejs`). Outputs are committed, so a normal
 * `npm start` never runs this.
 *
 * Frames are 2000×2000 PNGs designed for 9-slice drawing: the outer 500 px
 * corners hold the ornaments; edges contain only bands parallel to the edge,
 * so the editor can stretch them to any photo shape without distortion.
 */
const fs = require('node:fs');
const path = require('node:path');

const sharp = require('sharp');

// lamejs' CommonJS entry is broken ("MPEGMode is not defined"); its self-contained bundle works.
const lamejs = new Function(`${fs.readFileSync(require.resolve('lamejs/lame.all.js'), 'utf8')}; return lamejs;`)();

const ROOT = path.join(__dirname, '..');
const out = (...p) => path.join(ROOT, ...p);

let seedValue = 7;
const rand = () => {
  seedValue = (seedValue * 16807) % 2147483647;
  return seedValue / 2147483647;
};

const GOLD = '#D4A017';
const GOLD_LIGHT = '#F3D27A';
const BURGUNDY = '#6B1E2E';
const MARIGOLD = '#F59E0B';
const PINK = '#E0457B';
const GREEN = '#2E9E5B';

const svg = (w, h, body, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs}</defs>${body}</svg>`;

/** Draws a corner ornament (in the top-left 500×500) into all four corners by mirroring. */
const fourCorners = (corner) => [
  `<g>${corner}</g>`,
  `<g transform="translate(2000,0) scale(-1,1)">${corner}</g>`,
  `<g transform="translate(0,2000) scale(1,-1)">${corner}</g>`,
  `<g transform="translate(2000,2000) scale(-1,-1)">${corner}</g>`,
].join('');

// ------------------------------------------------------------------ shared shapes

function diyaShape(cx, cy, s, id = 'd') {
  return `
  <g transform="translate(${cx},${cy}) scale(${s})">
    <ellipse cx="0" cy="-58" rx="70" ry="95" fill="url(#glow-${id})"/>
    <path d="M0,-118 C22,-82 26,-52 0,-28 C-26,-52 -22,-82 0,-118 Z" fill="url(#flame-${id})"/>
    <path d="M0,-92 C9,-72 10,-56 0,-42 C-10,-56 -9,-72 0,-92 Z" fill="#FFF4C2"/>
    <path d="M-92,-22 C-70,40 70,40 92,-22 Z" fill="#B5471B"/>
    <path d="M-92,-22 C-60,-6 60,-6 92,-22 C70,-34 -70,-34 -92,-22 Z" fill="#7A2810"/>
    <path d="M-80,-6 C-50,26 50,26 80,-6" fill="none" stroke="${GOLD}" stroke-width="7"/>
    <circle cx="-40" cy="8" r="6" fill="${GOLD_LIGHT}"/><circle cx="0" cy="14" r="6" fill="${GOLD_LIGHT}"/><circle cx="40" cy="8" r="6" fill="${GOLD_LIGHT}"/>
  </g>`;
}

function diyaDefs(id = 'd') {
  return `
  <radialGradient id="glow-${id}"><stop offset="0" stop-color="#FFD54F" stop-opacity="0.75"/><stop offset="1" stop-color="#FFD54F" stop-opacity="0"/></radialGradient>
  <linearGradient id="flame-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF59D"/><stop offset="0.6" stop-color="#FFB300"/><stop offset="1" stop-color="#E65100"/></linearGradient>`;
}

function marigold(cx, cy, r) {
  const petals = [];
  for (let ring = 0; ring < 3; ring += 1) {
    const rr = r * (1 - ring * 0.28);
    const n = 14 - ring * 3;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2 + ring * 0.3;
      petals.push(`<circle cx="${(cx + Math.cos(a) * rr * 0.62).toFixed(1)}" cy="${(cy + Math.sin(a) * rr * 0.62).toFixed(1)}" r="${(rr * 0.42).toFixed(1)}" fill="${ring === 0 ? '#E67E00' : ring === 1 ? MARIGOLD : '#FFC93C'}"/>`);
    }
  }
  return `${petals.join('')}<circle cx="${cx}" cy="${cy}" r="${r * 0.22}" fill="#C25700"/>`;
}

function mandala(cx, cy, r, colors) {
  const parts = [];
  colors.forEach((color, ring) => {
    const rr = r * (1 - ring / colors.length);
    const n = 8 + ring * 4;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * 360;
      parts.push(`<ellipse cx="${cx}" cy="${cy - rr * 0.62}" rx="${rr * 0.17}" ry="${rr * 0.38}" fill="${color}" transform="rotate(${a} ${cx} ${cy})"/>`);
    }
  });
  parts.push(`<circle cx="${cx}" cy="${cy}" r="${r * 0.16}" fill="${GOLD}"/><circle cx="${cx}" cy="${cy}" r="${r * 0.08}" fill="#fff"/>`);
  return parts.join('');
}

function burst(cx, cy, r, color, rays = 18) {
  const lines = [];
  for (let i = 0; i < rays; i += 1) {
    const a = (i / rays) * Math.PI * 2;
    const x1 = cx + Math.cos(a) * r * 0.25;
    const y1 = cy + Math.sin(a) * r * 0.25;
    const x2 = cx + Math.cos(a) * r;
    const y2 = cy + Math.sin(a) * r;
    lines.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="${(r / 28).toFixed(1)}" stroke-linecap="round"/>`);
    lines.push(`<circle cx="${(cx + Math.cos(a) * r * 1.12).toFixed(1)}" cy="${(cy + Math.sin(a) * r * 1.12).toFixed(1)}" r="${(r / 22).toFixed(1)}" fill="${color}"/>`);
  }
  return `<g>${lines.join('')}<circle cx="${cx}" cy="${cy}" r="${r / 10}" fill="#fff"/></g>`;
}

function star(cx, cy, r, color) {
  return `<path d="M${cx},${cy - r} L${cx + r * 0.25},${cy - r * 0.25} L${cx + r},${cy} L${cx + r * 0.25},${cy + r * 0.25} L${cx},${cy + r} L${cx - r * 0.25},${cy + r * 0.25} L${cx - r},${cy} L${cx - r * 0.25},${cy - r * 0.25} Z" fill="${color}"/>`;
}

// ------------------------------------------------------------------ frames

function diyaBorderFrame() {
  const band = `
    <rect x="0" y="0" width="2000" height="2000" fill="none" stroke="${BURGUNDY}" stroke-width="150"/>
    <rect x="62" y="62" width="1876" height="1876" fill="none" stroke="${GOLD}" stroke-width="14"/>
    <rect x="22" y="22" width="1956" height="1956" fill="none" stroke="${GOLD_LIGHT}" stroke-width="5"/>
    <rect x="88" y="88" width="1824" height="1824" fill="none" stroke="${MARIGOLD}" stroke-width="6"/>`;
  const corner = `
    <path d="M0,0 H330 C250,40 190,80 160,160 C80,190 40,250 0,330 Z" fill="${BURGUNDY}"/>
    <path d="M75,330 C90,210 210,90 330,75" fill="none" stroke="${GOLD}" stroke-width="10"/>
    <circle cx="150" cy="150" r="118" fill="${BURGUNDY}" stroke="${GOLD}" stroke-width="12"/>
    ${diyaShape(150, 192, 1.05, 'fd')}
    <g>${marigold(330, 75, 34)}</g><g>${marigold(75, 330, 34)}</g>`;
  return svg(2000, 2000, band + fourCorners(corner), diyaDefs('fd'));
}

function rangoliCornersFrame() {
  const edge = `<rect x="30" y="30" width="1940" height="1940" fill="none" stroke="${GOLD}" stroke-width="10" stroke-opacity="0.9"/>
    <rect x="50" y="50" width="1900" height="1900" fill="none" stroke="${PINK}" stroke-width="5" stroke-opacity="0.8"/>`;
  const corner = `
    <g clip-path="url(#corner-clip)">${mandala(0, 0, 430, [PINK, MARIGOLD, GREEN, GOLD, '#8E44AD', '#FFFFFF'])}</g>
    <circle cx="0" cy="0" r="440" fill="none" stroke="${GOLD}" stroke-width="10"/>
    <circle cx="300" cy="420" r="16" fill="${PINK}"/><circle cx="420" cy="300" r="16" fill="${PINK}"/>
    <circle cx="350" cy="455" r="10" fill="${GOLD}"/><circle cx="455" cy="350" r="10" fill="${GOLD}"/>`;
  return svg(2000, 2000, edge + fourCorners(corner), '<clipPath id="corner-clip"><rect x="0" y="0" width="500" height="500"/></clipPath>');
}

function fireworksFrame() {
  const defs = `
    <linearGradient id="fade-top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0B0A2A" stop-opacity="0.92"/><stop offset="1" stop-color="#0B0A2A" stop-opacity="0"/></linearGradient>
    <linearGradient id="fade-left" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0B0A2A" stop-opacity="0.92"/><stop offset="1" stop-color="#0B0A2A" stop-opacity="0"/></linearGradient>`;
  const edges = `
    <rect x="0" y="0" width="2000" height="190" fill="url(#fade-top)"/>
    <rect x="0" y="1810" width="2000" height="190" fill="url(#fade-top)" transform="rotate(180 1000 1905)"/>
    <rect x="0" y="0" width="190" height="2000" fill="url(#fade-left)"/>
    <rect x="1810" y="0" width="190" height="2000" fill="url(#fade-left)" transform="rotate(180 1905 1000)"/>
    <rect x="18" y="18" width="1964" height="1964" fill="none" stroke="${GOLD}" stroke-width="8"/>`;
  const corner = `
    <path d="M0,0 H500 V140 C300,150 150,300 140,500 H0 Z" fill="#0B0A2A" fill-opacity="0.9"/>
    ${burst(170, 160, 120, GOLD_LIGHT, 20)}
    ${burst(360, 90, 62, PINK, 14)}
    ${burst(85, 370, 58, '#4DD0E1', 14)}
    ${star(300, 230, 18, '#fff')}${star(220, 330, 12, GOLD_LIGHT)}${star(430, 40, 10, '#fff')}${star(40, 450, 10, '#fff')}`;
  return svg(2000, 2000, edges + fourCorners(corner), defs);
}

// ------------------------------------------------------------------ props (512×512)

const PROPS = {
  crown: () => svg(512, 512, `
    <path d="M56,360 L80,150 L180,270 L256,110 L332,270 L432,150 L456,360 Z" fill="url(#gold)" stroke="#8C6508" stroke-width="10" stroke-linejoin="round"/>
    <rect x="56" y="350" width="400" height="70" rx="14" fill="url(#gold)" stroke="#8C6508" stroke-width="10"/>
    <circle cx="80" cy="140" r="24" fill="${PINK}" stroke="#8C6508" stroke-width="6"/><circle cx="256" cy="98" r="28" fill="#2E86DE" stroke="#8C6508" stroke-width="6"/><circle cx="432" cy="140" r="24" fill="${PINK}" stroke="#8C6508" stroke-width="6"/>
    <circle cx="150" cy="385" r="18" fill="${GREEN}"/><circle cx="256" cy="385" r="22" fill="#C0392B"/><circle cx="362" cy="385" r="18" fill="${GREEN}"/>`,
  `<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE38A"/><stop offset="1" stop-color="${GOLD}"/></linearGradient>`),
  sunglasses: () => svg(512, 512, `
    <path d="M40,200 H472" stroke="#1B1B1B" stroke-width="22" stroke-linecap="round"/>
    <path d="M58,200 H226 C226,300 196,340 140,340 C84,340 58,300 58,200 Z" fill="url(#lens)" stroke="${GOLD}" stroke-width="12"/>
    <path d="M286,200 H454 C454,300 428,340 372,340 C316,340 286,300 286,200 Z" fill="url(#lens)" stroke="${GOLD}" stroke-width="12"/>
    <path d="M226,214 C240,196 272,196 286,214" fill="none" stroke="${GOLD}" stroke-width="12"/>
    <path d="M90,226 L150,226 L110,300 Z" fill="#fff" fill-opacity="0.35"/><path d="M318,226 L378,226 L338,300 Z" fill="#fff" fill-opacity="0.35"/>`,
  `<linearGradient id="lens" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3A1C71"/><stop offset="1" stop-color="#111"/></linearGradient>`),
  moustache: () => svg(512, 512, `
    <path d="M256,230 C220,190 160,190 120,230 C90,262 60,270 30,250 C40,310 100,340 160,320 C210,304 240,280 256,262 C272,280 302,304 352,320 C412,340 472,310 482,250 C452,270 422,262 392,230 C352,190 292,190 256,230 Z" fill="#2B1810"/>
    <path d="M30,250 C14,236 18,214 36,212" fill="none" stroke="#2B1810" stroke-width="16" stroke-linecap="round"/>
    <path d="M482,250 C498,236 494,214 476,212" fill="none" stroke="#2B1810" stroke-width="16" stroke-linecap="round"/>
    <path d="M140,236 C170,222 210,226 240,246" fill="none" stroke="#5A3A2A" stroke-width="6" stroke-linecap="round"/>`),
  diya: () => svg(512, 512, diyaShape(256, 340, 2.2, 'p'), diyaDefs('p')),
  sparkler: () => svg(512, 512, `
    <line x1="140" y1="470" x2="300" y2="210" stroke="#7F8C8D" stroke-width="12" stroke-linecap="round"/>
    <line x1="230" y1="324" x2="300" y2="210" stroke="#4E342E" stroke-width="20" stroke-linecap="round"/>
    <circle cx="310" cy="195" r="70" fill="url(#spark)"/>
    ${burst(310, 195, 150, '#FFE082', 24)}
    ${star(420, 90, 22, '#fff')}${star(200, 120, 14, '#FFF59D')}${star(440, 260, 12, '#FFF59D')}${star(360, 60, 10, '#fff')}`,
  '<radialGradient id="spark"><stop offset="0" stop-color="#fff"/><stop offset="0.5" stop-color="#FFE082" stop-opacity="0.9"/><stop offset="1" stop-color="#FFB300" stop-opacity="0"/></radialGradient>'),
  'marigold-garland': () => {
    const flowers = [];
    for (let i = 0; i <= 10; i += 1) {
      const t = i / 10;
      const x = 40 + t * 432;
      const y = 120 + Math.sin(t * Math.PI) * 220;
      flowers.push(`<g>${marigold(x, y, 36)}</g>`);
      if (i % 2 === 0) flowers.push(`<path d="M${x - 10},${y + 40} q10,30 0,60 q10,-10 20,0 q-10,-30 0,-60 Z" fill="${GREEN}"/>`);
    }
    return svg(512, 512, `<path d="M40,120 Q256,560 472,120" fill="none" stroke="#7B5E2F" stroke-width="5"/>${flowers.join('')}`);
  },
  'happy-diwali-badge': () => {
    const scallops = [];
    for (let i = 0; i < 24; i += 1) {
      const a = (i / 24) * Math.PI * 2;
      scallops.push(`<circle cx="${(256 + Math.cos(a) * 205).toFixed(1)}" cy="${(256 + Math.sin(a) * 205).toFixed(1)}" r="36" fill="${GOLD}"/>`);
    }
    return svg(512, 512, `${scallops.join('')}
      <circle cx="256" cy="256" r="205" fill="${GOLD}"/>
      <circle cx="256" cy="256" r="180" fill="${BURGUNDY}" stroke="${GOLD_LIGHT}" stroke-width="8"/>
      <circle cx="256" cy="256" r="160" fill="none" stroke="${GOLD}" stroke-width="3" stroke-dasharray="6 10"/>
      <text x="256" y="236" text-anchor="middle" font-family="Georgia, serif" font-weight="bold" font-size="74" fill="${GOLD_LIGHT}">Happy</text>
      <text x="256" y="318" text-anchor="middle" font-family="Georgia, serif" font-weight="bold" font-size="74" fill="${GOLD_LIGHT}">Diwali</text>
      ${diyaShape(256, 384, 0.42, 'b')}`, diyaDefs('b'));
  },
};

// ------------------------------------------------------------------ backdrops (2400×1600)

function rangoliCourtyard() {
  const tiles = [];
  for (let x = 0; x < 2400; x += 160) tiles.push(`<line x1="${x}" y1="1000" x2="${(x - 1200) * 1.8 + 1200}" y2="1600" stroke="#9C4A1E" stroke-width="3" stroke-opacity="0.35"/>`);
  const arches = [];
  for (let i = 0; i < 5; i += 1) {
    const x = 120 + i * 470;
    arches.push(`<path d="M${x},1000 V420 Q${x + 160},230 ${x + 320},420 V1000 Z" fill="#5A1422"/><path d="M${x + 20},1000 V430 Q${x + 160},260 ${x + 300},430 V1000" fill="none" stroke="${GOLD}" stroke-width="10"/>`);
  }
  const lamps = [];
  for (let i = 0; i < 9; i += 1) lamps.push(diyaShape(260 + i * 235, 1500 - Math.abs(i - 4) * 18, 0.8, 'bd'));
  return svg(2400, 1600, `
    <rect width="2400" height="1000" fill="url(#wall)"/>${arches.join('')}
    <rect y="1000" width="2400" height="600" fill="url(#floor)"/>${tiles.join('')}
    <g transform="translate(1200,1260) scale(1,0.42)">${mandala(0, 0, 520, [PINK, MARIGOLD, GREEN, GOLD, '#8E44AD', '#fff'])}</g>
    ${lamps.join('')}
    <path d="M0,40 Q600,200 1200,40 Q1800,200 2400,40" fill="none" stroke="#7B5E2F" stroke-width="4"/>
    ${Array.from({ length: 21 }, (_, i) => { const x = i * 120; const y = 40 + Math.sin((i % 10) / 10 * Math.PI) * 160; return marigold(x, y, 30); }).join('')}`,
  `<linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E9A23B"/><stop offset="1" stop-color="#C96F2A"/></linearGradient>
   <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C97B4A"/><stop offset="1" stop-color="#8E4A26"/></linearGradient>${diyaDefs('bd')}`);
}

function palaceBalcony() {
  const stars = Array.from({ length: 140 }, () => `<circle cx="${(rand() * 2400).toFixed(0)}" cy="${(rand() * 700).toFixed(0)}" r="${(1 + rand() * 3).toFixed(1)}" fill="#fff" fill-opacity="${(0.4 + rand() * 0.6).toFixed(2)}"/>`).join('');
  const domes = [[300, 760, 180], [800, 700, 240], [1500, 720, 220], [2050, 770, 170]].map(([x, y, r]) => `<path d="M${x - r},${y + 300} V${y} Q${x},${y - r * 1.5} ${x + r},${y} V${y + 300} Z" fill="#1C0D2E"/><line x1="${x}" y1="${y - r * 1.15}" x2="${x}" y2="${y - r * 1.5}" stroke="#1C0D2E" stroke-width="10"/>`).join('');
  const lights = [];
  for (let row = 0; row < 3; row += 1) {
    for (let i = 0; i <= 40; i += 1) {
      const x = i * 60;
      const y = 120 + row * 70 + Math.sin((i / 40) * Math.PI) * 120;
      lights.push(`<circle cx="${x}" cy="${y.toFixed(0)}" r="9" fill="${[GOLD_LIGHT, '#FFB74D', '#FFF59D'][(i + row) % 3]}"/><circle cx="${x}" cy="${y.toFixed(0)}" r="22" fill="#FFD54F" fill-opacity="0.18"/>`);
    }
  }
  const pillars = Array.from({ length: 13 }, (_, i) => `<rect x="${60 + i * 185}" y="1280" width="44" height="200" rx="14" fill="#E8D3B0"/><circle cx="${82 + i * 185}" cy="1270" r="28" fill="#E8D3B0"/>`).join('');
  return svg(2400, 1600, `
    <rect width="2400" height="1600" fill="url(#night)"/>${stars}
    <circle cx="1950" cy="260" r="110" fill="#FFF3D6"/><circle cx="1990" cy="240" r="110" fill="url(#night)" fill-opacity="0.0"/>
    ${domes}<rect y="1000" width="2400" height="260" fill="#160A24"/>
    ${Array.from({ length: 40 }, (_, i) => `<rect x="${30 + i * 60}" y="${1040 + (i % 3) * 50}" width="22" height="30" fill="#FFCA28" fill-opacity="${(0.4 + rand() * 0.5).toFixed(2)}"/>`).join('')}
    <rect y="1230" width="2400" height="50" fill="#F2E3C6"/>${pillars}<rect y="1480" width="2400" height="120" fill="#D9C29A"/>
    ${lights.join('')}`,
  '<linearGradient id="night" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0A0A2E"/><stop offset="0.7" stop-color="#3B1450"/><stop offset="1" stop-color="#6B1E2E"/></linearGradient>');
}

function fireworksSky() {
  const colors = [GOLD_LIGHT, PINK, '#4DD0E1', '#AED581', '#FF8A65', '#fff'];
  const bursts = Array.from({ length: 11 }, () => burst(150 + rand() * 2100, 120 + rand() * 750, 90 + rand() * 170, colors[Math.floor(rand() * colors.length)], 16 + Math.floor(rand() * 12))).join('');
  const stars = Array.from({ length: 120 }, () => `<circle cx="${(rand() * 2400).toFixed(0)}" cy="${(rand() * 1100).toFixed(0)}" r="${(1 + rand() * 2.5).toFixed(1)}" fill="#fff" fill-opacity="${(0.3 + rand() * 0.6).toFixed(2)}"/>`).join('');
  let skyline = 'M0,1600 V1250';
  for (let x = 0; x < 2400; x += 80) skyline += ` H${x} V${(1100 + rand() * 220).toFixed(0)} H${x + 80}`;
  skyline += ' V1600 Z';
  return svg(2400, 1600, `<rect width="2400" height="1600" fill="url(#sky)"/>${stars}${bursts}<path d="${skyline}" fill="#120818"/>
    ${Array.from({ length: 70 }, () => `<rect x="${(rand() * 2380).toFixed(0)}" y="${(1300 + rand() * 260).toFixed(0)}" width="14" height="18" fill="#FFCA28" fill-opacity="0.75"/>`).join('')}`,
  '<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#05051F"/><stop offset="0.75" stop-color="#2A0F3D"/><stop offset="1" stop-color="#5B1A2E"/></linearGradient>');
}

function goldenBokeh() {
  const dots = Array.from({ length: 70 }, () => {
    const r = 30 + rand() * 140;
    return `<circle cx="${(rand() * 2400).toFixed(0)}" cy="${(rand() * 1600).toFixed(0)}" r="${r.toFixed(0)}" fill="${['#FFE082', '#FFD54F', '#FFB74D', '#FFF8E1'][Math.floor(rand() * 4)]}" fill-opacity="${(0.15 + rand() * 0.4).toFixed(2)}"/>`;
  }).join('');
  return svg(2400, 1600, `<rect width="2400" height="1600" fill="url(#warm)"/><g filter="url(#blur)">${dots}</g>`,
    `<radialGradient id="warm" cx="0.5" cy="0.45" r="0.8"><stop offset="0" stop-color="#C77D1A"/><stop offset="0.6" stop-color="#7A3B12"/><stop offset="1" stop-color="#3E0F1A"/></radialGradient>
     <filter id="blur" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="14"/></filter>`);
}

// ------------------------------------------------------------------ sample party photo (tests + vision check)

function samplePhoto() {
  const person = (x, shirt, skin) => `
    <ellipse cx="${x}" cy="1180" rx="190" ry="260" fill="${shirt}"/>
    <circle cx="${x}" cy="760" r="150" fill="${skin}"/>
    <path d="M${x - 150},740 Q${x},560 ${x + 150},740 Q${x + 120},640 ${x},630 Q${x - 120},640 ${x - 150},740 Z" fill="#1E120C"/>
    <circle cx="${x - 50}" cy="770" r="14" fill="#1E120C"/><circle cx="${x + 50}" cy="770" r="14" fill="#1E120C"/>
    <path d="M${x - 60},840 Q${x},900 ${x + 60},840" fill="none" stroke="#7A2E1E" stroke-width="12" stroke-linecap="round"/>`;
  return svg(1600, 1200, `
    <rect width="1600" height="1200" fill="#F7F4EE"/>
    ${person(520, '#C2185B', '#C68B59')}${person(1080, '#1565C0', '#A86B45')}
    <g transform="translate(330,470) scale(0.75)">${PROPS.crown().replace(/^<svg[^>]*>|<\/svg>$/g, '').replace(/<defs>.*?<\/defs>/s, '')}</g>
    <g transform="translate(890,610) scale(0.75)">${PROPS.sunglasses().replace(/^<svg[^>]*>|<\/svg>$/g, '').replace(/<defs>.*?<\/defs>/s, '')}</g>
    ${diyaShape(800, 1120, 1.3, 's')}`,
  `<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE38A"/><stop offset="1" stop-color="${GOLD}"/></linearGradient>
   <linearGradient id="lens" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3A1C71"/><stop offset="1" stop-color="#111"/></linearGradient>${diyaDefs('s')}`);
}

// ------------------------------------------------------------------ placeholder music (10 s loop, 120 bpm, original)

function synthLoop() {
  const RATE = 44100;
  const SECONDS = 10;
  const n = RATE * SECONDS;
  const buf = new Float32Array(n);
  const beat = 0.5;
  const add = (start, dur, fn) => {
    const s0 = Math.floor(start * RATE);
    const len = Math.floor(dur * RATE);
    for (let i = 0; i < len && s0 + i < n; i += 1) buf[s0 + i] += fn(i / RATE);
  };
  const hz = (semi) => 261.63 * 2 ** (semi / 12);
  // tanpura-style drone on Sa and Pa
  for (let i = 0; i < n; i += 1) {
    const t = i / RATE;
    buf[i] += 0.05 * (Math.sin(2 * Math.PI * 130.81 * t) + 0.5 * Math.sin(2 * Math.PI * 196 * t) + 0.25 * Math.sin(2 * Math.PI * 261.63 * t));
  }
  // dholak-ish groove: "dha" (pitched thump) and "na" (short bright tap)
  for (let b = 0; b < SECONDS / beat; b += 1) {
    const t0 = b * beat;
    add(t0, 0.35, (t) => 0.55 * Math.sin(2 * Math.PI * (70 + 90 * Math.exp(-t * 18)) * t) * Math.exp(-t * 9));
    add(t0 + beat / 2, 0.12, (t) => 0.22 * Math.sin(2 * Math.PI * 820 * t) * Math.exp(-t * 40) + 0.08 * (rand() * 2 - 1) * Math.exp(-t * 60));
    if (b % 4 === 3) add(t0 + beat * 0.75, 0.1, (t) => 0.18 * Math.sin(2 * Math.PI * 640 * t) * Math.exp(-t * 45));
  }
  // cheerful melody in a major pentatonic (Sa Re Ga Pa Dha)
  const melody = [0, 4, 7, 9, 7, 4, 2, 4, 7, 12, 9, 7, 4, 2, 0, 2, 4, 7, 4, 0];
  melody.forEach((semi, i) => {
    add(i * beat, beat * 0.95, (t) => {
      const env = Math.min(1, t * 40) * Math.exp(-t * 3.2);
      const f = hz(semi + 12);
      return 0.16 * env * (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(4 * Math.PI * f * t) + 0.15 * Math.sin(6 * Math.PI * f * t));
    });
  });
  // gentle fade at both ends so the loop joins cleanly
  for (let i = 0; i < RATE * 0.02; i += 1) {
    buf[i] *= i / (RATE * 0.02);
    buf[n - 1 - i] *= i / (RATE * 0.02);
  }
  const peak = buf.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const pcm = Int16Array.from(buf, (v) => Math.round((v / peak) * 0.89 * 32767));
  const encoder = new lamejs.Mp3Encoder(1, RATE, 128);
  const chunks = [];
  for (let i = 0; i < pcm.length; i += 1152) {
    const mp3 = encoder.encodeBuffer(pcm.subarray(i, i + 1152));
    if (mp3.length) chunks.push(Buffer.from(mp3));
  }
  chunks.push(Buffer.from(encoder.flush()));
  return Buffer.concat(chunks);
}

// ------------------------------------------------------------------ main

async function main() {
  for (const dir of ['public/frames', 'public/props', 'public/backdrops', 'data/music', 'test/fixtures']) fs.mkdirSync(out(dir), { recursive: true });
  const frames = { 'diya-border': diyaBorderFrame, 'rangoli-corners': rangoliCornersFrame, 'fireworks-night': fireworksFrame };
  for (const [name, make] of Object.entries(frames)) await sharp(Buffer.from(make())).png({ compressionLevel: 9 }).toFile(out('public/frames', `${name}.png`));
  for (const [name, make] of Object.entries(PROPS)) await sharp(Buffer.from(make())).png({ compressionLevel: 9 }).toFile(out('public/props', `${name}.png`));
  const backdrops = { 'rangoli-courtyard': rangoliCourtyard, 'palace-balcony-at-night': palaceBalcony, 'fireworks-sky': fireworksSky, 'golden-bokeh': goldenBokeh };
  for (const [name, make] of Object.entries(backdrops)) await sharp(Buffer.from(make())).jpeg({ quality: 86, mozjpeg: true }).toFile(out('public/backdrops', `${name}.jpg`));
  await sharp(Buffer.from(samplePhoto())).jpeg({ quality: 88 }).toFile(out('test/fixtures/sample-party.jpg'));
  await sharp(Buffer.from(samplePhoto())).resize(600).jpeg({ quality: 82 }).toFile(out('test/fixtures/sample-preview-600.jpg'));
  fs.writeFileSync(out('data/music', 'diwali-dhol-loop-placeholder.mp3'), synthLoop());
  console.log('assets written: frames, props, backdrops, sample photos, placeholder music');
}

main().catch((err) => {
  console.error('[build-assets] failed:', err);
  process.exit(1);
});
