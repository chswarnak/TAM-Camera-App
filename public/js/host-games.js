/* Host dashboard: Rounds tab (live round + scores), Couples tab, and the Floor Games music-stop controller. */
(function () {
  'use strict';

  const H = window.Host;
  const esc = H.esc;
  const TYPE_LABELS = { quiz: 'Quiz', poll: 'Poll', guessWho: 'Guess Who' };
  const COUPLES_QUESTIONS = 5;
  const DEFAULT_TIMER = 20;
  const DEFAULT_REMAINING = 8;
  const DEFAULT_BONUS = 20;
  const VOLUME_THROTTLE_MS = 200;

  let couplesPick = null; // null = default (first five questions)
  let floorGame = 'hat';
  let volumeTimer = null;

  // ------------------------------------------------------------------ Rounds

  function renderRounds(s) {
    return `<div class="panel-head"><h2>Rounds</h2></div>
      ${s.round ? roundCard(s) : noRound()}
      ${scoresCard(s)}`;
  }

  function noRound() {
    return `<div class="card round-card">
      <p class="lead">No question is running. The TV is on its normal cycle.</p>
      <div class="btn-row">${Object.entries(TYPE_LABELS).map(([type, label]) => `
        <button class="btn btn-gold" type="button" data-action="round-next" data-type="${type}">▶ Next ${label}</button>`).join('')}
      </div>
      <p class="hint">Or launch a specific question from the Questions tab.</p>
    </div>`;
  }

  /** Live tally from raw submissions; after reveal, the server's results. */
  function tally(s) {
    const r = s.round;
    if (r.results) return { rows: r.results.options, correct: r.results.correct };
    const raw = s.host.round;
    const q = s.host.questions[r.type].find((x) => x.id === raw.questionId);
    const counts = new Map();
    for (const answer of Object.values(raw.submissions)) counts.set(answer, (counts.get(answer) || 0) + 1);
    const correct = r.type === 'quiz' ? q?.answer : r.type === 'guessWho' ? q?.authorId : null;
    if (r.optionsFrom === 'guests') {
      const rows = [...counts].map(([id, votes]) => ({ id, label: H.guestName(id), votes })).sort((a, b) => b.votes - a.votes).slice(0, 8);
      return { rows, correct };
    }
    return { rows: (r.options || []).map((label, i) => ({ id: i, label, votes: counts.get(i) || 0 })), correct };
  }

  function resultBars(s) {
    const { rows, correct } = tally(s);
    if (!rows.length) return '<p class="hint">No answers yet.</p>';
    const max = Math.max(1, ...rows.map((o) => o.votes));
    return `<div class="bars">${rows.map((o) => `
      <div class="bar${o.id === correct ? ' is-correct' : ''}">
        <div class="bar-fill" style="width:${Math.round((o.votes / max) * 100)}%"></div>
        <span class="bar-label">${o.id === correct ? '✓ ' : ''}${esc(o.label)}</span><span class="bar-votes">${o.votes}</span>
      </div>`).join('')}</div>`;
  }

  function roundCard(s) {
    const r = s.round;
    const res = r.results;
    const teamLine = res && r.type !== 'poll' ? `<div class="team-correct">${s.teams.map((t) => `
      <span class="chip">${H.teamDot(t.id)}${esc(t.name)}: ${res.teamCorrect[t.id] || 0} right</span>`).join('')}</div>` : '';
    const author = res && res.author ? `<p class="lead">It was <b>${esc(res.author.nickname)}</b> · ${esc(res.author.title)}</p>` : '';
    return `<div class="card round-card">
      <div class="round-top">
        <span class="pill pill-${r.status}">${r.status}</span>
        <span class="tag">${esc(TYPE_LABELS[r.type])}${r.type === 'quiz' ? ` Q${r.number}` : ''} · ${esc(r.category)}</span>
        ${r.status === 'open' && r.endsAt ? '<span class="countdown big-count" data-ends-at="' + r.endsAt + '"></span>' : ''}
      </div>
      <p class="round-q">${esc(r.text)}</p>
      <p class="round-subs"><b>${r.submissions}</b> of ${s.guests.length} answered</p>
      <h3 class="section-title">${res ? 'Results' : 'Live answers (only you see this)'}</h3>
      ${resultBars(s)}
      ${author}${teamLine}
      ${r.status === 'open' ? `<form class="inline-form" data-submit="round-timer" data-key="round-timer">
        <label class="field field-narrow">Seconds<input type="number" name="seconds" value="${r.seconds || DEFAULT_TIMER}" min="5" max="120" inputmode="numeric"></label>
        <button class="btn btn-ghost" type="submit">⏱ Start timer</button>
      </form>` : ''}
      <div class="btn-row">
        ${r.status === 'open' ? '<button class="btn btn-ghost" type="button" data-action="round-close">Close answers</button>' : ''}
        ${r.status !== 'revealed' ? '<button class="btn btn-gold" type="button" data-action="round-reveal">✨ Reveal</button>' : ''}
        <button class="btn${r.status === 'revealed' ? ' btn-gold' : ' btn-ghost'}" type="button" data-action="round-next" data-type="${r.type}">▶ Next ${TYPE_LABELS[r.type]}</button>
        <button class="btn btn-ghost" type="button" data-action="round-end">End round · back to TV cycle</button>
      </div>
    </div>`;
  }

  function scoresCard(s) {
    return `<div class="card">
      <h3>Scores</h3>
      <div class="score-rows">${s.teams.map((t) => `
        <form class="score-row" data-submit="score-custom" data-key="score-${esc(t.id)}" data-team="${esc(t.id)}" style="--team:${esc(t.color)}">
          <span class="score-name">${H.teamDot(t.id)}${esc(t.name)}</span>
          <span class="score-num">${t.score}</span>
          <span class="score-btns">
            <button class="btn btn-sm btn-ghost" type="button" data-action="score" data-team="${esc(t.id)}" data-points="-10">−10</button>
            <button class="btn btn-sm" type="button" data-action="score" data-team="${esc(t.id)}" data-points="10">+10</button>
            <input type="number" name="points" inputmode="numeric" placeholder="±" aria-label="Custom points for ${esc(t.name)}">
            <button class="btn btn-sm btn-ghost" type="submit">Add</button>
          </span>
        </form>`).join('')}
      </div>
    </div>`;
  }

  // ------------------------------------------------------------------ Couples

  function pickedIds(s) {
    const all = s.host.questions.couples.map((q) => q.id);
    return (couplesPick || all.slice(0, COUPLES_QUESTIONS)).filter((id) => all.includes(id));
  }

  function renderCouples(s) {
    const pairs = s.host.couples.pairs;
    const paired = pairs.flatMap((p) => [p.a, p.b]);
    const session = s.couples;
    const picked = pickedIds(s);
    return `<div class="panel-head"><h2>Couples Quiz</h2></div>
      ${session ? sessionCard(s) : ''}
      <div class="card">
        <h3>Couples <span class="count">${pairs.length}</span></h3>
        <form class="pair-form" data-submit="pair-add" data-key="pair-add">
          <select name="a" required>${H.guestOptions('', { blank: 'Partner 1', exclude: paired })}</select>
          <span aria-hidden="true">💑</span>
          <select name="b" required>${H.guestOptions('', { blank: 'Partner 2', exclude: paired })}</select>
          <button class="btn btn-sm" type="submit">Add couple</button>
        </form>
        <ul class="pair-list">${pairs.map((p) => `<li>${H.teamDot(guestTeam(s, p.a))}${esc(H.guestName(p.a))} &amp; ${H.teamDot(guestTeam(s, p.b))}${esc(H.guestName(p.b))}
          <button class="btn btn-sm btn-ghost" type="button" data-action="pair-remove" data-id="${esc(p.id)}" data-confirm="Remove?">Remove</button></li>`).join('')
          || '<li class="empty">No couples yet.</li>'}</ul>
      </div>
      <div class="card">
        <h3>Questions <span class="count">${picked.length} of ${COUPLES_QUESTIONS}</span></h3>
        <p class="hint">Pick up to five. Edit the wording in Questions → Couples.</p>
        <div class="check-list">${s.host.questions.couples.map((q) => `
          <label class="check"><input type="checkbox" data-change="couples-pick" value="${esc(q.id)}"${picked.includes(q.id) ? ' checked' : ''}> ${esc(q.text)}</label>`).join('')}
        </div>
        ${!session || session.status === 'done' ? `<button class="btn btn-gold btn-block" type="button" data-action="couples-start"${pairs.length ? '' : ' disabled'}>
          💑 Start Couples Quiz</button>` : ''}
      </div>`;
  }

  function guestTeam(s, id) {
    return s.host.guests.find((g) => g.id === id)?.teamId;
  }

  function sessionCard(s) {
    const c = s.couples;
    const total = c.questions.length;
    const next = c.questions[c.revealIndex + 1];
    const status = { answering: 'Couples are answering', revealing: 'Revealing on TV', done: 'Finished' }[c.status];
    return `<div class="card round-card">
      <div class="round-top"><span class="pill pill-${c.status === 'done' ? 'revealed' : 'open'}">${status}</span>
        <span class="tag">${c.revealIndex + 1} of ${total} revealed</span></div>
      <div class="pair-progress">${c.pairs.map((p) => `<div class="chip">${H.teamDot(p.teamId)}${esc(p.a)} &amp; ${esc(p.b)} ·
        ${p.answered}/${total * 2} answers · ${p.matches} ✓</div>`).join('')}</div>
      ${next && c.status !== 'done' ? `<p class="lead">Next: <b>${esc(next.text)}</b></p>` : ''}
      ${c.revealed.map((q) => `<div class="reveal-q"><b>${esc(q.text)}</b>${q.pairs.map((p) => `
        <div class="reveal-row">${esc(p.a)}: ${esc(p.aSays || '—')} · ${esc(p.b)}: ${esc(p.bSays || '—')} ${p.match ? '✅' : '❌'}</div>`).join('')}</div>`).join('')}
      <div class="btn-row">
        ${c.status !== 'done' && next ? '<button class="btn btn-gold" type="button" data-action="couples-reveal">✨ Reveal next question</button>' : ''}
        ${c.status !== 'done' ? '<button class="btn" type="button" data-action="couples-finish">🏆 Finish</button>' : ''}
        <button class="btn btn-ghost" type="button" data-action="couples-end" data-confirm="End the quiz?">End</button>
      </div>
    </div>`;
  }

  // ------------------------------------------------------------------ Floor games (music stop controller)

  function renderGames(s) {
    const p = s.physical;
    return `<div class="panel-head" id="physical"><h2>Floor Games</h2></div>
      ${audioModeSwitch(s)}
      ${p.game ? controller(s) : chooser(s)}`;
  }

  /** MP3 playlist (TV page plays data/music) or System audio (Spotify / whatever the Mac plays). */
  function audioModeSwitch(s) {
    const p = s.physical;
    const system = p.audioMode === 'system';
    const locked = p.status === 'playing';
    const status = s.host.systemAudioStatus;
    const btn = (mode, label) => `<button type="button" class="audio-seg-btn${p.audioMode === mode ? ' is-on' : ''}" data-action="floor-audio-mode"
      data-mode="${mode}" aria-pressed="${p.audioMode === mode}"${locked ? ' disabled' : ''}>${label}</button>`;
    return `<div class="card audio-mode">
      <div class="audio-mode-head"><h3>Music source</h3>
        <span class="pill audio-mode-pill is-${esc(p.audioMode)}">Active: ${system ? '🎧 System audio' : '🎵 MP3 playlist'}</span></div>
      <div class="audio-seg" role="group" aria-label="Music source">${btn('playlist', '🎵 MP3 playlist')}${btn('system', '🎧 System audio (Spotify etc.)')}</div>
      <p class="hint">${system
    ? 'Start Round plays Spotify (or unmutes the Mac); the stop pauses Spotify (or mutes the Mac). The TV still buzzes and flashes STOP.'
    : `The TV page plays MP3s from data/music/ out of the TV speakers. ${s.host.tracks} track${s.host.tracks === 1 ? '' : 's'} loaded.`}
      ${locked ? ' Stop the music to switch.' : ''}</p>
      ${system && status ? `<p class="hint audio-status ${status.ok ? 'is-ok' : 'is-bad'}">Last: ${esc(status.action)} ${status.ok ? '✓' : `✗ ${esc(status.detail)}`}</p>` : ''}
    </div>`;
  }

  function chooser(s) {
    const games = s.content.physicalGames;
    return `<div class="card">
      <h3>Choose a game</h3>
      <div class="game-pick">${Object.entries(games).map(([id, g]) => `
        <button type="button" class="game-card${id === floorGame ? ' is-on' : ''}" data-action="floor-pick" data-game="${id}" aria-pressed="${id === floorGame}">
          <b>${esc(g.name)}</b><span>${esc(g.rule)}</span></button>`).join('')}
      </div>
      <form class="inline-form" data-submit="floor-start" data-key="floor-start">
        <label class="field field-narrow">${esc(games[floorGame].unit)} at start
          <input type="number" name="remaining" value="${DEFAULT_REMAINING}" min="1" max="60" inputmode="numeric"></label>
        <button class="btn btn-gold" type="submit">Set up ${esc(games[floorGame].name)}</button>
      </form>
    </div>`;
  }

  function controller(s) {
    const p = s.physical;
    const isCups = p.game === 'cups';
    const statusText = { ready: 'Ready', playing: '▶ Playing', stopped: '⏹ Stopped', idle: 'Idle' }[p.status];
    return `<div class="card floor">
      <div class="floor-head"><h3>${esc(p.info.name)}</h3><p class="hint">${esc(p.info.rule)}</p></div>
      <div class="floor-stats">
        <div class="stat"><span class="stat-num">${p.round}</span><span class="stat-label">Round</span></div>
        <div class="stat"><span class="stat-num">${p.remaining}</span><span class="stat-label">${esc(p.info.unit)}</span></div>
        <div class="stat stat-status is-${p.status}"><span class="stat-num">${statusText}</span>
          <span class="stat-label">${p.status === 'playing' && p.randomStop ? 'Random stop armed' : 'Music'}</span></div>
      </div>
      <div class="floor-main">
        <button class="btn btn-gold btn-xl" type="button" data-action="floor-round"${p.status === 'playing' ? ' disabled' : ''}>▶ Start Round ${p.round + 1}</button>
        <button class="btn btn-danger btn-xl" type="button" data-action="floor-stop"${p.status === 'playing' ? '' : ' disabled'}>⏹ Stop Now</button>
      </div>
      ${H.toggle('floor-random', p.randomStop, 'Random Stop', 'Music stops by itself after 8–25 seconds')}
      <div class="floor-row">
        <button class="btn btn-ghost" type="button" data-action="floor-next-track">⏭ Next Track${p.audioMode === 'system' ? ' (Spotify)' : ''}</button>
        ${p.audioMode === 'system' ? '<span class="hint">Set the volume on the Mac or in Spotify.</span>' : `<label class="volume">🔈<input type="range" name="volume" min="0" max="100" value="${Math.round(p.volume * 100)}"
          data-input="floor-volume" aria-label="Volume"><output>${Math.round(p.volume * 100)}%</output></label>`}
      </div>
      <div class="floor-row">
        <button class="btn" type="button" data-action="floor-eliminate" data-delta="-1"${p.remaining ? '' : ' disabled'}>${isCups ? '🥤 Remove a Cup' : '❌ Eliminate −1'}</button>
        <button class="btn btn-ghost" type="button" data-action="floor-eliminate" data-delta="1">+1 Undo</button>
      </div>
      <form class="winner-form" data-submit="floor-winner" data-key="floor-winner">
        <h3>🏆 Winner</h3>
        <input type="text" name="name" maxlength="40" placeholder="Winner's name (e.g. Priya &amp; Rahul)">
        <select name="teamId" aria-label="Winner's team">${H.teamOptions('', { blank: 'No team bonus' })}</select>
        <label class="field field-narrow">Bonus<input type="number" name="points" value="${DEFAULT_BONUS}" min="0" max="200" inputmode="numeric"></label>
        <button class="btn btn-gold" type="submit">Show trophy</button>
      </form>
      <button class="btn btn-ghost btn-block" type="button" data-action="floor-end" data-confirm="Tap again to end the game">End game</button>
    </div>`;
  }

  // ------------------------------------------------------------------ handlers

  H.register({ panel: 'rounds', render: renderRounds });
  H.register({ panel: 'couples', render: renderCouples });
  H.register({
    panel: 'games',
    render: renderGames,
    actions: {
      'round-next'(el) {
        return H.call('/round/next', { body: { type: el.dataset.type }, ok: 'Question is live on the TV 🎯' });
      },
      'round-close': () => H.call('/round/close', { ok: 'Answers closed' }),
      'round-reveal': () => H.call('/round/reveal', { ok: 'Revealed ✨' }),
      'round-end': () => H.call('/round/end', { ok: 'Round ended. TV is back on its cycle' }),
      score(el) {
        const t = H.team(el.dataset.team);
        const pts = Number(el.dataset.points);
        return H.call('/score', { body: { teamId: el.dataset.team, points: pts }, ok: `${pts > 0 ? '+' : ''}${pts} for ${t ? t.name : 'team'}` });
      },
      'pair-remove': (el) => H.call(`/couples/pairs/${encodeURIComponent(el.dataset.id)}`, { method: 'DELETE', ok: 'Couple removed' }),
      'couples-start'() {
        const ids = pickedIds(H.state);
        if (!ids.length) {
          Party.toast('Pick at least one question', { error: true });
          return null;
        }
        return H.call('/couples/start', { body: { questionIds: ids }, ok: '💑 Couples Quiz started: partners answer on their phones' });
      },
      'couples-reveal': () => H.call('/couples/reveal-next', { ok: 'Revealed on the TV 💑' }),
      'couples-finish': () => H.call('/couples/finish', { ok: '🏆 Most In Sync Couple is on the TV' }),
      'couples-end': () => H.call('/couples/end', { ok: 'Couples Quiz ended' }),
      'floor-pick'(el) {
        floorGame = el.dataset.game;
        H.rerender();
      },
      'floor-round'() {
        const p = H.state.physical;
        p.status = 'playing';
        p.round += 1;
        H.render();
        return H.call('/physical/round', { ok: p.audioMode === 'system' ? '🎧 Playing system audio' : '🎵 Music is playing on the TV' });
      },
      'floor-stop'() {
        H.state.physical.status = 'stopped';
        H.render();
        return H.call('/physical/stop');
      },
      'floor-next-track': () => H.call('/physical/next-track', { ok: '⏭ Next track' }),
      'floor-eliminate'(el) {
        const p = H.state.physical;
        p.remaining = Math.max(0, p.remaining + Number(el.dataset.delta));
        H.render();
        return H.call('/physical/eliminate', { body: { delta: Number(el.dataset.delta) } });
      },
      'floor-end': () => H.call('/physical/end', { ok: 'Game ended' }),
      'floor-audio-mode'(el) {
        const audioMode = el.dataset.mode;
        if (audioMode === H.state.physical.audioMode) return null;
        H.state.physical.audioMode = audioMode;
        H.render();
        return H.call('/physical/options', { body: { audioMode }, ok: audioMode === 'system' ? '🎧 System audio mode' : '🎵 MP3 playlist mode' });
      },
    },
    changes: {
      'floor-random'(el) {
        H.state.physical.randomStop = el.checked;
        H.render();
        return H.call('/physical/options', { body: { randomStop: el.checked }, ok: el.checked ? 'Random Stop on' : 'Random Stop off: use Stop Now' });
      },
      'couples-pick'(el) {
        const ids = new Set(pickedIds(H.state));
        if (el.checked && ids.size >= COUPLES_QUESTIONS) {
          el.checked = false;
          Party.toast(`Pick at most ${COUPLES_QUESTIONS} questions`, { error: true });
          return null;
        }
        if (el.checked) ids.add(el.value);
        else ids.delete(el.value);
        // Keep the list order, not the tap order, so the quiz runs top to bottom.
        couplesPick = H.state.host.questions.couples.map((q) => q.id).filter((id) => ids.has(id));
        H.rerender();
        return null;
      },
    },
    inputs: {
      'floor-volume'(el) {
        const volume = Number(el.value) / 100;
        el.nextElementSibling.textContent = `${el.value}%`;
        H.state.physical.volume = volume;
        clearTimeout(volumeTimer);
        volumeTimer = setTimeout(() => H.call('/physical/options', { body: { volume } }), VOLUME_THROTTLE_MS);
      },
    },
    submits: {
      'round-timer': (form, data) => H.call('/round/timer', { body: { seconds: Number(data.seconds) || DEFAULT_TIMER }, ok: '⏱ Timer started' }),
      'score-custom'(form, data) {
        const pts = Math.round(Number(data.points));
        if (!pts) {
          Party.toast('Type a number like 5 or -5', { error: true });
          return null;
        }
        const t = H.team(form.dataset.team);
        return H.call('/score', { body: { teamId: form.dataset.team, points: pts }, ok: `${pts > 0 ? '+' : ''}${pts} for ${t ? t.name : 'team'}` })
          .then((res) => { if (res) H.resetForm(form); });
      },
      async 'pair-add'(form, data) {
        const res = await H.call('/couples/pairs', { body: { a: data.a, b: data.b }, ok: 'Couple added 💑' });
        if (res) H.resetForm(form);
      },
      'floor-start'(form, data) {
        const remaining = Number(data.remaining) || DEFAULT_REMAINING;
        return H.call('/physical/start', { body: { game: floorGame, remaining }, ok: 'Game is on the TV. Tap Start Round when ready' });
      },
      'floor-winner'(form, data) {
        return H.call('/physical/winner', {
          body: { name: data.name, teamId: data.teamId || null, points: data.teamId ? Number(data.points) || 0 : 0 },
          ok: '🏆 Winner is on the TV',
        });
      },
    },
  });
})();
