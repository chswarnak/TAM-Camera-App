/* Shared browser helpers for guest, TV and host pages (no framework, no bundler). */
(function () {
  'use strict';

  let clockOffset = 0;

  /** Server-synchronised Date.now(), so countdowns agree across phones and TV. */
  function now() {
    return Date.now() + clockOffset;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function toast(message, { error = false, ms = 2600 } = {}) {
    let wrap = document.querySelector('.toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'toast-wrap';
      document.body.appendChild(wrap);
    }
    const el = document.createElement('div');
    el.className = `toast${error ? ' error' : ''}`;
    el.textContent = message;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  /**
   * JSON fetch helper. Throws Error(message) with the server's friendly
   * message on any non-2xx. `headers` are merged (e.g. x-host-pin).
   */
  async function api(path, { method = 'GET', body, headers = {}, raw } = {}) {
    const opts = { method, headers: { ...headers } };
    if (raw) {
      opts.body = raw;
      opts.headers['content-type'] = 'image/jpeg';
    } else if (body !== undefined) {
      opts.body = JSON.stringify(body);
      opts.headers['content-type'] = 'application/json';
    }
    let res;
    try {
      res = await fetch(path, opts);
    } catch (err) {
      throw new Error('Cannot reach the party server. Check you are on the home Wi-Fi.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(data.error || `Request failed (${res.status})`);
      e.status = res.status;
      throw e;
    }
    return data;
  }

  /**
   * Opens the SSE stream and keeps it open forever (EventSource retries by
   * itself; we also rebuild it if it closes for good, e.g. after a restart).
   * onState(snapshot) fires for every snapshot, onFx(effect) for one-off effects.
   */
  function connect(url, { onState, onFx, onStatus }) {
    let es;
    let retryTimer;
    function open() {
      es = new EventSource(url);
      es.addEventListener('open', () => onStatus && onStatus(true));
      es.addEventListener('state', (e) => {
        const data = JSON.parse(e.data);
        if (data.serverNow) clockOffset = data.serverNow - Date.now();
        onState(data);
      });
      es.addEventListener('fx', (e) => onFx && onFx(JSON.parse(e.data)));
      es.addEventListener('error', () => {
        onStatus && onStatus(false);
        if (es.readyState === EventSource.CLOSED) {
          clearTimeout(retryTimer);
          retryTimer = setTimeout(open, 3000);
        }
      });
    }
    open();
    // Cancel a pending retry too, or it would open a second stream nobody closes;
    // each stray stream holds one of the browser's six connections to this server.
    return {
      close: () => {
        clearTimeout(retryTimer);
        if (es) es.close();
      },
    };
  }

  /** Adds pressed-state feedback to any .btn on touch, before the click fires. */
  function pressFeedback(root = document) {
    root.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest('.btn');
      if (!btn) return;
      btn.classList.add('is-pressed');
      const up = () => { btn.classList.remove('is-pressed'); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  /** Returns an <svg> string QR code for `text` using the vendored qrcode-generator. */
  function qrSvg(text, { margin = 2 } = {}) {
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 8, margin, scalable: true });
  }

  window.Party = { now, escapeHtml, toast, api, connect, pressFeedback, qrSvg };
})();
