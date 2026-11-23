/* Host dashboard: Questions tab (per-type lists, inline add/edit, reorder, launch) and AI question review. */
(function () {
  'use strict';

  const H = window.Host;
  const esc = H.esc;
  const TYPES = [
    { id: 'quiz', label: 'Quiz', noun: 'quiz question' },
    { id: 'poll', label: 'Polls', noun: 'poll' },
    { id: 'guessWho', label: 'Guess Who', noun: 'Guess Who clue' },
    { id: 'couples', label: 'Couples', noun: 'couples question' },
  ];
  const LAUNCHABLE = ['quiz', 'poll', 'guessWho'];
  const OPTION_LIMITS = { quiz: [2, 4], poll: [2, 6] };
  const DEFAULT_OPTIONS = { quiz: 4, poll: 2 };
  const DEFAULT_SECONDS = 20;

  let sub = 'quiz';
  let editing = null; // { type, id ('new' for the add form), optionCount }
  let generating = false;

  // ------------------------------------------------------------------ render

  function render(s) {
    const list = s.host.questions[sub] || [];
    const type = TYPES.find((t) => t.id === sub);
    return `
      <div class="panel-head">
        <h2>Questions</h2>
        <button class="btn btn-gold btn-sm" type="button" data-action="q-generate"${generating ? ' disabled' : ''}>
          ${generating ? '<span class="spinner"></span> Thinking… (up to 20 s)' : '✨ Generate Party Questions'}</button>
      </div>
      ${aiReview(s)}
      <div class="subtabs" role="tablist">${TYPES.map((t) => `
        <button type="button" role="tab" class="seg${t.id === sub ? ' is-on' : ''}" aria-selected="${t.id === sub}"
          data-action="q-sub" data-type="${t.id}">${t.label} <span class="count">${s.host.questions[t.id].length}</span></button>`).join('')}
      </div>
      ${editing && editing.id === 'new' && editing.type === sub ? form(sub, null)
        : `<button class="btn btn-ghost btn-block add-btn" type="button" data-action="q-add">+ Add ${type.noun}</button>`}
      <div class="q-list">${list.map((q, i) => (editing && editing.id === q.id ? form(sub, q) : item(s, q, i, list.length))).join('')
        || `<p class="empty">No ${type.noun}s yet.</p>`}</div>`;
  }

  function aiReview(s) {
    const items = s.host.pendingAiQuestions;
    if (!items.length) return '';
    return `<div class="card ai-review">
      <h3>✨ Review AI questions <span class="count">${items.length}</span></h3>
      <p class="hint">Approve the ones you like; they join the Guess Who or Polls list.</p>
      ${items.map((q) => `<div class="ai-item">
        <div><span class="tag">${q.kind === 'guessWho' ? `Guess Who · ${esc(H.guestName(q.authorId))}` : 'Most Likely To'}</span>
          <div class="q-text">${esc(q.text)}</div></div>
        <div class="btn-row">
          <button class="btn btn-gold btn-sm" type="button" data-action="ai-approve" data-id="${esc(q.id)}">Approve</button>
          <button class="btn btn-ghost btn-sm" type="button" data-action="ai-drop" data-id="${esc(q.id)}">Delete</button>
        </div>
      </div>`).join('')}
    </div>`;
  }

  function askedState(s, q) {
    if (s.host.round && s.host.round.questionId === q.id) return '<span class="tag tag-live">Live now</span>';
    if (s.host.roundHistory.some((r) => r.questionId === q.id)) return '<span class="tag tag-done">Asked</span>';
    return '';
  }

  function meta(q) {
    if (sub === 'quiz') {
      return `<span class="tag">${esc(q.category)}</span> ${q.options.map((o, i) => `<span class="opt${i === q.answer ? ' is-correct' : ''}">${i === q.answer ? '✓ ' : ''}${esc(o)}</span>`).join('')}`;
    }
    if (sub === 'poll') {
      return q.mostLikely ? '<span class="tag">Most Likely To · options = guests</span>'
        : q.options.map((o) => `<span class="opt">${esc(o)}</span>`).join('');
    }
    if (sub === 'guessWho') {
      const source = { card: 'From About Me card', ai: 'AI riddle', host: 'Host clue' }[q.source] || 'Host clue';
      return `<span class="tag">${source}</span> ${q.authorId ? `Answer: <b>${esc(H.guestName(q.authorId))}</b>` : '<i>No author: just for fun</i>'}`;
    }
    return '';
  }

  function item(s, q, i, total) {
    const id = esc(q.id);
    return `<article class="card q-item">
      <div class="q-num">${i + 1}</div>
      <div class="q-main">
        <div class="q-text">${esc(q.text)} ${askedState(s, q)}</div>
        <div class="q-meta">${meta(q)}</div>
      </div>
      <div class="q-actions">
        ${LAUNCHABLE.includes(sub) ? `<button class="btn btn-sm btn-gold" type="button" data-action="q-launch" data-id="${id}">▶ Launch</button>` : ''}
        <button class="btn btn-sm btn-ghost" type="button" data-action="q-edit" data-id="${id}">Edit</button>
        <button class="btn btn-sm btn-ghost icon-btn" type="button" data-action="q-move" data-id="${id}" data-delta="-1"
          aria-label="Move up"${i === 0 ? ' disabled' : ''}>↑</button>
        <button class="btn btn-sm btn-ghost icon-btn" type="button" data-action="q-move" data-id="${id}" data-delta="1"
          aria-label="Move down"${i === total - 1 ? ' disabled' : ''}>↓</button>
        <button class="btn btn-sm btn-ghost icon-btn" type="button" data-action="q-delete" data-id="${id}" data-confirm="Delete?"
          aria-label="Delete">🗑</button>
      </div>
    </article>`;
  }

  function optionsBlock(type, q) {
    const n = editing.optionCount;
    const [min, max] = OPTION_LIMITS[type];
    const off = type === 'poll' && q && q.mostLikely;
    const rows = Array.from({ length: n }, (_, i) => {
      const value = q && q.options[i] ? q.options[i] : '';
      const radio = type === 'quiz' ? `<label class="radio" title="Correct answer"><input type="radio" name="answer" value="${i}"
        ${(q ? q.answer === i : i === 0) ? ' checked' : ''} required><span class="sr-only">Option ${i + 1} is correct</span></label>` : '';
      return `<div class="opt-row">${radio}<input type="text" name="opt${i}" value="${esc(value)}" maxlength="60"
        placeholder="Option ${i + 1}"${off ? '' : ' required'} aria-label="Option ${i + 1}"></div>`;
    }).join('');
    return `<fieldset class="opts"${off ? ' hidden' : ''}>
      <legend>${type === 'quiz' ? 'Options: tap the circle next to the correct one' : 'Options'}</legend>
      ${rows}
      <div class="btn-row">
        <button class="btn btn-sm btn-ghost" type="button" data-action="q-opt" data-delta="1"${n >= max ? ' disabled' : ''}>+ Option</button>
        <button class="btn btn-sm btn-ghost" type="button" data-action="q-opt" data-delta="-1"${n <= min ? ' disabled' : ''}>− Option</button>
      </div>
    </fieldset>`;
  }

  function form(type, q) {
    const key = `qf-${type}-${q ? q.id : 'new'}`;
    let fields = '';
    if (type === 'quiz') {
      fields = `<div class="field-row">
          <label class="field">Category<input type="text" name="category" value="${esc(q ? q.category : 'Quiz')}" maxlength="30"></label>
          <label class="field field-narrow">Seconds<input type="number" name="seconds" value="${q ? q.seconds || DEFAULT_SECONDS : DEFAULT_SECONDS}" min="5" max="120" inputmode="numeric"></label>
        </div>${optionsBlock(type, q)}`;
    } else if (type === 'poll') {
      fields = `${H.toggle('poll-ml', q ? q.mostLikely : false, 'Most Likely To', 'Options are the guest list', 'mostLikely')}
        ${optionsBlock(type, q)}`;
    } else if (type === 'guessWho') {
      fields = `<label class="field">Who wrote it? (the answer)
        <select name="authorId">${H.guestOptions(q ? q.authorId : '', { blank: 'Nobody: host clue, no points' })}</select></label>`;
    }
    return `<form class="card q-form" data-submit="q-save" data-key="${esc(key)}" data-type="${type}" data-id="${esc(q ? q.id : '')}">
      <h3>${q ? 'Edit' : 'New'} ${TYPES.find((t) => t.id === type).noun}</h3>
      <label class="field">Question<textarea name="text" rows="2" maxlength="160" required>${esc(q ? q.text : '')}</textarea></label>
      ${fields}
      <div class="btn-row">
        <button class="btn btn-gold" type="submit">Save</button>
        <button class="btn btn-ghost" type="button" data-action="q-cancel">Cancel</button>
      </div>
    </form>`;
  }

  // ------------------------------------------------------------------ helpers

  function startEditing(id) {
    const q = id === 'new' ? null : H.state.host.questions[sub].find((x) => x.id === id);
    const limits = OPTION_LIMITS[sub];
    const count = q && q.options && q.options.length ? q.options.length : DEFAULT_OPTIONS[sub] || 0;
    editing = { type: sub, id, optionCount: limits ? Math.min(limits[1], Math.max(limits[0], count)) : 0 };
    H.rerender();
  }

  function bodyFrom(type, data) {
    const options = Array.from({ length: editing.optionCount }, (_, i) => (data[`opt${i}`] || '').trim());
    if (type === 'quiz') {
      return { text: data.text, category: data.category, seconds: Number(data.seconds) || DEFAULT_SECONDS, options, answer: Number(data.answer) };
    }
    if (type === 'poll') return { text: data.text, mostLikely: data.mostLikely === 'on', options: data.mostLikely === 'on' ? [] : options };
    if (type === 'guessWho') return { text: data.text, authorId: data.authorId || null };
    return { text: data.text };
  }

  function questionUrl(id, suffix = '') {
    return `/questions/${sub}/${encodeURIComponent(id)}${suffix}`;
  }

  // ------------------------------------------------------------------ handlers

  H.register({
    panel: 'questions',
    render,
    actions: {
      'q-sub'(el) {
        sub = el.dataset.type;
        editing = null;
        H.rerender();
      },
      'q-add': () => startEditing('new'),
      'q-edit': (el) => startEditing(el.dataset.id),
      'q-cancel'() {
        editing = null;
        H.rerender();
      },
      'q-opt'(el) {
        const [min, max] = OPTION_LIMITS[editing.type];
        editing.optionCount = Math.min(max, Math.max(min, editing.optionCount + Number(el.dataset.delta)));
        H.rerender();
      },
      'q-launch'(el) {
        return H.call('/round/launch', { body: { type: sub, questionId: el.dataset.id }, ok: 'Question is live on the TV 🎯' });
      },
      'q-move'(el) {
        const list = H.state.host.questions[sub];
        const i = list.findIndex((q) => q.id === el.dataset.id);
        const j = i + Number(el.dataset.delta);
        if (i >= 0 && j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]];
        H.rerender();
        return H.call(questionUrl(el.dataset.id, '/move'), { body: { delta: Number(el.dataset.delta) } });
      },
      'q-delete'(el) {
        const qs = H.state.host.questions;
        qs[sub] = qs[sub].filter((q) => q.id !== el.dataset.id);
        H.rerender();
        return H.call(questionUrl(el.dataset.id), { method: 'DELETE', ok: 'Question deleted' });
      },
      async 'q-generate'() {
        generating = true;
        H.rerender();
        Party.toast('Asking AI for party questions. This can take up to 20 seconds.', { ms: 3500 });
        const res = await H.call('/generate-questions');
        generating = false;
        H.rerender();
        if (res) {
          Party.toast(res.added ? `✨ ${res.added} new questions to review` : 'AI was unavailable, so no new questions this time',
            { error: !res.added, ms: 4000 });
        }
      },
      'ai-approve'(el) {
        return H.call(`/ai-questions/${encodeURIComponent(el.dataset.id)}/approve`, { ok: 'Added to your questions' });
      },
      'ai-drop'(el) {
        const s = H.state;
        s.host.pendingAiQuestions = s.host.pendingAiQuestions.filter((q) => q.id !== el.dataset.id);
        H.rerender();
        return H.call(`/ai-questions/${encodeURIComponent(el.dataset.id)}`, { method: 'DELETE' });
      },
    },
    changes: {
      'poll-ml'(el) {
        const opts = el.closest('form').querySelector('.opts');
        opts.hidden = el.checked;
        for (const input of opts.querySelectorAll('input')) input.required = !el.checked;
      },
    },
    submits: {
      async 'q-save'(form, data) {
        const type = form.dataset.type;
        const id = form.dataset.id;
        const body = bodyFrom(type, data);
        const res = id
          ? await H.call(`/questions/${type}/${encodeURIComponent(id)}`, { method: 'PUT', body, ok: 'Saved' })
          : await H.call(`/questions/${type}`, { body, ok: 'Question added' });
        if (!res) return;
        editing = null;
        H.rerender();
      },
    },
  });
})();
