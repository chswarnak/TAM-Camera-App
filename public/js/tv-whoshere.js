/* TV "Who's here": one big diya drawn in SVG, every joined guest a glowing node on its outline.
 * The flame holds the 8 most recent arrivals; the lamp body and rim hold everyone else, evenly
 * spaced. Faint gold curves link couples and guests who sent each other shout-outs. Guests who
 * joined since the screen was last shown fly in from the QR corner with a chime. The persistent
 * TV chrome (header, corner QR, shout-out rail) is read from the page and kept clear of labels.
 * The drawing is authored in 1600×900 coordinates; VIEW zooms out 5 % and lifts it so the lamp
 * clears the shout-out rail along the bottom of the screen. */
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const VIEW = { x: -40, y: 5, w: 1680, h: 945 };
  const FLAME_SLOTS = 8;
  const NODE_R = 9;
  const LABEL_GAP = 16;
  const LABEL_PAD = 4;
  const TITLE_MAX = 30;
  const SAMPLES = 900;
  const ARRIVAL_STAGGER_MS = 450;
  const MAX_CHIMES = 4;
  const BOUNDS = { x0: VIEW.x + 18, y0: VIEW.y + 18, x1: VIEW.x + VIEW.w - 18, y1: VIEW.y + VIEW.h - 18 };
  const CHROME_PAD = 10;
  const TITLE_X = 80;
  const TITLE_DROP = 66;
  const COUNT_DROP = 36;
  const FLAME_BOX = { x0: 668, y0: 96, x1: 932, y1: 486 };
  const LAMP_CENTER = { x: 800, y: 600 };
  const FLAME_CENTER = { x: 800, y: 330 };
  const EDGE_PULL = 0.35;
  const CURVE_CENTER = { x: 800, y: 470 };
  // The rim's top arc under the flame base is left free so flame and rim nodes never collide.
  const RIM_GAP = { x0: 655, x1: 945 };
  // The rim's top arc is crowded (flame above, neighbours close): space its nodes wider.
  const RIM_TOP_WEIGHT = 1.8;
  const LABEL_DISTANCES = [0, 0.9, 1.9, 2.9, 3.9];
  const LEADER_MIN = 6;

  const FLAME_D = 'M800,110 C878,228 926,356 872,438 C852,468 828,480 800,482 C772,480 748,468 728,438 C674,356 722,228 800,110 Z';
  const LAMP_D = 'M300,522 A500,58 0 0 1 1300,522 C1272,652 1082,738 800,738 C518,738 328,652 300,522 Z';

  const esc = (v) => Party.escapeHtml(v);
  let root = null;
  let svg = null;
  let layers = null;
  let measureEl = null;
  let fontsReady = false;
  let lastSig = '';
  let seen = null;
  const nodes = new Map();
  const outline = { flame: null, lamp: null };

  // ------------------------------------------------------------------ static scene

  function sceneMarkup() {
    return `
    <svg class="wh-svg" viewBox="${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}" preserveAspectRatio="xMidYMid meet" xmlns="${SVG_NS}">
      <defs>
        <radialGradient id="wh-glow" cx="50%" cy="60%" r="50%"><stop offset="0" stop-color="#FFD54F" stop-opacity="0.55"/><stop offset="0.5" stop-color="#F59E0B" stop-opacity="0.16"/><stop offset="1" stop-color="#F59E0B" stop-opacity="0"/></radialGradient>
        <linearGradient id="wh-flame-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF8C4"/><stop offset="0.45" stop-color="#FFC94A"/><stop offset="1" stop-color="#E86A10"/></linearGradient>
        <linearGradient id="wh-body-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#B5471B"/><stop offset="1" stop-color="#5E1C0C"/></linearGradient>
        <linearGradient id="wh-rim-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3E120A"/><stop offset="1" stop-color="#7A2810"/></linearGradient>
        <filter id="wh-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7"/></filter>
        <filter id="wh-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="22"/></filter>
      </defs>
      <ellipse cx="800" cy="330" rx="330" ry="300" fill="url(#wh-glow)"/>
      <g class="wh-lamp">
        <path d="${LAMP_D}" fill="url(#wh-body-fill)" opacity="0.92"/>
        <ellipse cx="800" cy="522" rx="500" ry="58" fill="url(#wh-rim-fill)" stroke="#D4A017" stroke-width="3"/>
        <path d="M352,575 C440,660 600,700 800,700 C1000,700 1160,660 1248,575" fill="none" stroke="#D4A017" stroke-width="3" stroke-opacity="0.75"/>
        <path d="M410,628 C500,688 640,712 800,712 C960,712 1100,688 1190,628" fill="none" stroke="#F3D27A" stroke-width="1.5" stroke-opacity="0.4" stroke-dasharray="2 14" stroke-linecap="round"/>
        <path d="${LAMP_D}" fill="none" stroke="#D4A017" stroke-width="2.5" stroke-opacity="0.9"/>
      </g>
      <g class="wh-flame">
        <path d="${FLAME_D}" fill="#FFB300" opacity="0.35" filter="url(#wh-soft)"/>
        <path d="${FLAME_D}" fill="url(#wh-flame-fill)" opacity="0.88"/>
        <path d="M800,250 C838,318 850,380 822,428 C814,440 806,446 800,447 C794,446 786,440 778,428 C750,380 762,318 800,250 Z" fill="#FFFBE6" opacity="0.85"/>
        <path d="${FLAME_D}" fill="none" stroke="#F3D27A" stroke-width="2" stroke-opacity="0.8"/>
      </g>
      <line x1="800" y1="470" x2="800" y2="500" stroke="#2A0A12" stroke-width="5" stroke-linecap="round"/>
      <text class="wh-title" x="${TITLE_X}" y="160">Who’s here</text>
      <text class="wh-count" x="${TITLE_X + 4}" y="196" data-bind="wh-count"></text>
      <g class="wh-edges"></g>
      <g class="wh-nodes"></g>
      <g class="wh-measure" aria-hidden="true" opacity="0"></g>
    </svg>`;
  }

  function ensureScene() {
    if (svg) return;
    root.innerHTML = sceneMarkup();
    svg = root.querySelector('svg');
    layers = { edges: svg.querySelector('.wh-edges'), nodes: svg.querySelector('.wh-nodes') };
    measureEl = svg.querySelector('.wh-measure');
    nodes.clear();
    lastSig = '';
    outline.flame = sampleOutline(FLAME_D, () => true, () => 1);
    outline.lamp = sampleOutline(LAMP_D, (p) => !(p.y < 522 && p.x > RIM_GAP.x0 && p.x < RIM_GAP.x1), (p) => (p.y < 522 ? RIM_TOP_WEIGHT : 1));
  }

  /**
   * Samples a path into points (keeping those `keep` accepts) with cumulative length, for even
   * spacing; `weight` stretches parts of the path where nodes should sit further apart.
   */
  function sampleOutline(d, keep, weight) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    measureEl.appendChild(path);
    const total = path.getTotalLength();
    const pts = [];
    let acc = 0;
    let prev = null;
    for (let i = 0; i < SAMPLES; i += 1) {
      const p = path.getPointAtLength((i / SAMPLES) * total);
      if (keep(p)) {
        if (prev) acc += Math.hypot(p.x - prev.x, p.y - prev.y) * weight(p);
        pts.push({ x: p.x, y: p.y, s: acc });
        prev = p;
      } else prev = null;
    }
    path.remove();
    return { pts, length: acc };
  }

  /** `count` evenly spaced points along a sampled outline, offset by half a step. */
  function spread(sampled, count) {
    if (!count) return [];
    const out = [];
    let j = 0;
    for (let i = 0; i < count; i += 1) {
      const target = ((i + 0.5) / count) * sampled.length;
      while (j < sampled.pts.length - 1 && sampled.pts[j].s < target) j += 1;
      out.push({ x: sampled.pts[j].x, y: sampled.pts[j].y });
    }
    return out;
  }

  // ------------------------------------------------------------------ persistent chrome

  /** A page element's box in view-box units (the SVG is letterboxed to 16:9). */
  function viewBox(el) {
    const r = el.getBoundingClientRect();
    const m = svg.getScreenCTM().inverse();
    const a = new DOMPoint(r.left, r.top).matrixTransform(m);
    const b = new DOMPoint(r.right, r.bottom).matrixTransform(m);
    return { x0: a.x - CHROME_PAD, y0: a.y - CHROME_PAD, x1: b.x + CHROME_PAD, y1: b.y + CHROME_PAD };
  }

  /**
   * Where the header, QR card and shout-out rail sit right now, plus this screen's own title.
   * The title is placed just under the header so the two never collide.
   */
  function chrome() {
    const header = viewBox(document.querySelector('#tv-header [data-bind="welcomeLine"]'));
    const title = svg.querySelector('.wh-title');
    const count = svg.querySelector('.wh-count');
    const titleY = header.y1 - CHROME_PAD + TITLE_DROP;
    title.setAttribute('y', titleY.toFixed(1));
    count.setAttribute('y', (titleY + COUNT_DROP).toFixed(1));
    const t = title.getBBox();
    const c = count.getBBox();
    const titleBox = { x0: t.x - CHROME_PAD, y0: t.y - CHROME_PAD, x1: Math.max(t.x + t.width, c.x + c.width + 120) + CHROME_PAD, y1: c.y + c.height + CHROME_PAD };
    return { boxes: [header, titleBox, viewBox($('corner-qr')), viewBox($('rail'))], qr: viewBox($('corner-qr')) };
  }

  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------------ labels

  function shortTitle(title) {
    const t = String(title || '');
    return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1).trimEnd()}…` : t;
  }

  function labelMarkup(g, x, y, anchor) {
    const title = shortTitle(g.title);
    return `<text class="wh-label" x="${x}" y="${y}" text-anchor="${anchor}">
      <tspan class="wh-name" x="${x}">${esc(g.nickname)}</tspan>${title ? `<tspan class="wh-gtitle" x="${x}" dy="1.25em">${esc(title)}</tspan>` : ''}</text>`;
  }

  /** Width/height of a guest's two-line label, measured with the real fonts. */
  function measure(g) {
    measureEl.innerHTML = labelMarkup(g, 0, 0, 'start');
    const box = measureEl.firstElementChild.getBBox();
    return { w: box.width, h: box.height, ascent: -box.y };
  }

  const overlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

  /**
   * Candidate label spots for a node, best first: outward from its shape, then the sides,
   * then further out. Each yields the text anchor point and the box it would occupy.
   */
  function candidates(p, centre, size) {
    const dx = p.x - centre.x;
    const dy = p.y - centre.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len;
    const ny = dy / len;
    const spot = (side, dist, shift = 0) => {
      const g = NODE_R + LABEL_GAP + dist;
      if (side === 'right') return box(p.x + g, p.y - size.h / 2 + shift * size.h, 'start', dist);
      if (side === 'left') return box(p.x - g - size.w, p.y - size.h / 2 + shift * size.h, 'end', dist);
      if (side === 'up') return box(p.x - size.w / 2 + shift * size.w, p.y - g - size.h, 'middle', dist);
      return box(p.x - size.w / 2 + shift * size.w, p.y + g, 'middle', dist);
    };
    const box = (x0, y0, anchor, dist) => ({
      anchor, dist, x0: x0 - LABEL_PAD, y0: y0 - LABEL_PAD, x1: x0 + size.w + LABEL_PAD, y1: y0 + size.h + LABEL_PAD,
      tx: anchor === 'start' ? x0 : anchor === 'end' ? x0 + size.w : x0 + size.w / 2, ty: y0 + size.ascent,
    });
    const horizontal = Math.abs(nx) > 0.45;
    const primary = horizontal ? (nx > 0 ? 'right' : 'left') : (ny > 0 ? 'down' : 'up');
    const order = [primary, ...(horizontal ? [ny > 0 ? 'down' : 'up', nx > 0 ? 'left' : 'right'] : [nx >= 0 ? 'right' : 'left', nx >= 0 ? 'left' : 'right'])];
    const out = [];
    for (const k of LABEL_DISTANCES) {
      for (const side of order) for (const shift of [0, -0.5, 0.5]) out.push(spot(side, k * size.h, shift));
    }
    return out;
  }

  /** Greedy placement: first candidate that hits nothing, otherwise the least-overlapping one. */
  function placeLabels(items, chromeBoxes) {
    const placed = [];
    const nodeBoxes = items.map((it) => ({ x0: it.p.x - NODE_R - 3, y0: it.p.y - NODE_R - 3, x1: it.p.x + NODE_R + 3, y1: it.p.y + NODE_R + 3 }));
    const fixed = [...chromeBoxes, ...nodeBoxes];
    for (const it of items) {
      const obstacles = it.inFlame ? fixed : [...fixed, FLAME_BOX];
      let best = null;
      let bestCost = Infinity;
      for (const c of candidates(it.p, it.inFlame ? FLAME_CENTER : LAMP_CENTER, it.size)) {
        const outside = c.x0 < BOUNDS.x0 || c.y0 < BOUNDS.y0 || c.x1 > BOUNDS.x1 || c.y1 > BOUNDS.y1;
        const hit = [...obstacles, ...placed].reduce((sum, b) => sum + overlap(c, b), 0) + (outside ? 1e6 : 0);
        if (hit < bestCost) {
          best = c;
          bestCost = hit;
          if (hit === 0) break;
        }
      }
      it.label = best;
      placed.push(best);
    }
  }

  // ------------------------------------------------------------------ nodes and edges

  function layout(guests, chromeBoxes) {
    const byRecent = [...guests].sort((a, b) => (b.joinedAt || 0) - (a.joinedAt || 0));
    const flame = byRecent.slice(0, FLAME_SLOTS);
    const lamp = byRecent.slice(FLAME_SLOTS).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
    const items = [
      ...spread(outline.flame, flame.length).map((p, i) => ({ g: flame[i], p, inFlame: true })),
      ...spread(outline.lamp, lamp.length).map((p, i) => ({ g: lamp[i], p, inFlame: false })),
    ];
    for (const it of items) it.size = measure(it.g);
    measureEl.innerHTML = '';
    placeLabels(items, chromeBoxes);
    return items;
  }

  function edgePath(a, b) {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    // Short edges bend less, so neighbours are joined by a gentle arc rather than a loop.
    const pull = EDGE_PULL * Math.min(1, Math.hypot(a.x - b.x, a.y - b.y) / 500);
    const cx = mx + (CURVE_CENTER.x - mx) * pull;
    const cy = my + (CURVE_CENTER.y - my) * pull;
    return `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
  }

  function drawEdges(connections, posById) {
    layers.edges.innerHTML = connections
      .filter((e) => posById.has(e.a) && posById.has(e.b))
      .map((e) => `<path class="wh-edge is-${e.kind}" d="${edgePath(posById.get(e.a), posById.get(e.b))}"/>`)
      .join('');
  }

  function setNode(el, it, color) {
    el.style.transform = `translate(${it.p.x.toFixed(1)}px, ${it.p.y.toFixed(1)}px)`;
    const l = it.label;
    const html = `
      ${leaderLine(it)}
      <circle class="wh-halo" r="${NODE_R * 2.2}" fill="${esc(color)}" filter="url(#wh-blur)"/>
      <circle class="wh-dot" r="${NODE_R}" fill="${esc(color)}"/>
      ${labelMarkup(it.g, (l.tx - it.p.x).toFixed(1), (l.ty - it.p.y).toFixed(1), l.anchor)}`;
    if (el.dataset.sig !== html) {
      el.dataset.sig = html;
      el.innerHTML = html;
    }
  }

  /** Thin line from a node to its label when the label had to move away from the node. */
  function leaderLine(it) {
    const l = it.label;
    if (!l.dist) return '';
    const tx = Math.min(Math.max(it.p.x, l.x0 + LABEL_PAD), l.x1 - LABEL_PAD) - it.p.x;
    const ty = Math.min(Math.max(it.p.y, l.y0 + LABEL_PAD), l.y1 - LABEL_PAD) - it.p.y;
    const len = Math.hypot(tx, ty);
    if (len < NODE_R + LEADER_MIN) return '';
    const sx = (tx / len) * (NODE_R + 3);
    const sy = (ty / len) * (NODE_R + 3);
    return `<line class="wh-leader" x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${tx.toFixed(1)}" y2="${ty.toFixed(1)}"/>`;
  }

  /** Brings new guests in from the QR corner, staggered, each with a chime. */
  function arrive(el, it, color, index, qr) {
    el.classList.add('is-arriving');
    el.style.transition = 'none';
    el.style.transform = `translate(${((qr.x0 + qr.x1) / 2).toFixed(1)}px, ${((qr.y0 + qr.y1) / 2).toFixed(1)}px) scale(0.2)`;
    void el.getBoundingClientRect();
    setTimeout(() => {
      el.style.transition = '';
      setNode(el, it, color);
      if (index < MAX_CHIMES && window.TvAudio) TvAudio.chime();
      setTimeout(() => el.classList.remove('is-arriving'), 1800);
    }, 120 + index * ARRIVAL_STAGGER_MS);
  }

  function update(snap, teamColor) {
    const frame = chrome();
    const items = layout(snap.guests, frame.boxes);
    const ids = new Set(items.map((it) => it.g.id));
    const firstTime = seen === null;
    const fresh = firstTime ? [] : items.filter((it) => !seen.has(it.g.id));
    for (const [id, el] of nodes) {
      if (!ids.has(id)) {
        el.remove();
        nodes.delete(id);
      }
    }
    items.forEach((it, i) => {
      const color = teamColor(it.g.teamId);
      let el = nodes.get(it.g.id);
      if (!el) {
        el = document.createElementNS(SVG_NS, 'g');
        el.setAttribute('class', 'wh-node');
        el.style.setProperty('--pulse-delay', `${(-(i * 0.37) % 2.8).toFixed(2)}s`);
        layers.nodes.appendChild(el);
        nodes.set(it.g.id, el);
      }
      const arrivalIndex = fresh.indexOf(it);
      if (arrivalIndex >= 0) {
        setNode(el, it, color);
        arrive(el, it, color, arrivalIndex, frame.qr);
      } else setNode(el, it, color);
    });
    drawEdges(snap.connections || [], new Map(items.map((it) => [it.g.id, it.p])));
    svg.querySelector('[data-bind="wh-count"]').textContent = `${items.length} ${items.length === 1 ? 'guest has' : 'guests have'} joined`;
    seen = ids;
  }

  // ------------------------------------------------------------------ public API

  /** Renders (or refreshes) the screen; cheap when nothing relevant changed. */
  function render(snap, { teamColor }) {
    if (!fontsReady) return;
    ensureScene();
    const sig = JSON.stringify([snap.guests, snap.connections, snap.teams.map((t) => [t.id, t.color]), snap.party.welcomeLine, window.innerWidth, window.innerHeight]);
    if (sig === lastSig) return;
    lastSig = sig;
    update(snap, teamColor);
  }

  function init(el, onReady) {
    root = el;
    document.fonts.ready.then(() => {
      fontsReady = true;
      onReady();
    });
  }

  window.TvWhosHere = { init, render };
})();
