/* Guest Play screen (quiz, polls, Guess Who, couples quiz, physical games) and the Shout-out screen. */
(function () {
  'use strict';

  const RING_RADIUS = 26;
  const RING_CIRC = 2 * Math.PI * RING_RADIUS;
  const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
  const STOP_VIBRATION = [400, 120, 400];

  const esc = (v) => Party.escapeHtml(v);
  const byId = (id) => document.getElementById(id);
  const G = () => window.Guest;

  let playKey = '';
  let ringFrame = 0;
  let pendingAnswer = null;
  let pendingCouples = {};
  let votePicker = null;
  let shoutPicker = null;
  let shoutSticker = null;
  let stickersBuilt = false;

  // ------------------------------------------------------------ searchable guest picker

  /**
   * A search box plus a tappable list of guests (team dot + name + title).
   * `excludeId()` returns a guest id to hide (e.g. yourself), read at draw time.
   * Re-draws only when the guest list or the search text changes.
   */
  function createGuestPicker(root, { excludeId, onChange }) {
    root.innerHTML = `
      <label class="search"><span aria-hidden="true">🔎</span>
        <input type="search" placeholder="Search names" autocomplete="off" enterkeyhint="search" aria-label="Search guests">
      </label>
      <div class="picker-list" role="listbox"></div>`;
    const input = root.querySelector('input');
    const list = root.querySelector('.picker-list');
    let guests = [];
    let selected = null;
    let lastKey = '';

    function draw() {
      const q = input.value.trim().toLowerCase();
      const excluded = excludeId();
      const rows = guests.filter((g) => g.id !== excluded && (!q || g.nickname.toLowerCase().includes(q)));
      list.innerHTML = rows.length ? rows.map((g) => `
        <button type="button" class="pick-row${g.id === selected ? ' is-selected' : ''}" data-id="${esc(g.id)}" role="option" aria-selected="${g.id === selected}">
          ${G().teamDot(g.teamId)}<span class="pick-name">${esc(g.nickname)}</span>
          <span class="pick-title">${esc(g.title || '')}</span>
        </button>`).join('')
        : `<p class="muted center">${q ? `No one called “${esc(q)}” yet` : 'No other guests yet. Invite someone to scan the code!'}</p>`;
    }

    input.addEventListener('input', draw);
    list.addEventListener('click', (e) => {
      const row = e.target.closest('.pick-row');
      if (!row) return;
      selected = row.dataset.id;
      list.querySelectorAll('.pick-row').forEach((r) => {
        const on = r === row;
        r.classList.toggle('is-selected', on);
        r.setAttribute('aria-selected', String(on));
      });
      onChange(guests.find((g) => g.id === selected));
    });

    return {
      update(nextGuests) {
        const key = JSON.stringify(nextGuests.map((g) => [g.id, g.nickname, g.teamId, g.title]));
        if (key === lastKey) return;
        lastKey = key;
        guests = nextGuests;
        if (selected && !guests.some((g) => g.id === selected)) {
          selected = null;
          onChange(null);
        }
        draw();
      },
      get selected() { return guests.find((g) => g.id === selected) || null; },
      reset() {
        selected = null;
        input.value = '';
        draw();
      },
    };
  }

  // ------------------------------------------------------------ play screen

  /** Picks what the Play screen should show; `key` changes only when a re-render is needed. */
  function playView(snap) {
    const { round, couples, physical, me } = snap;
    if (round && round.status === 'open') return roundView(snap);
    if (couples && couples.status !== 'done') return couplesView(couples);
    if (round) return roundView(snap);
    if (physical.game && physical.info) {
      return { key: `phys:${physical.game}:${physical.status}:${physical.round}:${physical.remaining}`, html: physicalHtml(physical) };
    }
    return { key: `idle:${me?.shoutoutsLeft > 0}`, html: idleHtml() };
  }

  function myAnswer(snap) {
    const { round, me } = snap;
    if (me?.round && me.round.id === round.id && me.round.answer !== null) return me.round.answer;
    if (pendingAnswer && pendingAnswer.roundId === round.id) return pendingAnswer.answer;
    return null;
  }

  function roundView(snap) {
    const { round, me } = snap;
    const answer = myAnswer(snap);
    const canVote = me?.round?.id !== round.id || me.round.canVote !== false;
    const key = `round:${round.id}:${round.status}:${answer}:${canVote}:${round.results ? round.results.total : ''}`;
    const label = round.type === 'quiz' ? `${esc(round.category || 'Quiz')} · Question ${round.number}` : esc(round.category);
    const head = `
      <div class="q-head">
        <span class="q-cat">${label}</span>
        ${round.status === 'open' && round.endsAt ? ringHtml() : ''}
      </div>
      <h2 class="q-text${round.type === 'quiz' && round.text.length < 16 ? ' is-emoji' : ''}">${esc(round.text)}</h2>`;
    let body;
    if (round.status === 'revealed') body = resultsHtml(snap, answer);
    else if (round.status === 'closed') body = closedHtml(snap, answer);
    else if (round.optionsFrom === 'guests') body = guestVoteHtml(snap, answer, canVote);
    else body = optionsHtml(round, answer);
    return { key, html: `<div class="sheet q-card">${head}${body}</div>`, mount: (root) => mountRound(root, snap, answer, canVote) };
  }

  function ringHtml() {
    return `
      <div class="ring" aria-live="off">
        <svg viewBox="0 0 60 60" aria-hidden="true">
          <circle class="ring-bg" cx="30" cy="30" r="${RING_RADIUS}"></circle>
          <circle class="ring-fg" cx="30" cy="30" r="${RING_RADIUS}" stroke-dasharray="${RING_CIRC.toFixed(1)}" stroke-dashoffset="0"></circle>
        </svg>
        <span class="ring-num">20</span>
      </div>`;
  }

  function optionsHtml(round, answer) {
    const locked = answer !== null;
    return `
      <div class="q-options">${round.options.map((opt, i) => `
        <button type="button" class="btn opt${answer === i ? ' is-picked' : ''}" data-answer="${i}" ${locked ? 'disabled' : ''}>
          <span class="opt-letter">${OPTION_LETTERS[i] || i + 1}</span><span class="opt-text">${esc(opt)}</span>
        </button>`).join('')}
      </div>
      <p class="q-status" id="q-status">${locked ? '🔒 Locked in! Watch the TV for the answer.' : 'Tap your answer'}</p>`;
  }

  function guestVoteHtml(snap, answer, canVote) {
    if (!canVote) return '<div class="q-note"><div class="q-note-emoji">🤫</div><p>This one is about you — shh!</p><p class="muted">Watch everyone guess on the TV.</p></div>';
    if (answer !== null) {
      const picked = snap.guests.find((g) => g.id === answer);
      return `<div class="q-note"><div class="q-note-emoji">🔒</div><p>Locked in! You picked <b>${esc(picked?.nickname || 'someone')}</b>.</p><p class="muted">Watch the TV for the answer.</p></div>`;
    }
    return `
      <div id="vote-picker" class="picker"></div>
      <div class="sticky-action"><button type="button" class="btn btn-gold btn-block btn-xl" id="vote-send" disabled>Pick a name</button></div>`;
  }

  function closedHtml(snap, answer) {
    const picked = answer !== null;
    return `<div class="q-note"><div class="q-note-emoji pulse">${picked ? '🔒' : '⏰'}</div>
      <p>${picked ? 'Locked in!' : 'Time is up for this one.'}</p><p class="muted">The answer is coming up on the TV…</p></div>`;
  }

  function resultsHtml(snap, answer) {
    const { round, me } = snap;
    const res = round.results;
    let verdict = '';
    if (round.type !== 'poll' && res.correct !== null) {
      const teamName = G().teamOf(me?.teamId)?.name || '';
      if (me?.round?.id === round.id && me.round.canVote === false) verdict = '<p class="verdict">🤫 This one was all about you!</p>';
      else if (answer === null) verdict = '<p class="verdict">You sat this one out. Next one is yours!</p>';
      else if (answer === res.correct) verdict = `<p class="verdict is-right">🎉 Correct! +10 points for Team ${esc(teamName)}</p>`;
      else verdict = '<p class="verdict is-wrong">❌ Not this time. Good guess though!</p>';
    }
    const author = round.type === 'guessWho' && res.author
      ? `<div class="author">${G().teamDot(res.author.teamId)}It was <b>${esc(res.author.nickname)}</b>${res.author.title ? `<span class="author-title">“${esc(res.author.title)}”</span>` : ''}</div>` : '';
    const max = Math.max(1, ...res.options.map((o) => o.votes));
    const bars = res.options.length ? res.options.map((o) => {
      const isCorrect = round.type !== 'poll' && o.id === res.correct;
      return `
        <div class="bar${isCorrect ? ' is-correct' : ''}${o.id === answer ? ' is-mine' : ''}">
          <div class="bar-fill" style="width:${Math.round((o.votes / max) * 100)}%"></div>
          <span class="bar-label">${o.teamId ? G().teamDot(o.teamId) : ''}${isCorrect ? '✅ ' : ''}${esc(o.label)}</span>
          <span class="bar-votes">${o.votes}</span>
        </div>`;
    }).join('') : '<p class="muted center">No votes this time.</p>';
    return `${author}${verdict}<div class="bars">${bars}</div><p class="muted center">${res.total} ${res.total === 1 ? 'answer' : 'answers'} · next question soon!</p>`;
  }

  function couplesView(couples) {
    if (!couples.me) {
      return { key: `couples-watch:${couples.id}`, html: '<div class="sheet q-note"><div class="q-note-emoji">💑</div><h2>Couples quiz is on the TV</h2><p class="muted">Cheer for the couples and see who is most in sync!</p></div>' };
    }
    const mine = couples.me;
    const answers = { ...mine.answers, ...pendingCouples };
    const done = couples.questions.filter((q) => answers[q.id]).length;
    const key = `couples:${couples.id}:${couples.status}:${couples.revealIndex}:${JSON.stringify(answers)}:${JSON.stringify(mine.choices)}`;
    const html = `
      <div class="sheet couples">
        <h2 class="couples-title">💑 Couples Quiz</h2>
        <p class="muted">Answer about the two of you. Your partner answers on their own phone, no peeking!</p>
        <p class="couples-progress">${done} of ${couples.questions.length} answered</p>
        ${couples.questions.map((q, i) => {
          const revealed = i <= couples.revealIndex;
          return `
            <div class="cq${revealed ? ' is-revealed' : ''}">
              <p class="cq-text"><span class="cq-num">${i + 1}</span>${esc(q.text)}</p>
              <div class="cq-choices">${mine.choices.map((c) => `
                <button type="button" class="btn cq-choice${answers[q.id] === c.id ? ' is-picked' : ''}" data-cq="${esc(q.id)}" data-choice="${esc(c.id)}" ${revealed ? 'disabled' : ''}>${esc(c.nickname)}</button>`).join('')}
              </div>
              ${revealed ? '<p class="cq-revealed">📺 Revealed on the TV</p>' : ''}
            </div>`;
        }).join('')}
      </div>`;
    return { key, html };
  }

  function physicalHtml(physical) {
    const status = {
      playing: '🎵 Music is playing! Keep moving!',
      stopped: '⏹️ The music stopped!',
      ready: '🙌 Get ready, the music starts soon',
      idle: '🙌 Get ready, the music starts soon',
    }[physical.status] || '';
    return `
      <div class="sheet phys${physical.status === 'stopped' ? ' is-stopped' : ''}">
        <p class="q-cat">Floor game · Round ${physical.round || 1}</p>
        <h2 class="phys-name">${esc(physical.info.name)}</h2>
        <p class="phys-rule">${esc(physical.info.rule)}</p>
        <p class="phys-status">${status}</p>
        ${physical.remaining !== null && physical.remaining !== undefined ? `<p class="phys-left"><b>${physical.remaining}</b>${esc(physical.info.unit)}</p>` : ''}
      </div>`;
  }

  function idleHtml() {
    return `
      <div class="sheet q-note idle">
        <div class="q-note-emoji float">📺</div>
        <h2>Waiting for the next game</h2>
        <p>Watch the TV! Questions pop up here the moment they start.</p>
      </div>
      <div class="idle-actions">
        <button type="button" class="btn btn-gold btn-block btn-xl" data-go="shoutout">📣 Send a Shout-out</button>
        <button type="button" class="btn btn-block btn-xl" data-go="photo">📷 Photo Fun</button>
      </div>`;
  }

  function renderPlay(snap) {
    const view = playView(snap);
    if (snap.round && snap.round.status === 'open' && votePicker) votePicker.update(snap.guests);
    if (view.key === playKey) return;
    playKey = view.key;
    stopRing();
    votePicker = null;
    const root = byId('play-body');
    root.innerHTML = view.html;
    if (view.mount) view.mount(root);
  }

  function mountRound(root, snap, answer, canVote) {
    const { round } = snap;
    if (round.status === 'open' && round.endsAt) startRing(round, answer !== null);
    root.querySelectorAll('[data-answer]').forEach((btn) => {
      btn.addEventListener('click', () => submitAnswer(round, Number(btn.dataset.answer)));
    });
    const pickerRoot = root.querySelector('#vote-picker');
    if (pickerRoot && canVote && answer === null) {
      const send = root.querySelector('#vote-send');
      votePicker = createGuestPicker(pickerRoot, {
        excludeId: () => null,
        onChange: (g) => {
          send.disabled = !g;
          send.textContent = g ? `🔒 Lock in ${g.nickname}` : 'Pick a name';
        },
      });
      votePicker.update(snap.guests);
      send.addEventListener('click', () => {
        const g = votePicker && votePicker.selected;
        if (g) submitAnswer(round, g.id);
      });
    }
  }

  function startRing(round, locked) {
    const total = Math.max(1, (round.seconds || 20) * 1000);
    const fg = document.querySelector('.ring-fg');
    const num = document.querySelector('.ring-num');
    const ring = document.querySelector('.ring');
    let expired = false;
    const tick = () => {
      const left = Math.max(0, round.endsAt - Party.now());
      fg.setAttribute('stroke-dashoffset', (RING_CIRC * (1 - left / total)).toFixed(1));
      num.textContent = String(Math.ceil(left / 1000));
      ring.classList.toggle('is-urgent', left < 5000);
      if (left <= 0 && !expired) {
        expired = true;
        if (!locked) {
          document.querySelectorAll('#play-body [data-answer], #vote-send').forEach((b) => { b.disabled = true; });
          const status = byId('q-status');
          if (status) status.textContent = '⏰ Time is up!';
        }
        return;
      }
      ringFrame = requestAnimationFrame(tick);
    };
    tick();
  }

  function stopRing() {
    cancelAnimationFrame(ringFrame);
    ringFrame = 0;
  }

  async function submitAnswer(round, answer) {
    if (pendingAnswer && pendingAnswer.roundId === round.id) return;
    pendingAnswer = { roundId: round.id, answer };
    G().vibrate(30);
    rerender();
    try {
      await Party.api(`/api/rounds/${encodeURIComponent(round.id)}/answer`, { method: 'POST', body: { guestId: G().id, answer } });
      Party.toast('🔒 Locked in!');
    } catch (err) {
      pendingAnswer = null;
      Party.toast(err.message, { error: true });
      rerender();
    }
  }

  async function answerCouples(questionId, choice) {
    const previous = pendingCouples[questionId];
    pendingCouples[questionId] = choice;
    rerender();
    try {
      await Party.api('/api/couples/answer', { method: 'POST', body: { guestId: G().id, questionId, choice } });
    } catch (err) {
      if (previous === undefined) delete pendingCouples[questionId];
      else pendingCouples[questionId] = previous;
      Party.toast(err.message, { error: true });
      rerender();
    }
  }

  function rerender() {
    playKey = '';
    const snap = G().snapshot;
    if (snap && G().route === 'play') renderPlay(snap);
  }

  function handleFx(fx) {
    if (fx.action === 'stop') G().vibrate(STOP_VIBRATION);
  }

  // ------------------------------------------------------------ shout-out

  function buildStickers(stickers) {
    if (stickersBuilt) return;
    stickersBuilt = true;
    byId('shout-stickers').innerHTML = stickers.map((s) => `
      <button type="button" class="btn sticker" data-sticker="${esc(s.id)}" aria-pressed="false">
        <span class="sticker-emoji">${esc(s.emoji)}</span><span class="sticker-text">${esc(s.text)}</span>
      </button>`).join('');
    byId('shout-stickers').addEventListener('click', (e) => {
      const btn = e.target.closest('.sticker');
      if (!btn) return;
      shoutSticker = btn.dataset.sticker;
      byId('shout-stickers').querySelectorAll('.sticker').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      updateShoutButton();
    });
  }

  function renderShoutout(snap) {
    buildStickers(snap.content.stickers);
    if (!shoutPicker) {
      shoutPicker = createGuestPicker(byId('shout-picker'), { excludeId: () => G().id, onChange: updateShoutButton });
      byId('shout-send').addEventListener('click', sendShoutout);
    }
    shoutPicker.update(snap.guests);
    const left = snap.me?.shoutoutsLeft ?? 0;
    byId('shout-left').textContent = left > 0 ? `You can send ${left} more this hour` : 'You have sent lots! Take a breather and try again soon.';
    updateShoutButton();
  }

  function updateShoutButton() {
    const btn = byId('shout-send');
    const to = shoutPicker && shoutPicker.selected;
    const sticker = G().snapshot?.content.stickers.find((s) => s.id === shoutSticker);
    const left = G().snapshot?.me?.shoutoutsLeft ?? 0;
    btn.disabled = !to || !sticker || left <= 0;
    if (!to) btn.textContent = '📣 Pick a guest';
    else if (!sticker) btn.textContent = '📣 Pick a sticker';
    else btn.textContent = `Send ${sticker.emoji} to ${to.nickname}`;
  }

  async function sendShoutout() {
    const to = shoutPicker && shoutPicker.selected;
    if (!to || !shoutSticker) return;
    const btn = byId('shout-send');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      await Party.api('/api/shoutouts', { method: 'POST', body: { guestId: G().id, to: to.id, sticker: shoutSticker } });
      const sticker = G().snapshot.content.stickers.find((s) => s.id === shoutSticker);
      G().burst(sticker ? sticker.emoji : '📣', `Sent to ${to.nickname}! Look at the TV`);
      resetShoutout();
    } catch (err) {
      Party.toast(err.message, { error: true });
      updateShoutButton();
    }
  }

  function resetShoutout() {
    shoutSticker = null;
    if (shoutPicker) shoutPicker.reset();
    document.querySelectorAll('#shout-stickers .sticker').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    if (G().snapshot && stickersBuilt) updateShoutButton();
  }

  // Couples choices use delegation because the list is re-rendered as answers land.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cq]');
    if (btn && !btn.disabled) answerCouples(btn.dataset.cq, btn.dataset.choice);
  });

  window.GuestPlay = { renderPlay, renderShoutout, resetShoutout, handleFx };
})();
