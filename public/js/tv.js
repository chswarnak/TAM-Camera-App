/* TV display: picks a mode from the live snapshot and renders it for a 4K screen.
 * Mode priority (highest first): trophy (30 s) → physical game → couples quiz →
 * round (question / results for 30 s) → host-pinned mode → auto-cycle
 * (slideshow 60 s → leaderboard 15 s → who's here 20 s). Welcome is host-pinned only.
 * Every mode shares the persistent chrome: host welcome header, corner QR, shout-out rail. */
(function () {
  'use strict';

  const CYCLE = [
    { mode: 'slideshow', ms: 60000 },
    { mode: 'leaderboard', ms: 15000 },
    { mode: 'whoshere', ms: 20000 },
  ];
  const TICK_MS = 250;
  const SLIDE_MS = 8000;
  const TROPHY_MS = 30000;
  const RESULTS_MS = 30000;
  const HELLO_MS = 10000;
  const BURST_MS = 4200;
  const STOP_FLASH_MS = 2200;
  const HUG_SECONDS = 5;
  const WALL_SIZE = 12;
  const WALL_SHUFFLE_MS = 5000;
  const STRIP_SIZE = 5;
  const KEN_BURNS_VARIANTS = 4;
  const RESULT_BARS_MAX = 8;
  const WINNERS_NAMED_MAX = 3;
  const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
  const GARLAND_STRANDS = 15;
  const DEFAULT_TICKER = '🪔 Send a shout-out from your phone: tap Shout-out, pick a friend and a sticker ✨';

  const esc = Party.escapeHtml;
  const $ = (id) => document.getElementById(id);

  let snap = null;
  let activeMode = null;
  const cycle = { index: 0, startedAt: Date.now(), interrupted: false };
  // The server owns the slideshow order (lib/slideshow.js); `wantId` is the photo it chose
  // and `fetching` guards against overlapping requests.
  const slide = { id: null, shownAt: 0, layer: 0, wantId: null, fetching: false };
  const wall = { order: [], lastShuffle: 0, fresh: new Set() };
  const hug = { endsAt: 0 };
  const bursts = { queue: [], busy: false };
  let seenTrophyCelebration = null;

  // ------------------------------------------------------------------ helpers

  /** Assigns innerHTML only when it changed, so running CSS animations are not restarted. */
  function setHtml(el, html) {
    if (el.dataset.sig === html) return;
    el.dataset.sig = html;
    el.innerHTML = html;
  }

  function bindAll(name, html) {
    document.querySelectorAll(`[data-bind="${name}"]`).forEach((el) => setHtml(el, html));
  }

  function teamOf(teamId) {
    return snap?.teams.find((t) => t.id === teamId) || null;
  }

  function teamColor(teamId) {
    return teamOf(teamId)?.color || 'var(--gold)';
  }

  function dot(teamId) {
    return teamId ? `<span class="team-dot" style="background:${esc(teamColor(teamId))}"></span>` : '';
  }

  function plural(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
  }

  // ------------------------------------------------------------------ mode selection

  function roundMode(round, now) {
    if (!round) return null;
    if (round.status === 'open' || round.status === 'closed') return 'question';
    if (round.status === 'revealed' && now - (round.revealedAt || 0) < RESULTS_MS) return 'results';
    return null;
  }

  function cycleMode() {
    const now = Date.now();
    while (now - cycle.startedAt >= CYCLE[cycle.index].ms) {
      cycle.startedAt += CYCLE[cycle.index].ms;
      cycle.index = (cycle.index + 1) % CYCLE.length;
      if (now - cycle.startedAt > CYCLE[cycle.index].ms) cycle.startedAt = now;
    }
    return CYCLE[cycle.index].mode;
  }

  function restartCycle(index = 0) {
    cycle.index = index;
    cycle.startedAt = Date.now();
  }

  function chooseMode() {
    const now = Party.now();
    const { trophy, physical, couples, round, tv } = snap;
    if (trophy && now - trophy.at < TROPHY_MS) return 'trophy';
    if (physical.game) return 'physical';
    if (couples && couples.status !== 'done') return 'couples';
    const rm = roundMode(round, now);
    if (rm) return rm;
    if (tv.pinned) return tv.pinned;
    return null;
  }

  function updateMode() {
    if (!snap) return;
    const forced = chooseMode();
    if (forced) cycle.interrupted = true;
    else if (cycle.interrupted) {
      cycle.interrupted = false;
      restartCycle();
    }
    const mode = forced || cycleMode();
    if (mode !== activeMode) enterMode(mode);
    renderActive();
  }

  function enterMode(mode) {
    activeMode = mode;
    document.querySelectorAll('.mode').forEach((el) => el.classList.toggle('is-active', el.dataset.mode === mode));
    document.body.dataset.mode = mode;
    TvFx.setAmbientFireworks(mode !== 'slideshow');
    if (mode === 'leaderboard') delete $('board').dataset.sig;
    if (mode === 'results') delete $('results').dataset.sig;
    if (mode === 'wall') wall.lastShuffle = Date.now();
    if (mode === 'slideshow') requestSlide();
    if (mode === 'trophy' && snap.trophy && seenTrophyCelebration !== snap.trophy.id) {
      seenTrophyCelebration = snap.trophy.id;
      TvFx.confetti();
      TvFx.celebrate();
    }
  }

  function renderActive() {
    renderChrome();
    renderTicker();
    switch (activeMode) {
      case 'welcome': renderWelcome(); break;
      case 'slideshow': renderSlideshow(); break;
      case 'wall': renderWall(); break;
      case 'question': renderQuestion(); break;
      case 'results': renderResults(); break;
      case 'leaderboard': renderLeaderboard(); break;
      case 'whoshere': TvWhosHere.render(snap, { teamColor }); break;
      case 'couples': renderCouples(); break;
      case 'physical': renderPhysical(); break;
      case 'trophy': renderTrophy(); break;
      default: break;
    }
  }

  // ------------------------------------------------------------------ welcome

  function qrHtml() {
    return snap.joinUrl ? Party.qrSvg(snap.joinUrl, { margin: 1 }) : '';
  }

  /** Header, corner QR and join URL: the same on every mode. */
  function renderChrome() {
    bindAll('welcomeLine', esc(snap.party.welcomeLine));
    bindAll('cornerQr', qrHtml());
    bindAll('joinUrl', esc(snap.joinUrl.replace(/^https?:\/\//, '')));
  }

  function renderWelcome() {
    bindAll('partyName', esc(snap.party.name));
    const n = snap.guests.length;
    bindAll('guestCount', String(n));
    bindAll('guestCountLabel', n === 1 ? 'guest has joined' : 'guests have joined');
    const titled = snap.guests.filter((g) => g.title);
    const items = titled.map((g) => `<span class="marquee-item">${dot(g.teamId)}<b>${esc(g.nickname)}</b> <i>${esc(g.title)}</i></span>`).join('<span class="marquee-sep">✦</span>');
    const el = $('title-marquee');
    el.hidden = titled.length === 0;
    const seconds = Math.max(30, titled.length * 6);
    setHtml(el, items ? `<div class="marquee-run" style="animation-duration:${seconds}s">${items}<span class="marquee-sep">✦</span>${items}<span class="marquee-sep">✦</span></div>` : '');
  }

  // ------------------------------------------------------------------ ticker

  function renderTicker() {
    const list = snap.shoutouts;
    const items = list.length
      ? list.map((s) => `<span class="ticker-item"><b>${esc(s.from)}</b> → <b>${esc(s.to)}</b> ${esc(s.emoji || '')} ${esc(s.text || '')}</span>`).join('<span class="ticker-sep">🪔</span>')
      : `<span class="ticker-item">${esc(DEFAULT_TICKER)}</span>`;
    const seconds = Math.max(25, (list.length || 2) * 9);
    setHtml($('ticker-run'), `<div class="ticker-inner" style="animation-duration:${seconds}s">${items}<span class="ticker-sep">🪔</span>${items}<span class="ticker-sep">🪔</span></div>`);
  }

  // ------------------------------------------------------------------ slideshow

  function photoIndex(id) {
    return snap.photos.findIndex((p) => p.id === id);
  }

  /**
   * Asks the server for the next photo (it resumes the evening-long sequence, so leaving
   * for the leaderboard or a question never restarts from the first photo).
   */
  async function requestSlide() {
    if (slide.fetching || !snap || !snap.photos.length) return;
    slide.fetching = true;
    try {
      const { photoId } = await Party.api('/api/tv/slideshow/next', { method: 'POST', body: { from: slide.id } });
      slide.wantId = photoId;
      if (photoId === slide.id) slide.shownAt = Date.now(); // only one photo: keep it, check again later
    } catch (err) {
      console.error('[tv] could not get the next slide', err.message);
      slide.shownAt = Date.now();
    } finally {
      slide.fetching = false;
    }
    if (activeMode === 'slideshow') renderActive();
  }

  function showPhoto(photo) {
    slide.id = photo.id;
    slide.shownAt = Date.now();
    slide.layer = 1 - slide.layer;
    const incoming = $(slide.layer ? 'slide-b' : 'slide-a');
    const outgoing = $(slide.layer ? 'slide-a' : 'slide-b');
    const img = incoming.querySelector('.slide-img');
    let revealed = false;
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      for (let i = 1; i <= KEN_BURNS_VARIANTS; i += 1) incoming.classList.remove(`kb-${i}`);
      void incoming.offsetWidth;
      incoming.classList.add(`kb-${1 + Math.floor(Math.random() * KEN_BURNS_VARIANTS)}`);
      incoming.classList.add('is-active');
      outgoing.classList.remove('is-active');
    };
    incoming.querySelector('.slide-fill').style.backgroundImage = `url("${photo.url}")`;
    img.onload = reveal;
    img.onerror = () => console.error('[tv] photo failed to load', photo.url);
    img.src = photo.url;
    if (img.complete && img.naturalWidth) reveal();
  }

  function renderSlideshow() {
    const photos = snap.photos;
    $('slide-empty').hidden = photos.length > 0;
    document.body.classList.toggle('slides-empty', photos.length === 0);
    document.querySelector('.slide-info').hidden = photos.length === 0;
    $('paused-pill').hidden = !snap.tv.paused || photos.length === 0;
    if (!photos.length) {
      slide.id = null;
      document.querySelectorAll('.slide-layer').forEach((l) => l.classList.remove('is-active'));
      return;
    }
    // The chosen photo may land a moment before the snapshot that lists it.
    if (slide.wantId && slide.wantId !== slide.id && photoIndex(slide.wantId) >= 0) showPhoto(photos[photoIndex(slide.wantId)]);
    const due = Date.now() - slide.shownAt >= SLIDE_MS && !snap.tv.paused;
    if (photoIndex(slide.id) < 0 || due) requestSlide();
    if (photoIndex(slide.id) < 0) return;

    const p = photos[photoIndex(slide.id)];
    const caption = p.caption || p.autoCaption;
    setHtml($('slide-caption'), `
      ${caption ? `<p class="caption-text">“${esc(caption)}”</p>` : ''}
      <p class="caption-by">${dot(p.teamId)}<b>${esc(p.nickname)}</b>${p.title ? ` <span class="caption-title">${esc(p.title)}</span>` : ''}
        ${p.hearts ? `<span class="caption-hearts">❤ ${p.hearts}</span>` : ''}</p>`);
    setHtml($('slide-strip'), photos.slice(0, STRIP_SIZE).map((ph) => `
      <div class="strip-thumb${ph.id === slide.id ? ' is-current' : ''}" style="background-image:url('${esc(ph.url)}')"></div>`).join(''));
  }

  // ------------------------------------------------------------------ photo wall

  function renderWall() {
    const top = [...snap.photos].sort((a, b) => b.hearts - a.hearts || b.createdAt - a.createdAt).slice(0, WALL_SIZE);
    const ids = new Set(top.map((p) => p.id));
    wall.order = wall.order.filter((id) => ids.has(id));
    for (const p of top) if (!wall.order.includes(p.id)) wall.order.push(p.id);
    if (Date.now() - wall.lastShuffle >= WALL_SHUFFLE_MS && wall.order.length > 1) {
      wall.lastShuffle = Date.now();
      const i = Math.floor(Math.random() * wall.order.length);
      let j = Math.floor(Math.random() * (wall.order.length - 1));
      if (j >= i) j += 1;
      [wall.order[i], wall.order[j]] = [wall.order[j], wall.order[i]];
      wall.fresh = new Set([wall.order[i], wall.order[j]]);
    }
    const byId = Object.fromEntries(top.map((p) => [p.id, p]));
    const grid = $('wall-grid');
    grid.classList.toggle('is-empty', top.length === 0);
    grid.style.setProperty('--rows', String(Math.max(2, Math.ceil(top.length / 4))));
    setHtml(grid, top.length ? wall.order.map((id) => {
      const p = byId[id];
      return `<figure class="wall-tile${wall.fresh.has(id) ? ' is-fresh' : ''}" style="--team:${esc(teamColor(p.teamId))}">
        <div class="wall-img" style="background-image:url('${esc(p.url)}')"></div>
        <figcaption><span class="wall-name">${esc(p.nickname)}</span><span class="wall-hearts">❤ ${p.hearts}</span></figcaption>
      </figure>`;
    }).join('') : `<p class="lead empty-note">No photos yet. Be the first: tap <b>Photo Fun</b> on your phone!</p>`);
  }

  // ------------------------------------------------------------------ question

  function renderQuestion() {
    const r = snap.round;
    if (!r) return;
    setHtml($('q-category'), esc(r.category));
    setHtml($('q-number'), r.type === 'quiz' ? `Question ${r.number}` : '');
    setHtml($('q-text'), esc(r.text));
    $('q-text').classList.toggle('is-emoji', r.type === 'quiz' && !/[a-z]/i.test(r.text));
    const opts = $('q-options');
    if (r.optionsFrom === 'guests') {
      setHtml(opts, `<div class="phone-vote">📱 Vote on your phone${r.type === 'guessWho' ? ': who wrote this?' : '!'}</div>`);
    } else {
      setHtml(opts, (r.options || []).map((o, i) => `<div class="q-option"><span class="q-letter">${OPTION_LETTERS[i] || i + 1}</span><span>${esc(o)}</span></div>`).join(''));
    }
    opts.dataset.count = r.options ? r.options.length : 0;
    setHtml($('q-submissions'), String(r.submissions));
    setHtml($('q-status'), r.status === 'closed' ? '⏳ Time is up! The reveal is coming…' : 'Answer on your phone now');
    renderCountdown();
  }

  function renderCountdown() {
    const r = snap.round;
    const box = $('q-countdown');
    const timed = r && r.status === 'open' && r.endsAt;
    box.hidden = !timed;
    if (!timed) return;
    const total = Math.max(1, r.seconds * 1000);
    const left = Math.max(0, r.endsAt - Party.now());
    const ring = $('q-ring');
    const circumference = 2 * Math.PI * 52;
    ring.style.strokeDasharray = String(circumference);
    ring.style.strokeDashoffset = String(circumference * (1 - left / total));
    box.classList.toggle('is-urgent', left <= 5000);
    $('q-seconds').textContent = String(Math.ceil(left / 1000));
  }

  // ------------------------------------------------------------------ results

  function bars(options, { correct, max }) {
    const top = Math.max(1, max);
    return options.map((o, i) => {
      const isCorrect = correct !== null && correct !== undefined && o.id === correct;
      const color = o.teamId ? teamColor(o.teamId) : isCorrect ? 'var(--green)' : 'var(--gold)';
      return `<div class="bar-row${isCorrect ? ' is-correct' : ''}${correct !== null && correct !== undefined && !isCorrect ? ' is-wrong' : ''}">
        <span class="bar-label">${o.teamId ? dot(o.teamId) : `<span class="q-letter">${OPTION_LETTERS[i] || i + 1}</span>`}${esc(o.label)}${isCorrect ? ' <span class="tick">✓</span>' : ''}</span>
        <span class="bar-track"><span class="bar-fill" style="--w:${(o.votes / top) * 100}%;--c:${esc(color)};animation-delay:${i * 120}ms"></span></span>
        <span class="bar-votes">${o.votes}</span>
      </div>`;
    }).join('');
  }

  function teamCorrectHtml(teamCorrect) {
    if (!teamCorrect) return '';
    const chips = snap.teams.map((t) => `<div class="team-chip" style="--team:${esc(t.color)}"><span class="team-chip-name">${esc(t.name)}</span><span class="team-chip-num">${teamCorrect[t.id] || 0}</span></div>`).join('');
    return `<div class="team-correct"><p class="eyebrow">Correct answers by team</p><div class="team-chips">${chips}</div></div>`;
  }

  function commentaryHtml(round) {
    const c = snap.commentary;
    if (!c || !c.text || c.at < (round.revealedAt || 0) - 2000) return '';
    return `<p class="commentary">🎙️ ${esc(c.text)}</p>`;
  }

  function renderResults() {
    const r = snap.round;
    if (!r || !r.results) return;
    const res = r.results;
    const max = Math.max(0, ...res.options.map((o) => o.votes));
    let body;
    if (r.type === 'guessWho' && res.author) {
      body = `<div class="author-reveal" style="--team:${esc(teamColor(res.author.teamId))}">
          <p class="eyebrow">It was…</p>
          <h1 class="author-name">${esc(res.author.nickname)}</h1>
          ${res.author.title ? `<p class="author-title">${esc(res.author.title)}</p>` : ''}
          <p class="lead">${dot(res.author.teamId)}Team ${esc(teamOf(res.author.teamId)?.name || '')}</p>
        </div>
        ${teamCorrectHtml(res.teamCorrect)}`;
    } else if (r.type === 'quiz') {
      body = `<div class="bars">${bars(res.options, { correct: res.correct, max })}</div>${teamCorrectHtml(res.teamCorrect)}`;
    } else {
      const opts = res.options.slice(0, RESULT_BARS_MAX);
      const winners = r.optionsFrom === 'guests' && max > 0 ? opts.filter((o) => o.votes === max) : [];
      const winnerNames = winners.map((w) => `${dot(w.teamId)}${esc(w.label)}`).join(' &amp; ');
      const winnerLine = winners.length > WINNERS_NAMED_MAX
        ? `It's a ${winners.length}-way tie! (${plural(max, 'vote', 'votes')} each)`
        : `${winnerNames} (${plural(max, 'vote', 'votes')})`;
      body = `${winners.length ? `<p class="winner-line">${winnerLine}</p>` : ''}
        ${opts.length ? `<div class="bars">${bars(opts, { correct: null, max })}</div>` : '<p class="lead">No votes this time!</p>'}
        ${r.type === 'guessWho' ? '<p class="lead">This clue came from the hosts 🪔</p>' : ''}`;
    }
    setHtml($('results'), `
      <header class="question-head"><span class="pill">${esc(r.category)} · Results</span><span class="q-number">${plural(res.total, 'answer', 'answers')}</span></header>
      <h2 class="results-question${r.type === 'quiz' && !/[a-z]/i.test(r.text) ? ' is-emoji' : ''}">${esc(r.text)}</h2>
      <div class="results-body">${body}</div>
      ${commentaryHtml(r)}`);
  }

  // ------------------------------------------------------------------ leaderboard

  function renderLeaderboard() {
    const teams = snap.teams;
    const max = Math.max(1, ...teams.map((t) => t.score));
    const c = snap.commentary;
    setHtml($('board-commentary'), c && c.text ? `🎙️ ${esc(c.text)}` : 'Every correct answer is worth 10 points');
    const medals = ['🥇', '🥈', '🥉'];
    setHtml($('board'), teams.map((t, i) => `
      <div class="board-row" style="--team:${esc(t.color)};animation-delay:${i * 120}ms">
        <span class="board-rank">${medals[i] || i + 1}</span>
        <div class="board-main">
          <div class="board-top">
            <span class="board-name">${esc(t.name)}</span>
            <span class="board-members">${plural(t.members, 'player', 'players')}</span>
          </div>
          <div class="board-bar"><span class="board-fill" style="--w:${Math.max(2, (t.score / max) * 100)}%;animation-delay:${200 + i * 150}ms"></span></div>
          <div class="board-guests">${t.top.map((g) => `<span class="board-guest"><b>${esc(g.nickname)}</b>${g.title ? ` <i>${esc(g.title)}</i>` : ''}</span>`).join('') || '<span class="board-guest"><i>Waiting for players</i></span>'}</div>
        </div>
        <span class="board-score">${t.score}</span>
      </div>`).join(''));
  }

  // ------------------------------------------------------------------ couples

  function renderCouples() {
    const c = snap.couples;
    if (!c) return;
    const total = c.questions.length * 2;
    if (c.status === 'answering' || !c.revealed.length) {
      setHtml($('couples'), `
        <header class="mode-head center">
          <p class="eyebrow">💑 Couples Quiz</p>
          <h1 class="display">How well do you know each other?</h1>
          <p class="lead">Each partner answers ${plural(c.questions.length, 'question', 'questions')} on their own phone. No peeking!</p>
        </header>
        <div class="pairs-grid${c.pairs.length > 6 ? ' is-dense' : ''}">${c.pairs.map((p) => {
          const pct = total ? Math.round((p.answered / total) * 100) : 0;
          return `<div class="pair-card" style="--team:${esc(teamColor(p.teamId))}">
            <p class="pair-names">${esc(p.a)} <span class="heart">❤</span> ${esc(p.b)}</p>
            <div class="pair-progress"><span style="width:${pct}%"></span></div>
            <p class="pair-status">${p.answered >= total ? '✓ Both done' : `${p.answered} / ${total} answers`}</p>
          </div>`;
        }).join('')}</div>`);
      return;
    }
    const q = c.revealed[c.revealed.length - 1];
    const matchesById = Object.fromEntries(c.pairs.map((p) => [p.id, p]));
    setHtml($('couples'), `
      <header class="question-head"><span class="pill">💑 Couples Quiz</span><span class="q-number">Question ${c.revealIndex + 1} of ${c.questions.length}</span></header>
      <h1 class="couples-question">${esc(q.text)}</h1>
      <div class="reveal-list${q.pairs.length > 5 ? ' is-dense' : ''}">${q.pairs.map((p, i) => `
        <div class="reveal-row ${p.match ? 'is-match' : 'is-miss'}" style="--team:${esc(teamColor(matchesById[p.pairId]?.teamId))};animation-delay:${i * 250}ms">
          <span class="reveal-couple"><span>${esc(p.a)} &amp; ${esc(p.b)}</span>${p.match ? `<span class="reveal-awards">Match! ${(p.awards || []).map((w) => `${dot(w.teamId)}+${w.points} ${esc(teamLabel(w.team))}`).join(', ')}</span>` : ''}</span>
          <span class="reveal-answer"><small>${esc(p.a)} says</small>${esc(p.aSays || '—')}</span>
          <span class="reveal-answer"><small>${esc(p.b)} says</small>${esc(p.bSays || '—')}</span>
          <span class="reveal-mark">${p.match ? '✓' : '✗'}</span>
          <span class="reveal-score">${matchesById[p.pairId]?.matches || 0} in sync</span>
        </div>`).join('')}</div>`);
  }

  /** "Diya" → "Team Diya"; leaves names that already say "Team" alone. */
  function teamLabel(name) {
    return /^team\b/i.test(name) ? name : `Team ${name}`;
  }

  // ------------------------------------------------------------------ physical game

  function renderPhysical() {
    const p = snap.physical;
    if (!p.info) return;
    setHtml($('pg-name'), esc(p.info.name));
    setHtml($('pg-round'), p.round ? `Round ${p.round}` : 'Get ready');
    setHtml($('pg-rule'), esc(p.info.rule));
    setHtml($('pg-remaining'), String(p.remaining));
    setHtml($('pg-unit'), esc(p.info.unit));
    const status = {
      ready: '<span class="pg-ready">Gather round… the music starts soon!</span>',
      idle: '<span class="pg-ready">Gather round… the music starts soon!</span>',
      playing: '<span class="pg-playing"><span class="eq"><i></i><i></i><i></i><i></i><i></i></span>♪ Music playing</span>',
      stopped: '<span class="pg-stopped">STOP!</span>',
    }[p.status];
    setHtml($('pg-status'), status || '');
    document.querySelector('.mode-physical').dataset.status = p.status;
  }

  function renderHug() {
    const el = $('hug-countdown');
    const left = hug.endsAt - Date.now();
    const show = left > -1500 && activeMode === 'physical';
    el.hidden = !show;
    if (!show) return;
    setHtml(el, left > 0
      ? `<span class="hug-label">Find your partner and hug!</span><span class="hug-num">${Math.ceil(left / 1000)}</span>`
      : '<span class="hug-num hug-done">🤗 HUG!</span>');
  }

  // ------------------------------------------------------------------ trophy

  function renderTrophy() {
    const t = snap.trophy;
    if (!t) return;
    setHtml($('trophy'), `
      <div class="trophy-card${t.photoUrl ? ' has-photo' : ''}" style="--team:${esc(teamColor(t.teamId))}">
        ${t.photoUrl ? `<div class="trophy-photo"><img src="${esc(t.photoUrl)}" alt=""></div>` : ''}
        <div class="trophy-copy">
          <div class="trophy-icon">🏆</div>
          <p class="eyebrow">${esc(t.title)}</p>
          <h1 class="trophy-name">${esc(t.name)}</h1>
          ${t.guestTitle ? `<p class="trophy-guest-title">${esc(t.guestTitle)}</p>` : ''}
          ${t.subtitle ? `<p class="trophy-subtitle">${dot(t.teamId)}${esc(t.subtitle)}</p>` : ''}
          ${t.line ? `<p class="commentary">🎙️ ${esc(t.line)}</p>` : ''}
        </div>
      </div>`);
  }

  // ------------------------------------------------------------------ overlays

  function queueBurst(html, { confetti = false } = {}) {
    bursts.queue.push({ html, confetti });
    if (!bursts.busy) nextBurst();
  }

  function nextBurst() {
    const item = bursts.queue.shift();
    const el = $('burst');
    if (!item) {
      bursts.busy = false;
      el.hidden = true;
      return;
    }
    bursts.busy = true;
    el.innerHTML = `<div class="burst-card">${item.html}</div>`;
    el.hidden = false;
    TvFx.firework(window.innerWidth * 0.25, window.innerHeight * 0.3, { scale: 1.2 });
    TvFx.firework(window.innerWidth * 0.75, window.innerHeight * 0.3, { scale: 1.2 });
    if (item.confetti) TvFx.confetti(120);
    setTimeout(nextBurst, BURST_MS);
  }

  function stopFlash() {
    const el = $('stop-flash');
    el.hidden = false;
    el.classList.remove('is-on');
    void el.offsetWidth;
    el.classList.add('is-on');
    setTimeout(() => { el.hidden = true; }, STOP_FLASH_MS);
  }

  /** Small corner button while idle; huge and centred when a game needs music but audio is still locked. */
  function updateSoundButton() {
    const btn = $('sound-btn');
    const unlocked = TvAudio.isUnlocked();
    btn.hidden = unlocked;
    btn.classList.toggle('is-urgent', !unlocked && Boolean(snap) && snap.physical.status === 'playing');
  }

  // ------------------------------------------------------------------ live events

  function playlistShouldPlay() {
    return snap.physical.status === 'playing' && snap.physical.audioMode !== 'system';
  }

  function onState(data) {
    const firstState = !snap;
    snap = data;
    if (firstState) loadTracks();
    if (playlistShouldPlay() && TvAudio.isUnlocked() && !TvAudio.isPlaying() && firstState) TvAudio.play(snap.physical.volume);
    updateSoundButton();
    updateMode();
  }

  function onFx(fx) {
    switch (fx.type) {
      case 'newPhoto':
        // The server queued it to jump the slideshow once; ask for it now if we're showing photos.
        if (activeMode === 'slideshow') requestSlide();
        else if (activeMode === 'leaderboard' || activeMode === 'whoshere') restartCycle(0);
        queueBurst(`<span class="burst-emoji">📸</span><span class="burst-title">Just shared by ${esc(fx.nickname)}</span>`);
        break;
      case 'shoutout':
        queueBurst(`<span class="burst-emoji">${esc(fx.emoji || '🪔')}</span>
          <span class="burst-title">${esc(fx.from)} <span class="arrow">→</span> ${esc(fx.to)}</span>
          <span class="burst-text">${esc(fx.text || '')}</span>`, { confetti: true });
        break;
      case 'reveal':
        if (fx.confetti) TvFx.confetti();
        TvFx.celebrate();
        break;
      case 'trophy':
        TvFx.confetti();
        TvFx.celebrate();
        break;
      case 'music':
        onMusic(fx);
        break;
      case 'reset':
        location.reload();
        break;
      default:
        break;
    }
  }

  function onMusic(fx) {
    if (fx.action === 'play') {
      // System audio mode: the Mac (Spotify) plays the music; the TV only buzzes and flashes.
      if (fx.audioMode === 'system') return;
      if (!TvAudio.hasTrack()) loadTracks().then(() => TvAudio.play(fx.volume));
      else if (!TvAudio.play(fx.volume)) updateSoundButton();
    } else if (fx.action === 'stop') {
      TvAudio.stop();
      if (fx.silent) return;
      TvAudio.buzzer();
      stopFlash();
      if (fx.game === 'hug') hug.endsAt = Date.now() + STOP_FLASH_MS + HUG_SECONDS * 1000;
    } else if (fx.action === 'next') {
      TvAudio.next(fx.playing);
    } else if (fx.action === 'volume') {
      TvAudio.setVolume(fx.volume);
    }
  }

  async function loadTracks() {
    try {
      const { tracks } = await Party.api('/api/music');
      TvAudio.setTracks(tracks, snap ? snap.physical.trackIndex : 0);
    } catch (err) {
      console.error('[tv] could not load the playlist', err);
    }
  }

  async function hello() {
    try {
      await Party.api('/api/tv/hello', { method: 'POST', body: { audioUnlocked: TvAudio.isUnlocked() } });
    } catch (err) {
      console.error('[tv] hello failed', err.message);
    }
  }

  async function unlockAudio() {
    if (TvAudio.isUnlocked()) return;
    const ok = await TvAudio.unlock();
    updateSoundButton();
    hello();
    if (ok && snap && playlistShouldPlay()) TvAudio.play(snap.physical.volume);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch((err) => console.error('[tv] exit fullscreen', err));
    else document.documentElement.requestFullscreen().catch((err) => console.error('[tv] fullscreen', err));
  }

  function buildGarland() {
    const el = $('garland');
    el.innerHTML = Array.from({ length: GARLAND_STRANDS }, (_, i) => {
      const len = 1 + ((i * 7) % 2); // short strands: they hang above the welcome header
      const flowers = Array.from({ length: len }, () => '<i></i>').join('');
      return `<span class="strand" style="left:${((i + 0.5) / GARLAND_STRANDS) * 100}%">${flowers}<b></b></span>`;
    }).join('');
  }

  function tick() {
    if (!snap) return;
    updateMode();
    if (activeMode === 'question') renderCountdown();
    renderHug();
  }

  function init() {
    buildGarland();
    TvWhosHere.init($('whoshere'), () => { if (activeMode === 'whoshere') renderActive(); });
    TvFx.start($('fx-canvas'));
    TvAudio.init($('music'));
    TvAudio.onUnlockChange(() => updateSoundButton());
    updateSoundButton();
    $('sound-btn').addEventListener('click', unlockAudio);
    document.addEventListener('pointerdown', unlockAudio);
    document.addEventListener('keydown', (e) => {
      unlockAudio();
      if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    });
    Party.connect('/api/events?role=tv', {
      onState,
      onFx,
      onStatus: (ok) => { $('reconnect-pill').hidden = ok; },
    });
    hello();
    setInterval(hello, HELLO_MS);
    setInterval(tick, TICK_MS);
  }

  init();
})();
