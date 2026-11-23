/* Host dashboard: TV tab (mode, pause, commentator, trophy) and Setup tab (joining, party details, reset). */
(function () {
  'use strict';

  const H = window.Host;
  const esc = H.esc;
  const RESET_WORD = 'RESET';
  const TV_MODES = [
    { id: null, label: 'Auto-cycle', icon: '🔁', hint: "Slideshow, leaderboard, who's here" },
    { id: 'welcome', label: 'Welcome', icon: '🪔', hint: 'Before guests arrive (not in the cycle)' },
    { id: 'slideshow', label: 'Slideshow', icon: '🖼️', hint: 'Newest photos' },
    { id: 'wall', label: 'Photo Wall', icon: '🧱', hint: 'Most-hearted mosaic' },
    { id: 'leaderboard', label: 'Leaderboard', icon: '🏅', hint: 'Team scores' },
    { id: 'whoshere', label: "Who's here", icon: '🪔', hint: 'Guest diya graph' },
  ];

  // ------------------------------------------------------------------ TV

  function renderTv(s) {
    const tv = s.host.tvStatus;
    const busy = s.round || s.physical.game || (s.couples && s.couples.status !== 'done');
    return `<div class="panel-head"><h2>TV</h2>
        <span class="tv-status ${tv.connected ? 'is-ok' : 'is-bad'}">${tv.connected ? `Connected · sound ${tv.audioUnlocked ? 'on' : 'off'}` : 'Not connected'}</span>
      </div>
      ${busy ? '<p class="note">A game is on the TV right now. Your choice applies when it ends.</p>' : ''}
      <div class="mode-grid">${TV_MODES.map((m) => {
        const on = s.tv.pinned === m.id;
        return `<button type="button" class="mode-card${on ? ' is-on' : ''}" data-action="tv-mode" data-mode="${m.id || ''}" aria-pressed="${on}">
          <span class="mode-icon" aria-hidden="true">${m.icon}</span><b>${m.label}</b><small>${m.id ? (on ? 'Pinned' : 'Pin this') : m.hint}</small></button>`;
      }).join('')}</div>
      <div class="card">
        ${H.toggle('tv-paused', s.tv.paused, 'Pause slideshow', 'Hold the current photo on screen')}
        ${H.toggle('commentator', s.host.settings.commentator, 'Commentator', 'A friendly line about the scores after each reveal')}
      </div>
      <div class="card">
        <h3>Trophy</h3>
        ${s.trophy ? `<p class="lead">🏆 <b>${esc(s.trophy.title)}</b>: ${esc(s.trophy.name)}</p>
          <button class="btn btn-ghost" type="button" data-action="trophy-clear">Clear trophy from TV</button>`
          : '<p class="hint">No trophy on screen.</p>'}
        ${s.commentary ? `<p class="hint">Latest commentary: “${esc(s.commentary.text)}”</p>` : ''}
      </div>`;
  }

  // ------------------------------------------------------------------ Setup

  function aiLine(ai) {
    if (ai.disabled) return 'AI is switched off: using preset titles, captions and questions.';
    if (ai.ok === false) return `AI unavailable, using presets${ai.detail ? ` (${esc(ai.detail)})` : ''}.`;
    if (ai.ok) return `AI is working${ai.running ? ' · busy' : ''}.`;
    return 'AI not used yet. Presets show instantly while it works.';
  }

  function renderSetup(s) {
    const h = s.host;
    const others = h.lanUrls.filter((u) => u !== s.joinUrl);
    return `<div class="panel-head"><h2>Setup</h2></div>
      <div class="card join-card">
        <div class="qr">${Party.qrSvg(s.joinUrl)}</div>
        <div>
          <h3>Guests join at</h3>
          <p class="join-url">${esc(s.joinUrl)}</p>
          ${others.length ? `<p class="hint">Also reachable: ${others.map(esc).join(' · ')}</p>` : ''}
          <p class="hint">${h.guestClients} phone${h.guestClients === 1 ? '' : 's'} connected · ${h.tvClients} TV screen${h.tvClients === 1 ? '' : 's'}</p>
          <p class="pin-line">Host PIN <b>${esc(h.pin)}</b></p>
        </div>
      </div>
      <form class="card" data-submit="settings" data-key="settings">
        <h3>Party</h3>
        <label class="field">Party name<input type="text" name="partyName" value="${esc(h.settings.partyName)}" maxlength="40" required></label>
        <label class="field">Hosts (comma separated)<input type="text" name="hosts" value="${esc(h.settings.hosts.join(', '))}" maxlength="200" required></label>
        <p class="hint">TV shows: “${esc(s.party.welcomeLine)}”</p>
        <button class="btn btn-gold" type="submit">Save</button>
      </form>
      <div class="card">
        ${H.toggle('approval-mode', h.settings.approvalMode, 'Approval Mode', 'New photos wait for you in the Photos tab')}
        ${H.toggle('commentator', h.settings.commentator, 'Commentator', 'AI line about the scores on the TV')}
        <p class="quiet">🤖 ${aiLine(h.ai)}</p>
        <p class="quiet">🎵 ${h.tracks} music track${h.tracks === 1 ? '' : 's'} · drop MP3s into <code>data/music/</code></p>
      </div>
      <form class="card danger-zone" data-submit="reset" data-key="reset">
        <h3>Reset Event</h3>
        <p class="hint">Deletes all guests, photos, scores and rounds. Questions go back to the starter set. This cannot be undone.</p>
        <label class="field">Type ${RESET_WORD} to confirm
          <input type="text" name="confirm" autocapitalize="characters" autocomplete="off" data-input="reset-word"></label>
        <button class="btn btn-danger" type="submit" disabled>Reset everything</button>
      </form>
      <button class="btn btn-ghost btn-block" type="button" data-action="logout">Log out of this device</button>`;
  }

  // ------------------------------------------------------------------ handlers

  function setCommentator(el) {
    H.state.host.settings.commentator = el.checked;
    H.render();
    return H.call('/settings', { body: { commentator: el.checked }, ok: el.checked ? 'Commentator on' : 'Commentator off' });
  }

  H.register({
    panel: 'tv',
    render: renderTv,
    actions: {
      'tv-mode'(el) {
        const pinned = el.dataset.mode || null;
        H.state.tv.pinned = pinned;
        H.render();
        const label = TV_MODES.find((m) => m.id === pinned).label;
        return H.call('/tv', { body: { pinned }, ok: pinned ? `TV pinned to ${label}` : 'TV back on auto-cycle' });
      },
      'trophy-clear': () => H.call('/trophy/clear', { ok: 'Trophy cleared' }),
    },
    changes: {
      'tv-paused'(el) {
        H.state.tv.paused = el.checked;
        H.render();
        return H.call('/tv', { body: { paused: el.checked }, ok: el.checked ? 'Slideshow paused' : 'Slideshow playing' });
      },
      commentator: setCommentator,
    },
  });
  H.register({
    panel: 'setup',
    render: renderSetup,
    inputs: {
      'reset-word'(el) {
        el.form.querySelector('[type=submit]').disabled = el.value.trim() !== RESET_WORD;
      },
    },
    submits: {
      async reset(form, data) {
        if (String(data.confirm || '').trim() !== RESET_WORD) {
          Party.toast(`Type ${RESET_WORD} to confirm`, { error: true });
          return;
        }
        const res = await H.call('/reset', { body: { confirm: RESET_WORD }, ok: 'Event reset. Fresh start!' });
        if (res) H.resetForm(form);
      },
      settings(form, data) {
        const hosts = String(data.hosts || '').split(',').map((x) => x.trim()).filter(Boolean);
        return H.call('/settings', { body: { partyName: data.partyName, hosts }, ok: 'Party details saved' });
      },
    },
  });
})();
