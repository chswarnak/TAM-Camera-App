/* Host dashboard: Guests tab (guest cards, teams editor) and Photos tab (approval queue, photo grid). */
(function () {
  'use strict';

  const H = window.Host;
  const esc = H.esc;
  const MAX_TEAMS = 6;
  const MIN_TEAMS = 2;

  // ------------------------------------------------------------------ Guests

  function renderGuests(s) {
    const guests = s.host.guests;
    return `
      <div class="panel-head">
        <h2>Guests <span class="count">${guests.length}</span></h2>
      </div>
      ${teamsEditor(s)}
      <h3 class="section-title">Everyone</h3>
      ${guests.length ? `<div class="guest-grid">${guests.map(guestCard).join('')}</div>`
        : '<p class="empty">No guests yet. They join by scanning the QR code on the TV or the Setup tab.</p>'}`;
  }

  function teamsEditor(s) {
    const rows = s.host.guests.reduce((acc, g) => ({ ...acc, [g.teamId]: (acc[g.teamId] || 0) + 1 }), {});
    const teams = s.teams;
    // Alphabetical, not by score, so rows don't jump around while the host edits them.
    const ordered = [...teams].sort((a, b) => a.name.localeCompare(b.name));
    return `<div class="card teams-card">
      <h3>Teams</h3>
      <div class="team-rows">${ordered.map((t) => `
        <div class="team-row" data-key="team-${esc(t.id)}" style="--team:${esc(t.color)}">
          <input type="color" name="color" value="${esc(t.color)}" aria-label="Colour for ${esc(t.name)}"
            data-change="team-color" data-id="${esc(t.id)}">
          <input type="text" name="name" value="${esc(t.name)}" maxlength="20" aria-label="Team name"
            data-change="team-name" data-id="${esc(t.id)}">
          <span class="team-meta">${rows[t.id] || 0} 👤 · ${t.score} pts</span>
          ${!rows[t.id] && teams.length > MIN_TEAMS ? `<button class="btn btn-ghost btn-sm" type="button" data-action="team-remove"
            data-id="${esc(t.id)}" data-confirm="Remove?" aria-label="Remove ${esc(t.name)}">✕</button>` : ''}
        </div>`).join('')}
      </div>
      ${teams.length < MAX_TEAMS ? `<form class="inline-form" data-submit="team-add" data-key="team-add">
        <input type="text" name="name" maxlength="20" placeholder="New team name" required>
        <button class="btn btn-sm" type="submit">+ Add team</button>
      </form>` : `<p class="hint">That's the maximum of ${MAX_TEAMS} teams.</p>`}
      <p class="hint">Rename or recolour a team and it updates everywhere. Only empty teams can be removed.</p>
    </div>`;
  }

  function guestCard(g) {
    const t = H.team(g.teamId);
    const a = g.about || {};
    const facts = [
      a.company && `<dt>Does</dt><dd>${esc(a.company)}</dd>`,
      a.funFact && `<dt>Fun fact</dt><dd>${esc(a.funFact)}</dd>`,
      a.talent && `<dt>Talent</dt><dd>${esc(a.talent)}</dd>`,
    ].filter(Boolean).join('');
    return `<article class="card guest-card" style="--team:${esc(t ? t.color : '#bbb')}" data-key="guest-${esc(g.id)}">
      <header>
        <div>
          <div class="guest-name">${esc(g.nickname)}</div>
          <div class="guest-title">${esc(g.title || '')}</div>
        </div>
        <button class="btn btn-ghost btn-sm" type="button" data-action="guest-remove" data-id="${esc(g.id)}"
          data-confirm="Remove?">Remove</button>
      </header>
      ${facts ? `<dl class="about">${facts}</dl>` : ''}
      <div class="chips">
        <span class="chip">🍬 ${esc(a.sweet)}</span><span class="chip">⚡ ${esc(a.superpower)}</span><span class="chip">🚪 ${esc(a.arrival)}</span>
      </div>
      <label class="field-inline">Team
        <select name="team" data-change="guest-move" data-id="${esc(g.id)}">${H.teamOptions(g.teamId)}</select>
      </label>
    </article>`;
  }

  // ------------------------------------------------------------------ Photos

  function renderPhotos(s) {
    const photos = s.host.photos;
    const pending = photos.filter((p) => p.status === 'pending');
    const approval = s.host.settings.approvalMode;
    return `
      <div class="panel-head">
        <h2>Photos <span class="count">${photos.length}</span></h2>
      </div>
      <div class="card">
        ${H.toggle('approval-mode', approval, 'Approval Mode', approval
          ? 'New photos wait here until you approve them.' : 'Off: shared photos go straight to the TV.')}
      </div>
      ${pending.length ? `<h3 class="section-title">Waiting for approval <span class="count">${pending.length}</span></h3>
        <div class="pending-list">${pending.map(pendingCard).join('')}</div>` : ''}
      <h3 class="section-title">All photos</h3>
      ${photos.length ? `<div class="photo-grid">${photos.map(photoTile).join('')}</div>`
        : '<p class="empty">No photos yet. Guests share them from Photo Fun on their phones.</p>'}`;
  }

  function pendingCard(p) {
    return `<article class="card pending-card">
      <img src="${esc(H.photoSrc(p))}" alt="Photo by ${esc(p.nickname)}" loading="lazy">
      <div class="pending-body">
        <div class="photo-by">${H.teamDot(p.teamId)}${esc(p.nickname)}</div>
        <div class="photo-caption">${esc(p.caption || 'No caption')}</div>
        <div class="btn-row">
          <button class="btn btn-gold" type="button" data-action="photo-status" data-id="${esc(p.id)}" data-status="live">✓ Approve</button>
          <button class="btn btn-ghost" type="button" data-action="photo-status" data-id="${esc(p.id)}" data-status="hidden">Hide</button>
          <button class="btn btn-ghost" type="button" data-action="photo-delete" data-id="${esc(p.id)}" data-confirm="Delete?">🗑</button>
        </div>
      </div>
    </article>`;
  }

  function photoTile(p) {
    const label = { live: 'On TV', hidden: 'Hidden', pending: 'Pending' }[p.status];
    const flip = p.status === 'live' ? { to: 'hidden', text: 'Hide' } : { to: 'live', text: 'Show' };
    return `<figure class="photo-tile is-${p.status}">
      <div class="photo-img"><img src="${esc(H.photoSrc(p))}" alt="Photo by ${esc(p.nickname)}" loading="lazy">
        <span class="photo-status">${label}</span><span class="photo-hearts">❤️ ${p.hearts}</span></div>
      <figcaption>
        <div class="photo-by">${H.teamDot(p.teamId)}${esc(p.nickname)}</div>
        ${p.caption ? `<div class="photo-caption">${esc(p.caption)}</div>` : ''}
      </figcaption>
      <div class="tile-actions">
        <button class="btn btn-sm${flip.to === 'hidden' ? ' btn-ghost' : ' btn-gold'}" type="button" data-action="photo-status"
          data-id="${esc(p.id)}" data-status="${flip.to}">${flip.text}</button>
        <button class="btn btn-sm btn-ghost" type="button" data-action="photo-delete" data-id="${esc(p.id)}" data-confirm="Delete?"
          aria-label="Delete photo">🗑</button>
      </div>
    </figure>`;
  }

  // ------------------------------------------------------------------ handlers

  function findPhoto(id) {
    return H.state.host.photos.find((p) => p.id === id);
  }

  H.register({ panel: 'guests', render: renderGuests });
  H.register({
    panel: 'photos',
    render: renderPhotos,
    actions: {
      'photo-status'(el) {
        const photo = findPhoto(el.dataset.id);
        if (photo) photo.status = el.dataset.status;
        H.render();
        const msg = { live: 'Photo is on the TV', hidden: 'Photo hidden from the TV', pending: 'Back in the queue' }[el.dataset.status];
        return H.call(`/photos/${encodeURIComponent(el.dataset.id)}/status`, { body: { status: el.dataset.status }, ok: msg });
      },
      'photo-delete'(el) {
        const s = H.state;
        s.host.photos = s.host.photos.filter((p) => p.id !== el.dataset.id);
        H.render();
        return H.call(`/photos/${encodeURIComponent(el.dataset.id)}`, { method: 'DELETE', ok: 'Photo deleted' });
      },
      'team-remove'(el) {
        return H.call(`/teams/${encodeURIComponent(el.dataset.id)}`, { method: 'DELETE', ok: 'Team removed' });
      },
      'guest-remove'(el) {
        const s = H.state;
        s.host.guests = s.host.guests.filter((g) => g.id !== el.dataset.id);
        H.render();
        return H.call(`/guests/${encodeURIComponent(el.dataset.id)}`, { method: 'DELETE', ok: 'Guest removed' });
      },
    },
    changes: {
      'approval-mode'(el) {
        H.state.host.settings.approvalMode = el.checked;
        H.render();
        return H.call('/settings', { body: { approvalMode: el.checked }, ok: el.checked ? 'Approval Mode on' : 'Approval Mode off' });
      },
      'team-name'(el) {
        return H.call(`/teams/${encodeURIComponent(el.dataset.id)}`, { method: 'PATCH', body: { name: el.value }, ok: 'Team renamed' });
      },
      'team-color'(el) {
        return H.call(`/teams/${encodeURIComponent(el.dataset.id)}`, { method: 'PATCH', body: { color: el.value }, ok: 'Team colour updated' });
      },
      'guest-move'(el) {
        const g = H.state.host.guests.find((x) => x.id === el.dataset.id);
        if (g) g.teamId = el.value;
        H.render();
        const t = H.team(el.value);
        return H.call(`/guests/${encodeURIComponent(el.dataset.id)}/move`, { body: { teamId: el.value }, ok: `Moved to ${t ? t.name : 'team'}` });
      },
    },
    submits: {
      async 'team-add'(form, data) {
        const res = await H.call('/teams', { body: { name: data.name }, ok: 'Team added' });
        if (res) H.resetForm(form);
      },
    },
  });
})();
