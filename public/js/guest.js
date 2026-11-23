/* Guest phone app core: identity, routing, live snapshot, and the Join / Home / Leaderboard / Photo Wall screens.
 * Play + Shout-out live in guest-play.js, the photo editor in editor.js. They talk through window.Guest. */
(function () {
  'use strict';

  const STORAGE_KEY = 'diwaliGuest';
  const REJOIN_DELAY_MS = 1200;
  const ROUTES = ['join', 'about', 'home', 'play', 'shoutout', 'leaderboard', 'wall', 'photo'];
  /** Routes that may be interrupted when a new round opens (never the editor or a half-filled form). */
  const INTERRUPTIBLE_ROUTES = ['home', 'leaderboard', 'wall', 'shoutout'];
  const CHIP_EMOJI = {
    ladoo: '🟠', jalebi: '🌀', 'kaju katli': '💎', 'gulab jamun': '🟤',
    teleport: '✨', invisibility: '👻', 'unlimited chai': '☕', 'mind reading': '🔮',
    first: '🥇', 'on time': '⏰', 'fashionably late': '💃', 'after the food': '🍛',
  };
  const ABOUT_GROUPS = [
    { key: 'sweet', label: 'Favourite Diwali sweet' },
    { key: 'superpower', label: 'Dream superpower' },
    { key: 'arrival', label: 'How I arrive at parties' },
  ];
  const TEXT_FIELDS = ['company', 'funFact', 'talent'];
  const CONFETTI = ['🎉', '✨', '🪔', '🎊', '⭐', '🌼'];
  const CONFETTI_COUNT = 22;

  const esc = (v) => Party.escapeHtml(v);
  const byId = (id) => document.getElementById(id);

  let snapshot = null;
  let identity = loadIdentity();
  let connection = null;
  let rejoinTimer = null;
  let currentRoute = null;
  let celebratedRoundId;
  let formBuilt = false;
  const renderKeys = {};

  // ------------------------------------------------------------ identity

  function newGuestId() {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return `guest_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  }

  /** The id is created before the first join so a refresh mid-form keeps the same identity. */
  function loadIdentity() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && typeof saved.id === 'string' && /^[a-z0-9_-]{8,64}$/i.test(saved.id)) return saved;
    } catch (err) {
      console.warn('[guest] stored identity unreadable, starting fresh', err);
    }
    const fresh = { id: newGuestId(), nickname: '', about: null };
    saveIdentity(fresh);
    return fresh;
  }

  function saveIdentity(value) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch (err) {
      console.warn('[guest] could not save identity (private mode?)', err);
    }
  }

  const isJoined = () => Boolean(identity.nickname);

  // ------------------------------------------------------------ helpers shared with other modules

  function teamOf(teamId) {
    return snapshot?.teams.find((t) => t.id === teamId) || null;
  }

  /** Dark ink on light team colours (gold, orange), cream on dark ones. */
  function readableText(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#FFF6E5';
    const n = parseInt(m[1], 16);
    const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return lum > 0.6 ? '#2A0A12' : '#FFF6E5';
  }

  function teamDot(teamId) {
    const team = teamOf(teamId);
    return `<span class="team-dot" style="background:${esc(team?.color || '#ccc')}"></span>`;
  }

  /** Full-screen celebration: falling confetti, plus a big emoji + line of text when given. */
  function burst(emoji = '', text = '') {
    const wrap = document.createElement('div');
    wrap.className = 'burst';
    const pieces = Array.from({ length: CONFETTI_COUNT }, (_, i) => {
      const left = Math.round(Math.random() * 100);
      const delay = (Math.random() * 0.6).toFixed(2);
      const dur = (1.6 + Math.random() * 1.2).toFixed(2);
      return `<span class="confetti" style="left:${left}%;animation-delay:${delay}s;animation-duration:${dur}s">${CONFETTI[i % CONFETTI.length]}</span>`;
    }).join('');
    const card = text ? `<div class="burst-card"><div class="burst-emoji">${esc(emoji)}</div><p>${esc(text)}</p></div>` : '';
    wrap.innerHTML = pieces + card;
    document.body.appendChild(wrap);
    setTimeout(() => wrap.remove(), 2600);
  }

  function vibrate(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern);
  }

  // ------------------------------------------------------------ routing

  function routeFromHash() {
    const r = location.hash.slice(1);
    return ROUTES.includes(r) ? r : 'home';
  }

  function go(route) {
    if (location.hash === `#${route}`) show(route);
    else location.hash = route;
  }

  function show(requested) {
    let route = requested;
    if (!isJoined()) route = 'join';
    else if (route === 'join') route = 'home';
    const screen = route === 'about' ? 'join' : route;
    const changed = route !== currentRoute;
    currentRoute = route;
    byId('boot').hidden = true;
    document.querySelectorAll('.screen').forEach((s) => { s.hidden = s.dataset.screen !== screen; });
    if (changed) {
      Object.keys(renderKeys).forEach((k) => delete renderKeys[k]);
      window.scrollTo(0, 0);
      if (route === 'join' || route === 'about') prepareCardForm(route);
      if (route === 'photo') window.PhotoEditor.open();
      if (route === 'shoutout') window.GuestPlay.resetShoutout();
    }
    render();
  }

  function render() {
    if (!snapshot) return;
    switch (currentRoute) {
      case 'join': case 'about': renderJoinHeader(); buildCardForm(); break;
      case 'home': renderHome(); break;
      case 'play': window.GuestPlay.renderPlay(snapshot); break;
      case 'shoutout': window.GuestPlay.renderShoutout(snapshot); break;
      case 'leaderboard': renderLeaderboard(); break;
      case 'wall': renderWall(); break;
      case 'photo': window.PhotoEditor.update(snapshot); break;
      default: break;
    }
  }

  /** Re-renders a region only when its data actually changed (keeps scroll + focus stable). */
  function changed(name, value) {
    const key = JSON.stringify(value);
    if (renderKeys[name] === key) return false;
    renderKeys[name] = key;
    return true;
  }

  // ------------------------------------------------------------ live connection

  function connectLive() {
    if (connection) connection.close();
    connection = Party.connect(`/api/events?role=guest&guestId=${encodeURIComponent(identity.id)}`, {
      onState,
      onFx,
      onStatus: (ok) => document.body.classList.toggle('is-offline', !ok),
    });
  }

  /** Backdrop swap is behind BACKDROP_ENABLED in .env; its tab stays hidden unless the server enables it. */
  function applyFeatures(features) {
    const tab = document.querySelector('.ed-tab[data-tab="backdrop"]');
    if (tab) tab.hidden = !features.backdrop;
  }

  function onState(snap) {
    const first = !snapshot;
    snapshot = snap;
    if (first) {
      const r = snap.round;
      celebratedRoundId = r && r.status === 'revealed' ? r.id : null;
    }
    ensureRegistered(snap);
    applyFeatures(snap.content.features || {});
    celebrateResult(snap);
    if (first) show(routeFromHash());
    else render();
  }

  /** Host reset or a wiped server: quietly re-join with the stored card so the guest never notices. */
  function ensureRegistered(snap) {
    if (!isJoined() || snap.me || rejoinTimer) return;
    rejoinTimer = setTimeout(async () => {
      rejoinTimer = null;
      if (!isJoined() || !snapshot || snapshot.me) return;
      try {
        await Party.api('/api/join', { method: 'POST', body: { id: identity.id, nickname: identity.nickname, about: identity.about || {} } });
      } catch (err) {
        console.error('[guest] silent re-join failed', err);
      }
    }, REJOIN_DELAY_MS);
  }

  function celebrateResult(snap) {
    const r = snap.round;
    if (!r || r.status !== 'revealed' || !r.results || celebratedRoundId === r.id) return;
    celebratedRoundId = r.id;
    const mine = snap.me?.round;
    if (r.type === 'poll' || !mine || mine.id !== r.id || mine.answer === null || r.results.correct === null) return;
    if (mine.answer === r.results.correct) {
      vibrate([60, 40, 60]);
      burst('🎉', `Correct! +10 for Team ${teamOf(snap.me.teamId)?.name || ''}`);
    }
  }

  function onFx(fx) {
    switch (fx.type) {
      case 'reset': handleReset(); break;
      case 'title': sparkleTitle(); break;
      case 'roundOpen': onRoundOpen(); break;
      case 'trophy': burst('🏆', 'Trophy time! Look at the TV'); break;
      case 'captions': window.PhotoEditor.onFx(fx); break;
      case 'music': window.GuestPlay.handleFx(fx); break;
      default: break;
    }
  }

  function onRoundOpen() {
    vibrate(80);
    if (!isJoined()) return;
    if (INTERRUPTIBLE_ROUTES.includes(currentRoute)) go('play');
    else if (currentRoute !== 'play') Party.toast('📺 A new game just started! Tap Play when you are ready.');
  }

  function handleReset() {
    clearTimeout(rejoinTimer);
    rejoinTimer = null;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      console.warn('[guest] could not clear identity', err);
    }
    identity = loadIdentity();
    snapshot = null;
    formBuilt = false;
    connectLive();
    Party.toast('The party was restarted. Please join again 🪔');
    go('join');
  }

  // ------------------------------------------------------------ join / About Me

  function renderJoinHeader() {
    if (!changed('joinHeader', snapshot.party)) return;
    byId('join-welcome').textContent = snapshot.party.welcomeLine;
    byId('join-party').textContent = `✨ ${snapshot.party.name} ✨`;
  }

  function buildCardForm() {
    if (formBuilt) return;
    formBuilt = true;
    const options = snapshot.content.aboutOptions;
    byId('chip-groups').innerHTML = ABOUT_GROUPS.map((g) => `
      <fieldset class="chip-group" data-group="${g.key}">
        <legend class="field-label">${esc(g.label)}</legend>
        <div class="chips">${(options[g.key] || []).map((opt) => `
          <button type="button" class="btn chip" data-value="${esc(opt)}" aria-pressed="false">
            <span class="chip-emoji">${CHIP_EMOJI[opt] || '✨'}</span>${esc(opt)}
          </button>`).join('')}
        </div>
      </fieldset>`).join('');
    fillCardForm(currentRoute === 'about' ? snapshot.me?.about || identity.about : identity.about);
  }

  function fillCardForm(about) {
    const form = byId('card-form');
    form.nickname.value = identity.nickname || form.nickname.value;
    TEXT_FIELDS.forEach((f) => { form[f].value = about?.[f] || ''; });
    document.querySelectorAll('.chip-group').forEach((group) => {
      const value = about?.[group.dataset.group];
      group.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.value === value)));
    });
  }

  function prepareCardForm(route) {
    const editing = route === 'about';
    byId('join-hero').hidden = editing;
    byId('about-bar').hidden = !editing;
    byId('card-submit').textContent = editing ? '💾 Save my card' : '🪔 Join the party';
    if (formBuilt) fillCardForm(editing ? snapshot?.me?.about || identity.about : identity.about);
  }

  function selectedChip(group) {
    return document.querySelector(`.chip-group[data-group="${group}"] .chip[aria-pressed="true"]`)?.dataset.value || '';
  }

  async function submitCard(e) {
    e.preventDefault();
    const form = byId('card-form');
    const nickname = form.nickname.value.trim();
    if (!nickname) {
      Party.toast('Please type a nickname first', { error: true });
      form.nickname.focus();
      return;
    }
    const about = Object.fromEntries(TEXT_FIELDS.map((f) => [f, form[f].value.trim()]));
    ABOUT_GROUPS.forEach((g) => { about[g.key] = selectedChip(g.key); });
    const button = byId('card-submit');
    const label = button.textContent;
    const wasJoined = isJoined();
    button.disabled = true;
    button.textContent = wasJoined ? 'Saving…' : 'Joining…';
    try {
      const res = await Party.api('/api/join', { method: 'POST', body: { id: identity.id, nickname, about } });
      identity = { id: res.me.id, nickname: res.me.nickname, about: res.me.about };
      saveIdentity(identity);
      if (wasJoined) {
        Party.toast('Your card is saved ✨');
        go('home');
      } else {
        document.activeElement?.blur();
        showTeamReveal(res.team);
      }
    } catch (err) {
      Party.toast(err.message, { error: true });
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  function showTeamReveal(team) {
    const overlay = byId('team-reveal');
    overlay.style.background = `radial-gradient(circle at 50% 30%, rgba(255,255,255,0.35), transparent 60%), ${team.color}`;
    overlay.style.color = readableText(team.color);
    byId('team-reveal-name').textContent = `Team ${team.name}`;
    overlay.hidden = false;
    vibrate([80, 60, 80]);
  }

  function closeTeamReveal() {
    byId('team-reveal').hidden = true;
    go('home');
  }

  // ------------------------------------------------------------ home

  function renderHome() {
    const me = snapshot.me;
    const team = me && teamOf(me.teamId);
    byId('home-party').textContent = `🪔 ${snapshot.party.name}`;
    byId('home-name').textContent = me?.nickname || identity.nickname;
    byId('home-title').textContent = me?.title ? `“${me.title}”` : '';
    byId('home-team').textContent = team ? `Team ${team.name}` : 'Finding your team…';
    byId('home-team-dot').style.background = team?.color || '#ccc';
    byId('me-card').style.setProperty('--team', team?.color || '#D4A017');
    byId('home-banner-text').textContent = snapshot.banner;
    const live = (snapshot.round && snapshot.round.status === 'open')
      || (snapshot.couples && snapshot.couples.status === 'answering' && snapshot.couples.me);
    byId('play-badge').hidden = !live;
    byId('tile-play').classList.toggle('is-live', Boolean(live));
  }

  function sparkleTitle() {
    const el = byId('home-title');
    el.classList.remove('sparkle');
    void el.offsetWidth;
    el.classList.add('sparkle');
    Party.toast('✨ You got a new party title!');
  }

  // ------------------------------------------------------------ leaderboard

  function renderLeaderboard() {
    if (!changed('lb', [snapshot.teams, snapshot.me?.teamId])) return;
    const medals = ['🥇', '🥈', '🥉'];
    byId('lb-list').innerHTML = snapshot.teams.map((t, i) => `
      <li class="lb-team${t.id === snapshot.me?.teamId ? ' is-mine' : ''}" style="--team:${esc(t.color)}">
        <div class="lb-head">
          <span class="lb-rank">${(t.score > 0 && medals[i]) || i + 1}</span>
          <span class="lb-name">Team ${esc(t.name)}${t.id === snapshot.me?.teamId ? '<small>your team</small>' : ''}</span>
          <span class="lb-score">${t.score}<small>pts</small></span>
        </div>
        <p class="lb-meta">${t.members} ${t.members === 1 ? 'guest' : 'guests'}</p>
        ${t.top.length ? `<ul class="lb-top">${t.top.map((g) => `
          <li><span class="lb-guest">${esc(g.nickname)}</span><span class="lb-title">${esc(g.title)}</span><b>${g.points}</b></li>`).join('')}
        </ul>` : ''}
      </li>`).join('');
  }

  // ------------------------------------------------------------ photo wall

  function renderWall() {
    const me = snapshot.me;
    const pending = (me?.myPhotos || []).filter((p) => p.status === 'pending').length;
    const pendingEl = byId('wall-pending');
    pendingEl.hidden = !pending;
    pendingEl.textContent = `⏳ ${pending} of your photos ${pending === 1 ? 'is' : 'are'} waiting for the host to approve.`;
    if (!changed('wall', [snapshot.photos, me?.hearted, me?.id])) return;
    const hearted = new Set(me?.hearted || []);
    byId('wall-grid').innerHTML = snapshot.photos.length ? snapshot.photos.map((p) => `
      <figure class="wall-card">
        <img src="${esc(p.url)}" alt="${esc(p.caption || `Photo by ${p.nickname}`)}" loading="lazy" decoding="async">
        <figcaption>
          ${p.caption ? `<p class="wall-caption">${esc(p.caption)}</p>` : ''}
          <p class="wall-by">${teamDot(p.teamId)}${esc(p.nickname)}</p>
        </figcaption>
        <div class="wall-actions">
          <button type="button" class="btn heart-btn${hearted.has(p.id) ? ' is-hearted' : ''}" data-heart="${esc(p.id)}" aria-label="Heart this photo">
            <span class="heart">${hearted.has(p.id) ? '❤️' : '🤍'}</span><span class="heart-count">${p.hearts}</span>
          </button>
          ${p.guestId === me?.id ? `<button type="button" class="btn btn-ghost edit-cap" data-edit-caption="${esc(p.id)}">✏️ Caption</button>` : ''}
        </div>
      </figure>`).join('') : `
      <div class="empty-state">
        <div class="empty-emoji">📷</div>
        <p>No photos yet. Be the first!</p>
        <button type="button" class="btn btn-gold" data-go="photo">📷 Photo Fun</button>
      </div>`;
  }

  async function heartPhoto(button) {
    const id = button.dataset.heart;
    if (button.classList.contains('is-hearted')) {
      Party.toast('You already love this one ❤️');
      return;
    }
    button.classList.add('is-hearted', 'pop');
    button.querySelector('.heart').textContent = '❤️';
    const count = button.querySelector('.heart-count');
    count.textContent = String(Number(count.textContent) + 1);
    try {
      const res = await Party.api(`/api/photos/${encodeURIComponent(id)}/heart`, { method: 'POST', body: { guestId: identity.id } });
      count.textContent = String(res.hearts);
    } catch (err) {
      Party.toast(err.message, { error: true });
      delete renderKeys.wall;
      render();
    }
  }

  let editingPhotoId = null;

  function openCaptionSheet(photoId) {
    const photo = snapshot.photos.find((p) => p.id === photoId);
    editingPhotoId = photoId;
    const input = byId('caption-sheet-input');
    input.value = photo?.caption || '';
    byId('caption-sheet').hidden = false;
    input.focus();
  }

  function closeCaptionSheet() {
    byId('caption-sheet').hidden = true;
    editingPhotoId = null;
  }

  async function saveCaptionSheet(e) {
    e.preventDefault();
    const caption = byId('caption-sheet-input').value.trim();
    const photoId = editingPhotoId;
    closeCaptionSheet();
    try {
      await Party.api(`/api/photos/${encodeURIComponent(photoId)}/caption`, { method: 'POST', body: { guestId: identity.id, caption } });
      Party.toast('Caption updated ✨');
    } catch (err) {
      Party.toast(err.message, { error: true });
    }
  }

  // ------------------------------------------------------------ wiring

  function onClick(e) {
    const target = e.target;
    const goBtn = target.closest('[data-go]');
    if (goBtn) {
      go(goBtn.dataset.go);
      return;
    }
    const chip = target.closest('.chip-group .chip');
    if (chip) {
      chip.closest('.chips').querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      return;
    }
    const heart = target.closest('[data-heart]');
    if (heart) {
      heartPhoto(heart);
      return;
    }
    const editCap = target.closest('[data-edit-caption]');
    if (editCap) {
      openCaptionSheet(editCap.dataset.editCaption);
      return;
    }
    if (target.closest('[data-close-sheet]') || target === byId('caption-sheet')) closeCaptionSheet();
    if (target.closest('#home-banner') && snapshot && (snapshot.round || snapshot.couples || snapshot.physical.game)) go('play');
  }

  function start() {
    Party.pressFeedback();
    document.addEventListener('click', onClick);
    byId('card-form').addEventListener('submit', submitCard);
    byId('caption-sheet-form').addEventListener('submit', saveCaptionSheet);
    const reveal = byId('team-reveal');
    reveal.addEventListener('click', closeTeamReveal);
    reveal.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') closeTeamReveal(); });
    window.addEventListener('hashchange', () => show(routeFromHash()));
    connectLive();
  }

  window.Guest = {
    get snapshot() { return snapshot; },
    get id() { return identity.id; },
    get route() { return currentRoute; },
    go, teamOf, teamDot, readableText, burst, vibrate,
  };

  document.addEventListener('DOMContentLoaded', start);
})();
