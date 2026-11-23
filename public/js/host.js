/*
 * Host dashboard core: PIN login, live state, the render pipeline, event
 * delegation, the Run Party strip and the tab bar. Each tab's panel lives in
 * its own file (host-people.js, host-questions.js, host-games.js,
 * host-setup.js) and registers itself through window.Host.
 *
 * Rendering: every panel is a pure function state -> HTML string. A panel is
 * only re-rendered when its HTML actually changed, never while the host is
 * typing in one of its fields, and any field the host edited but did not save
 * keeps its value across a re-render.
 */
(function () {
  'use strict';

  const TV_MODE_LABELS = { welcome: 'Welcome', slideshow: 'Slideshow', wall: 'Photo Wall', leaderboard: 'Leaderboard', whoshere: "Who's here" };
  const PIN_KEY = 'diwaliHostPin';
  const TAB_KEY = 'diwaliHostTab';
  const NEXT_TYPE_KEY = 'diwaliHostNextType';
  const CONFIRM_MS = 3500;
  const SUCCESS_TOAST_MS = 1800;
  const TICK_MS = 250;
  const TABS = [
    { id: 'guests', label: 'Guests', icon: '👥' },
    { id: 'photos', label: 'Photos', icon: '📸' },
    { id: 'questions', label: 'Questions', icon: '❓' },
    { id: 'rounds', label: 'Rounds', icon: '🎯' },
    { id: 'couples', label: 'Couples', icon: '💑' },
    { id: 'games', label: 'Floor Games', icon: '🎵' },
    { id: 'tv', label: 'TV', icon: '📺' },
    { id: 'setup', label: 'Setup', icon: '⚙️' },
  ];
  const NEXT_TYPES = [
    { id: 'quiz', label: 'Quiz' },
    { id: 'poll', label: 'Poll' },
    { id: 'guessWho', label: 'Guess Who' },
  ];
  const ROUND_LABELS = { quiz: 'Quiz', poll: 'Poll', guessWho: 'Guess Who' };

  const panels = {};
  const actions = {};
  const changes = {};
  const inputs = {};
  const submits = {};
  const lastHtml = {};
  const deferred = new Set();

  let pin = '';
  let state = null;
  let stream = null;
  let activeTab = storageGet(TAB_KEY) || 'guests';
  let nextType = storageGet(NEXT_TYPE_KEY) || 'quiz';
  let awardOpen = false;

  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (v) => Party.escapeHtml(v);

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (err) {
      console.warn('[host] localStorage unavailable:', err.message);
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (err) {
      console.warn('[host] localStorage unavailable:', err.message);
    }
  }

  // ------------------------------------------------------------------ API

  /**
   * Calls a host route with the PIN. Returns the JSON body, or null after
   * showing the server's message as a toast. A 401 sends the host back to login.
   */
  async function call(path, { method = 'POST', body, ok } = {}) {
    try {
      const data = await Party.api(`/api/host${path}`, {
        method, body: method === 'GET' ? undefined : body || {}, headers: { 'x-host-pin': pin },
      });
      if (ok) Party.toast(ok, { ms: SUCCESS_TOAST_MS });
      return data;
    } catch (err) {
      if (err.status === 401) {
        logout('Wrong PIN. Please log in again.');
        return null;
      }
      Party.toast(err.message, { error: true, ms: 4000 });
      if (state) refresh();
      return null;
    }
  }

  /** Re-fetches the snapshot, e.g. to undo an optimistic change the server rejected. */
  async function refresh() {
    try {
      const data = await Party.api('/api/host/state', { headers: { 'x-host-pin': pin } });
      applyState(data);
    } catch (err) {
      console.warn('[host] refresh failed:', err.message);
    }
  }

  // ------------------------------------------------------------------ login

  async function tryLogin(candidate, { silent = false } = {}) {
    try {
      await Party.api('/api/host/login', { method: 'POST', body: {}, headers: { 'x-host-pin': candidate } });
    } catch (err) {
      if (err.status === 401 || err.status === 429) storageSet(PIN_KEY, null);
      showLogin(silent && err.status === 401 ? '' : err.message);
      return;
    }
    pin = candidate;
    storageSet(PIN_KEY, pin);
    enterApp();
  }

  function showLogin(message = '') {
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#login-error').textContent = message;
    const input = $('#pin-input');
    input.value = '';
    input.focus();
  }

  function logout(message) {
    if (stream) stream.close();
    stream = null;
    state = null;
    pin = '';
    storageSet(PIN_KEY, null);
    Object.keys(lastHtml).forEach((k) => delete lastHtml[k]);
    showLogin(message);
  }

  async function enterApp() {
    $('#login').hidden = true;
    $('#app').hidden = false;
    renderTabs();
    showTab(activeTab);
    await refresh();
    stream = Party.connect(`/api/events?role=host&pin=${encodeURIComponent(pin)}`, {
      onState: applyState,
      onFx: handleFx,
      onStatus: (online) => $('#conn').classList.toggle('is-online', online),
    });
  }

  function handleFx(fx) {
    if (fx.type === 'newPhoto') {
      if (state && state.host.settings.approvalMode) Party.toast(`📸 ${fx.nickname} shared a photo: approve it in Photos`);
    } else if (fx.type === 'music' && fx.action === 'stop' && fx.reason !== 'end') {
      Party.toast(fx.reason === 'random' ? '⏹ Random stop! Music stopped' : '⏹ Music stopped');
      if (navigator.vibrate) navigator.vibrate(200);
    } else if (fx.type === 'reset') {
      Party.toast('Event was reset');
    }
  }

  // ------------------------------------------------------------------ rendering

  function applyState(next) {
    state = next;
    renderAll();
  }

  function renderAll() {
    if (!state) return;
    renderHeader();
    renderTabBadges();
    renderPanel(activeTab);
    tick();
  }

  function isEditing(root) {
    const el = document.activeElement;
    return Boolean(el && root.contains(el) && el.matches('input:not([type=checkbox]):not([type=radio]), textarea, select'));
  }

  function fieldKey(el) {
    const scope = el.closest('[data-key]')?.dataset.key || '';
    const choice = el.type === 'radio' || el.type === 'checkbox' ? `|${el.value}` : '';
    return el.name ? `${scope}|${el.name}${choice}` : null;
  }

  /** Captures fields the host changed but has not saved yet. */
  function dirtyFields(root) {
    const saved = new Map();
    for (const el of root.querySelectorAll('input, textarea, select')) {
      const key = fieldKey(el);
      if (!key) continue;
      if (el.type === 'checkbox' || el.type === 'radio') {
        if (el.checked !== el.defaultChecked) saved.set(key, { checked: el.checked });
      } else if (el.tagName === 'SELECT') {
        if ([...el.options].some((o) => o.selected !== o.defaultSelected)) saved.set(key, { value: el.value });
      } else if (el.value !== el.defaultValue) {
        saved.set(key, { value: el.value });
      }
    }
    return saved;
  }

  function restoreFields(root, saved) {
    if (!saved.size) return;
    for (const el of root.querySelectorAll('input, textarea, select')) {
      const entry = saved.get(fieldKey(el));
      if (!entry) continue;
      if ('checked' in entry) el.checked = entry.checked;
      else el.value = entry.value;
      // Let live helpers (e.g. the RESET confirmation) re-derive their UI from the restored value.
      if (el.dataset.input) el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function renderPanel(name, { force = false } = {}) {
    const root = $(`[data-panel="${name}"]`);
    const render = panels[name];
    if (!root || !render || !state) return;
    const html = render(state);
    if (!force && html === lastHtml[name]) return;
    if (!force && isEditing(root)) {
      deferred.add(name);
      return;
    }
    const saved = dirtyFields(root);
    root.innerHTML = html;
    restoreFields(root, saved);
    lastHtml[name] = html;
    deferred.delete(name);
    tick();
  }

  function renderHeader() {
    const s = state;
    $('#brand-name').textContent = `Host · ${s.party.name}`;
    $('#guest-count').textContent = `${s.guests.length} guest${s.guests.length === 1 ? '' : 's'}`;
    $('#status-line').innerHTML = statusLine(s);

    const pending = s.host.photos.filter((p) => p.status === 'pending').length;
    const badge = $('#strip-photo-badge');
    badge.hidden = !(s.host.settings.approvalMode && pending);
    badge.textContent = pending;

    const r = s.round;
    const couplesLive = s.couples && s.couples.status !== 'done';
    $('#strip-reveal').disabled = !((r && r.status !== 'revealed') || couplesLive);

    $('#next-type').innerHTML = `<span class="next-type-label">Next question:</span>${NEXT_TYPES.map((t) => `
      <button type="button" role="radio" aria-checked="${t.id === nextType}" class="seg${t.id === nextType ? ' is-on' : ''}"
        data-action="next-type" data-type="${t.id}">${t.label}</button>`).join('')}`;

    renderAwardConfirm();
    renderWarnings();
  }

  function statusLine(s) {
    const r = s.round;
    const p = s.physical;
    if (r) {
      const pill = { open: 'Open', closed: 'Closed', revealed: 'Revealed' }[r.status];
      const label = r.type === 'quiz' ? `Quiz Q${r.number}` : r.category;
      const timer = r.status === 'open' && r.endsAt ? ` · <span class="countdown" data-ends-at="${r.endsAt}"></span>` : '';
      return `<span class="pill pill-${r.status}">${pill}</span>
        <span class="status-text"><b>${esc(label)}</b> ${esc(r.text)}</span>
        <span class="status-meta">${r.submissions} answer${r.submissions === 1 ? '' : 's'}${timer}</span>`;
    }
    if (p.game) {
      const st = { ready: 'Ready', playing: '▶ Playing', stopped: '⏹ Stopped', idle: 'Idle' }[p.status];
      return `<span class="pill pill-${p.status === 'playing' ? 'open' : 'closed'}">${st}</span>
        <span class="status-text"><b>${esc(p.info.name)}</b> Round ${p.round}</span>
        <span class="status-meta">${p.remaining} ${esc(p.info.unit.toLowerCase())}</span>`;
    }
    if (s.couples && s.couples.status !== 'done') {
      return `<span class="pill pill-open">Couples</span>
        <span class="status-text"><b>Couples Quiz</b> ${s.couples.revealIndex + 1} of ${s.couples.questions.length} revealed</span>`;
    }
    const mode = s.tv.pinned ? `TV pinned to ${TV_MODE_LABELS[s.tv.pinned] || s.tv.pinned}` : 'TV on auto-cycle';
    return `<span class="pill pill-idle">Idle</span><span class="status-text">${esc(mode)} · ${s.photos.length} photos live</span>`;
  }

  function renderAwardConfirm() {
    const box = $('#award-confirm');
    box.hidden = !awardOpen;
    if (!awardOpen) return;
    const live = state.host.photos.filter((p) => p.status === 'live');
    if (!live.length) {
      box.innerHTML = `<span>No photos on the wall yet.</span>
        <button class="btn btn-ghost btn-sm" type="button" data-action="award-cancel">OK</button>`;
      return;
    }
    const best = live.reduce((a, b) => (b.hearts > a.hearts ? b : a));
    box.innerHTML = `<img src="${esc(photoSrc(best))}" alt="">
      <span>Award Best Photo to <b>${esc(best.nickname)}</b> (${best.hearts} ❤️)? +20 points to their team.</span>
      <span class="award-actions">
        <button class="btn btn-gold btn-sm" type="button" data-action="award-confirm">Award 🏆</button>
        <button class="btn btn-ghost btn-sm" type="button" data-action="award-cancel">Cancel</button>
      </span>`;
  }

  function renderWarnings() {
    const tv = state.host.tvStatus;
    const items = [];
    if (!tv.connected) items.push('📺 TV not connected: open <b>/tv</b> in Chrome on the Mac');
    else if (!tv.audioUnlocked) items.push('🔇 TV sound is off — click \'Tap to enable sound\' on the TV once');
    $('#warnings').innerHTML = items.map((t) => `<div class="warning">${t}</div>`).join('');
  }

  function renderTabs() {
    $('#tabs').innerHTML = TABS.map((t) => `
      <button type="button" class="tab" data-action="tab" data-tab="${t.id}" aria-current="${t.id === activeTab}">
        <span aria-hidden="true">${t.icon}</span> ${t.label}<span class="badge" data-tab-badge="${t.id}" hidden></span>
      </button>`).join('');
  }

  function renderTabBadges() {
    const pending = state.host.photos.filter((p) => p.status === 'pending').length;
    const aiPending = state.host.pendingAiQuestions.length;
    const counts = { photos: pending, questions: aiPending };
    for (const el of document.querySelectorAll('[data-tab-badge]')) {
      const n = counts[el.dataset.tabBadge] || 0;
      el.hidden = !n;
      el.textContent = n;
    }
  }

  function showTab(name, anchor) {
    activeTab = TABS.some((t) => t.id === name) ? name : 'guests';
    storageSet(TAB_KEY, activeTab);
    for (const el of document.querySelectorAll('.tab')) el.setAttribute('aria-current', String(el.dataset.tab === activeTab));
    for (const el of document.querySelectorAll('.panel')) el.hidden = el.dataset.panel !== activeTab;
    $(`.tab[data-tab="${activeTab}"]`)?.scrollIntoView({ block: 'nearest', inline: 'center' });
    renderPanel(activeTab);
    const target = anchor ? document.getElementById(anchor) : $('.panels');
    if (target) {
      const top = target.getBoundingClientRect().top + window.scrollY - $('.top').offsetHeight - 8;
      window.scrollTo({ top: Math.max(0, anchor ? top : Math.min(window.scrollY, top)) });
    }
  }

  /** Updates every countdown on screen from the server-synchronised clock. */
  function tick() {
    for (const el of document.querySelectorAll('[data-ends-at]')) {
      const left = Math.max(0, Math.ceil((Number(el.dataset.endsAt) - Party.now()) / 1000));
      el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      el.classList.toggle('is-low', left <= 5);
    }
  }

  // ------------------------------------------------------------------ helpers for panels

  function team(teamId) {
    return state.teams.find((t) => t.id === teamId) || null;
  }

  function teamDot(teamId) {
    const t = team(teamId);
    return `<span class="team-dot" style="background:${esc(t ? t.color : '#bbb')}"></span>`;
  }

  function guestName(id) {
    return state.host.guests.find((g) => g.id === id)?.nickname || 'Someone';
  }

  /** Pending and hidden photos are only served to the host, with the PIN. */
  function photoSrc(photo) {
    return photo.status === 'live' ? photo.url : `${photo.url}?pin=${encodeURIComponent(pin)}`;
  }

  function teamOptions(selected, { blank } = {}) {
    const first = blank ? `<option value="">${esc(blank)}</option>` : '';
    return first + state.teams.map((t) => `<option value="${esc(t.id)}"${t.id === selected ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
  }

  function guestOptions(selected, { blank, exclude = [] } = {}) {
    const first = blank ? `<option value="">${esc(blank)}</option>` : '';
    return first + state.host.guests.filter((g) => !exclude.includes(g.id))
      .map((g) => `<option value="${esc(g.id)}"${g.id === selected ? ' selected' : ''}>${esc(g.nickname)}${team(g.teamId) ? ` · ${esc(team(g.teamId).name)}` : ''}</option>`).join('');
  }

  /**
   * Clears a form after a successful save. Looks the form up again by its
   * data-key because a live update may have re-rendered it meanwhile.
   */
  function resetForm(form) {
    const live = form.dataset.key ? document.querySelector(`[data-key="${CSS.escape(form.dataset.key)}"]`) : form;
    if (live) live.reset();
  }

  /** A labelled on/off switch; `field` names the checkbox when it lives inside a form. */
  function toggle(name, checked, label, hint = '', field = '') {
    return `<label class="switch">
      <input type="checkbox" data-change="${name}"${field ? ` name="${field}"` : ''}${checked ? ' checked' : ''}>
      <span class="switch-track" aria-hidden="true"></span>
      <span class="switch-text">${label}${hint ? `<small>${hint}</small>` : ''}</span>
    </label>`;
  }

  // ------------------------------------------------------------------ event delegation

  function armConfirm(el) {
    if (el.dataset.armed) return true;
    el.dataset.armed = '1';
    el.dataset.label = el.innerHTML;
    el.innerHTML = esc(el.dataset.confirm);
    el.classList.add('is-armed');
    setTimeout(() => {
      if (!el.isConnected || !el.dataset.armed) return;
      delete el.dataset.armed;
      el.innerHTML = el.dataset.label;
      el.classList.remove('is-armed');
    }, CONFIRM_MS);
    return false;
  }

  function runBusy(el, result) {
    if (!result || typeof result.then !== 'function') return;
    el.classList.add('is-busy');
    result.finally(() => el.classList.remove('is-busy'));
  }

  function bindEvents() {
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el || el.disabled) return;
      const handler = actions[el.dataset.action];
      if (!handler) {
        console.error(`[host] no action handler for "${el.dataset.action}"`);
        return;
      }
      if (el.dataset.confirm && !armConfirm(el)) return;
      e.preventDefault();
      runBusy(el, handler(el, e));
    });
    document.addEventListener('change', (e) => {
      const el = e.target.closest('[data-change]');
      if (!el) return;
      runBusy(el, changes[el.dataset.change](el, e));
      if (el.tagName === 'SELECT' || el.type === 'checkbox') el.blur();
    });
    document.addEventListener('input', (e) => {
      const el = e.target.closest('[data-input]');
      if (el) inputs[el.dataset.input](el, e);
    });
    document.addEventListener('submit', (e) => {
      const form = e.target.closest('[data-submit]');
      if (!form) return;
      e.preventDefault();
      // Leaving the field closes the phone keyboard and lets deferred live updates render.
      if (form.contains(document.activeElement)) document.activeElement.blur();
      const btn = form.querySelector('[type=submit]') || form;
      runBusy(btn, submits[form.dataset.submit](form, Object.fromEntries(new FormData(form))));
    });
    document.addEventListener('focusout', () => {
      setTimeout(() => {
        for (const name of [...deferred]) if (name === activeTab) renderPanel(name);
      }, 0);
    });
  }

  // ------------------------------------------------------------------ core actions

  Object.assign(submits, {
    login(form, data) {
      const candidate = String(data.pin || '').trim();
      if (!candidate) return null;
      $('#login-error').textContent = '';
      return tryLogin(candidate);
    },
  });

  Object.assign(actions, {
    tab: (el) => showTab(el.dataset.tab),
    'next-type'(el) {
      nextType = el.dataset.type;
      storageSet(NEXT_TYPE_KEY, nextType);
      renderHeader();
    },
    'strip-photos': () => showTab('photos'),
    'strip-physical': () => showTab('games', 'physical'),
    'strip-next'() {
      const label = NEXT_TYPES.find((t) => t.id === nextType).label;
      return call('/round/next', { body: { type: nextType }, ok: `${label} question is live on the TV` });
    },
    async 'strip-reveal'() {
      if (state.round && state.round.status !== 'revealed') {
        return call('/round/reveal', { ok: `${ROUND_LABELS[state.round.type]} answer revealed ✨` });
      }
      return call('/couples/reveal-next', { ok: 'Next couples answer revealed 💑' });
    },
    'strip-award'() {
      awardOpen = !awardOpen;
      renderAwardConfirm();
    },
    'award-cancel'() {
      awardOpen = false;
      renderAwardConfirm();
    },
    async 'award-confirm'() {
      awardOpen = false;
      renderAwardConfirm();
      return call('/award-best-photo', { ok: '🏆 Best Photo trophy is on the TV' });
    },
    logout: () => logout(''),
  });

  // ------------------------------------------------------------------ public API for panel files

  window.Host = {
    get state() { return state; },
    get pin() { return pin; },
    esc,
    call,
    refresh,
    render: renderAll,
    /** Re-renders the active panel now (local UI change), even mid-edit; unsaved field values are kept. */
    rerender: () => renderPanel(activeTab, { force: true }),
    showTab,
    team,
    teamDot,
    guestName,
    photoSrc,
    teamOptions,
    guestOptions,
    toggle,
    resetForm,
    register({ panel, render, actions: a = {}, changes: c = {}, inputs: i = {}, submits: s = {} }) {
      if (panel) panels[panel] = render;
      Object.assign(actions, a);
      Object.assign(changes, c);
      Object.assign(inputs, i);
      Object.assign(submits, s);
    },
  };

  document.addEventListener('DOMContentLoaded', () => {
    Party.pressFeedback();
    bindEvents();
    setInterval(tick, TICK_MS);
    const saved = storageGet(PIN_KEY);
    if (saved) tryLogin(saved, { silent: true });
    else showLogin();
  });
})();
