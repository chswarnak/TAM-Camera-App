/* Photo Fun editor: Fabric canvas with the photo as a locked background (filters + backdrop are canvas ops),
 * props as selectable images, the 9-slice frame as the overlay, and the caption as a movable object drawn
 * above the frame. Exports a full-resolution JPEG (long edge ≤ 2400) through the same render path. */
(function () {
  'use strict';

  const EXPORT_QUALITY = 0.9;
  const PREVIEW_EDGE = 600;
  const PREVIEW_QUALITY = 0.8;
  const PROP_SIZE_RATIO = 0.36;
  const PROP_STACK_OFFSET = 0.04;
  const MIN_PROP_PX = 24;
  const CAPTION_WAIT_MS = 25000;
  const CAPTION_HISTORY_DELAY_MS = 700;
  const CAPTION_INSET_RATIO = 0.03;
  const CAPTION_POSITIONS = ['top', 'bottom', 'hide'];
  const SENSITIVITY_DELAY_MS = 300;
  const HISTORY_LIMIT = 40;
  const STAGE_PADDING = 12;
  const TIP_SPACE = 26;
  const THUMB_EDGE = 120;
  const SERIAL_PROPS = ['propId', 'propName'];
  const FILTERS = [
    { id: 'original', label: 'Original' },
    { id: 'warm', label: 'Warm' },
    { id: 'bw', label: 'Black & White' },
  ];
  const CONTROL_STYLE = {
    cornerSize: 28, touchCornerSize: 44, transparentCorners: false, cornerStyle: 'circle',
    cornerColor: '#D4A017', cornerStrokeColor: '#6B1E2E', borderColor: '#D4A017',
    borderScaleFactor: 2, padding: 6,
  };

  const byId = (id) => document.getElementById(id);
  const esc = (v) => Party.escapeHtml(v);
  const G = () => window.Guest;
  const Img = () => window.EditorImage;

  const S = {
    view: 'start',
    assetsKey: '',
    assets: { frames: [], props: [], backdrops: [] },
    canvas: null,
    size: null,
    original: null,
    photoVersion: 0,
    filter: 'original',
    frame: null,
    frameImages: new Map(),
    sceneImages: new Map(),
    backdrop: { on: false, sceneId: null, sensitivity: 0.5, mask: null, maskKey: '', maskVersion: 0, job: null, composite: null, compositeKey: '' },
    overlayCanvas: null,
    caption: '',
    captionPos: 'bottom',
    captionObj: null,
    captionFrame: 0,
    captionTimer: 0,
    sensitivityTimer: 0,
    history: [],
    restoring: false,
    version: 0,
    exported: null,
    presets: [],
    aiCaptions: null,
    captionRequest: null,
    earlyCaptions: new Map(),
    busy: 0,
    sharing: false,
    propCount: 0,
  };

  // ------------------------------------------------------------ views

  function setView(view) {
    S.view = view;
    byId('ed-start').hidden = view !== 'start';
    byId('ed-main').hidden = view === 'start';
    byId('ed-result').hidden = view !== 'saved' && view !== 'shared';
    byId('ed-result-saved').hidden = view !== 'saved';
    byId('ed-result-shared').hidden = view !== 'shared';
    document.querySelector('[data-ed="resume"]').hidden = !S.original;
  }

  function open() {
    setView(S.original && S.view !== 'start' ? 'main' : 'start');
    if (S.view === 'main') refit();
    loadAssets();
  }

  function update(snap) {
    const presets = snap.content.captions || [];
    if (JSON.stringify(presets) === JSON.stringify(S.presets)) return;
    S.presets = presets;
    renderChips();
  }

  const ready = () => Boolean(S.canvas && S.original && S.size);

  function setBusy(on, text) {
    S.busy = Math.max(0, S.busy + (on ? 1 : -1));
    if (on && text) byId('ed-busy-text').textContent = text;
    byId('ed-busy').hidden = S.busy === 0;
  }

  // ------------------------------------------------------------ assets + trays

  async function loadAssets() {
    try {
      const assets = await Party.api('/api/assets');
      const key = JSON.stringify(assets);
      if (key === S.assetsKey) return;
      S.assetsKey = key;
      S.assets = assets;
      renderTrays();
    } catch (err) {
      Party.toast(err.message, { error: true });
    }
  }

  function tile(attr, id, thumb, label, active) {
    return `<button type="button" class="tile-thumb${active ? ' is-active' : ''}" ${attr}="${esc(id)}">${thumb}<span>${esc(label)}</span></button>`;
  }

  function renderTrays() {
    const { frames, props, backdrops } = S.assets;
    byId('tray-frames').innerHTML = tile('data-frame', '', '<span class="thumb thumb-none">🚫</span>', 'No frame', !S.frame)
      + frames.map((f) => tile('data-frame', f.id, `<img class="thumb" src="${esc(f.url)}" alt="">`, f.name, S.frame?.id === f.id)).join('');
    byId('tray-props').innerHTML = props.length
      ? props.map((p) => tile('data-prop', p.id, `<img class="thumb" src="${esc(p.url)}" alt="">`, p.name, false)).join('')
      : '<p class="tray-empty">Stickers are on their way…</p>';
    byId('tray-scenes').innerHTML = backdrops.length
      ? backdrops.map((b) => tile('data-scene', b.id, `<img class="thumb thumb-cover" src="${esc(b.url)}" alt="" loading="lazy">`, b.name, S.backdrop.sceneId === b.id)).join('')
      : '<p class="tray-empty">Scenes are on their way…</p>';
  }

  function buildFilterTray() {
    byId('tray-filters').innerHTML = FILTERS.map((f) => tile('data-filter', f.id, '<span class="thumb thumb-filter"></span>', f.label, S.filter === f.id)).join('');
  }

  function drawFilterThumbs() {
    const small = Img().scaledCopy(S.original, THUMB_EDGE);
    FILTERS.forEach((f) => {
      const holder = document.querySelector(`[data-filter="${f.id}"] .thumb`);
      const thumb = Img().applyFilter(small, f.id);
      thumb.className = 'thumb thumb-cover';
      holder.replaceWith(thumb);
    });
  }

  function markActive(attr, id) {
    document.querySelectorAll(`[${attr}]`).forEach((t) => t.classList.toggle('is-active', t.getAttribute(attr) === id));
  }

  // ------------------------------------------------------------ canvas setup + sizing

  function ensureCanvas() {
    if (S.canvas) return;
    Object.assign(fabric.Object.prototype, CONTROL_STYLE);
    S.canvas = new fabric.Canvas('ed-canvas', {
      preserveObjectStacking: true, selection: false, allowTouchScrolling: false,
      controlsAboveOverlay: true, stopContextMenu: true, enableRetinaScaling: true,
    });
    installTopLayer(S.canvas);
    S.canvas.on('object:modified', (e) => onObjectChanged(e.target));
    S.canvas.on('selection:created', updateToolbar);
    S.canvas.on('selection:updated', updateToolbar);
    S.canvas.on('selection:cleared', updateToolbar);
    window.EditorGestures.attach(S.canvas, byId('ed-stage'), { onChange: onObjectChanged, canDelete: (o) => !isCaption(o) });
    if (document.fonts) document.fonts.load('40px "Yatra One"').then(rerenderCaption, (err) => console.warn('[editor] caption font did not load', err));
  }

  const isCaption = (o) => Boolean(o && o.isCaption);

  /**
   * Fabric paints objects, then the overlay (our frame), then controls. The caption must sit above the
   * frame, so caption objects are skipped in the object pass and painted right after the overlay.
   * toCanvasElement() (save/share export) runs the same renderCanvas(), so the JPEG matches the screen.
   * Relies on Fabric 5.3.0's _renderObjects/_renderOverlay (vendored, pinned).
   */
  function installTopLayer(canvas) {
    const renderObjects = canvas._renderObjects;
    const renderOverlay = canvas._renderOverlay;
    let top = [];
    canvas._renderObjects = function (ctx, objects) {
      top = objects.filter(isCaption);
      renderObjects.call(this, ctx, objects.filter((o) => !isCaption(o)));
    };
    canvas._renderOverlay = function (ctx) {
      renderOverlay.call(this, ctx);
      if (!top.length) return;
      const v = this.viewportTransform;
      ctx.save();
      ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
      top.forEach((o) => o.render(ctx));
      ctx.restore();
    };
  }

  function fitSize() {
    const stage = byId('ed-stage');
    const maxW = stage.clientWidth - STAGE_PADDING * 2;
    const maxH = stage.clientHeight - STAGE_PADDING * 2 - TIP_SPACE;
    const scale = Math.min(maxW / S.original.width, maxH / S.original.height);
    return { w: Math.max(1, Math.floor(S.original.width * scale)), h: Math.max(1, Math.floor(S.original.height * scale)) };
  }

  /** Resizes the display canvas, scaling props (and the undo history) so nothing jumps. */
  function applySize(next) {
    const prev = S.size;
    S.size = next;
    S.canvas.setDimensions({ width: next.w, height: next.h });
    if (prev && prev.w !== next.w) {
      const k = next.w / prev.w;
      const scaleData = (o) => ({ ...o, left: o.left * k, top: o.top * k, scaleX: o.scaleX * k, scaleY: o.scaleY * k });
      S.canvas.getObjects().forEach((o) => {
        o.set(scaleData(o));
        o.setCoords();
      });
      S.history = S.history.map((h) => {
        const state = JSON.parse(h);
        state.objects = state.objects.map(scaleData);
        if (state.caption.geom) state.caption.geom = scaleData(state.caption.geom);
        return JSON.stringify(state);
      });
    }
    [S.canvas.backgroundImage, S.canvas.overlayImage].forEach((layer) => {
      if (layer) layer.set(layerOptions(layer.getElement()));
    });
    S.canvas.requestRenderAll();
  }

  function refit() {
    if (!ready() || S.view === 'start') return;
    const active = document.activeElement;
    if (active && active.tagName === 'INPUT') return;
    const next = fitSize();
    if (next.w !== S.size.w || next.h !== S.size.h) applySize(next);
  }

  function layerOptions(element) {
    return {
      left: 0, top: 0, originX: 'left', originY: 'top', selectable: false, evented: false, objectCaching: false,
      scaleX: S.size.w / element.width, scaleY: S.size.h / element.height,
    };
  }

  // ------------------------------------------------------------ photo loading

  async function loadPhoto(file) {
    if (!file) return;
    setBusy(true, 'Opening your photo…');
    try {
      const original = await Img().decodeFile(file);
      resetForPhoto(original);
      setView('main');
      ensureCanvas();
      S.size = null;
      applySize(fitSize());
      refreshBackground();
      refreshOverlay();
      updateCaptionPosUi();
      pushHistory();
      drawFilterThumbs();
      updateBackdropUi();
    } catch (err) {
      console.error('[editor] could not open photo', err);
      Party.toast('Sorry, that photo would not open. Please try another one.', { error: true });
    } finally {
      setBusy(false);
    }
  }

  function resetForPhoto(original) {
    cancelBackdropJob();
    S.original = original;
    S.photoVersion += 1;
    S.filter = 'original';
    Object.assign(S.backdrop, { on: false, mask: null, maskKey: '', composite: null, compositeKey: '' });
    S.caption = '';
    S.captionPos = 'bottom';
    S.captionObj = null;
    byId('ed-caption-input').value = '';
    S.aiCaptions = null;
    S.history = [];
    S.overlayCanvas = Img().createCanvas(original.width, original.height);
    if (S.canvas) {
      S.canvas.discardActiveObject();
      S.canvas.remove(...S.canvas.getObjects());
    }
    buildFilterTray();
    renderChips();
  }

  // ------------------------------------------------------------ background (filters + backdrop) and overlay (frame)

  function backgroundBase() {
    const b = S.backdrop;
    const scene = S.sceneImages.get(b.sceneId);
    if (!b.on || !b.mask || !scene) return S.original;
    const key = `${b.sceneId}|${b.maskVersion}`;
    if (b.compositeKey !== key) {
      b.composite = Img().compositeBackdrop(S.original, b.mask, scene);
      b.compositeKey = key;
    }
    return b.composite;
  }

  function refreshBackground() {
    const base = backgroundBase();
    const element = S.filter === 'original' ? base : Img().applyFilter(base, S.filter);
    S.canvas.backgroundImage = new fabric.Image(element, layerOptions(element));
    S.canvas.requestRenderAll();
    markDirty();
  }

  function refreshOverlay() {
    if (!ready()) return;
    const hasContent = Img().drawOverlay(S.overlayCanvas, { frame: S.frame?.img || null });
    S.canvas.overlayImage = hasContent ? new fabric.Image(S.overlayCanvas, layerOptions(S.overlayCanvas)) : null;
    S.canvas.requestRenderAll();
    markDirty();
  }

  function setFilter(id) {
    if (!ready()) return;
    S.filter = id;
    markActive('data-filter', id);
    refreshBackground();
  }

  async function setFrame(id) {
    if (!ready()) return;
    markActive('data-frame', id);
    if (!id) {
      S.frame = null;
      refreshOverlay();
      return;
    }
    const meta = S.assets.frames.find((f) => f.id === id);
    if (!meta) return;
    try {
      if (!S.frameImages.has(id)) S.frameImages.set(id, await Img().loadImage(meta.url));
      S.frame = { ...meta, img: S.frameImages.get(id) };
      refreshOverlay();
    } catch (err) {
      console.error('[editor] frame failed to load', err);
      Party.toast('That frame did not load. Try again.', { error: true });
    }
  }

  // ------------------------------------------------------------ backdrop (best-effort, never blocks the editor)

  function cancelBackdropJob() {
    if (S.backdrop.job) S.backdrop.job.cancelled = true;
    S.backdrop.job = null;
  }

  function updateBackdropUi() {
    const btn = byId('bd-toggle');
    btn.textContent = S.backdrop.on ? '✨ Magic Backdrop: On' : '✨ Magic Backdrop: Off';
    btn.setAttribute('aria-pressed', String(S.backdrop.on));
    btn.classList.toggle('btn-gold', S.backdrop.on);
    markActive('data-scene', S.backdrop.on ? S.backdrop.sceneId : '__none__');
  }

  async function sceneImage(id) {
    if (!S.sceneImages.has(id)) {
      const meta = S.assets.backdrops.find((b) => b.id === id);
      if (!meta) throw new Error(`Unknown backdrop ${id}`);
      S.sceneImages.set(id, await Img().loadImage(meta.url));
    }
    return S.sceneImages.get(id);
  }

  function toggleBackdrop() {
    if (!ready()) return;
    const b = S.backdrop;
    if (b.on) {
      b.on = false;
      cancelBackdropJob();
      updateBackdropUi();
      refreshBackground();
      return;
    }
    if (!S.assets.backdrops.length) {
      Party.toast('Backdrop scenes are not ready yet');
      return;
    }
    b.on = true;
    if (!b.sceneId) b.sceneId = S.assets.backdrops[0].id;
    updateBackdropUi();
    Party.toast('Tip: stand by a plain white wall');
    applyBackdrop();
  }

  function pickScene(id) {
    if (!ready()) return;
    S.backdrop.sceneId = id;
    S.backdrop.on = true;
    updateBackdropUi();
    applyBackdrop();
  }

  async function applyBackdrop() {
    const b = S.backdrop;
    cancelBackdropJob();
    const job = { cancelled: false };
    b.job = job;
    setBusy(true, 'Swapping the background…');
    try {
      await sceneImage(b.sceneId);
      const key = `${S.photoVersion}|${b.sensitivity}`;
      if (!b.mask || b.maskKey !== key) {
        const mask = await Img().computeMask(S.original, b.sensitivity, job);
        if (!mask) return;
        Object.assign(b, { mask, maskKey: key, maskVersion: b.maskVersion + 1 });
      }
      if (!job.cancelled && b.on) refreshBackground();
    } catch (err) {
      console.error('[editor] backdrop failed', err);
      b.on = false;
      updateBackdropUi();
      refreshBackground();
      Party.toast('The backdrop did not work on this photo. Try another scene.', { error: true });
    } finally {
      if (b.job === job) b.job = null;
      setBusy(false);
    }
  }

  function onSensitivity(e) {
    S.backdrop.sensitivity = Number(e.target.value) / 100;
    clearTimeout(S.sensitivityTimer);
    S.sensitivityTimer = setTimeout(() => { if (S.backdrop.on) applyBackdrop(); }, SENSITIVITY_DELAY_MS);
  }

  // ------------------------------------------------------------ props

  function decorate(obj) {
    obj.setControlsVisibility({ ml: false, mr: false, mt: false, mb: false });
    obj.set({ lockScalingFlip: true, minScaleLimit: MIN_PROP_PX / Math.max(obj.width, obj.height) });
  }

  function addProp(id) {
    if (!ready()) return;
    const meta = S.assets.props.find((p) => p.id === id);
    if (!meta) return;
    fabric.Image.fromURL(meta.url, (img, failed) => {
      if (failed || !img.width) {
        Party.toast('That sticker did not load. Try again.', { error: true });
        return;
      }
      const short = Math.min(S.size.w, S.size.h);
      const nudge = (S.propCount % 5) * PROP_STACK_OFFSET * short;
      S.propCount += 1;
      img.scale((short * PROP_SIZE_RATIO) / Math.max(img.width, img.height));
      img.set({ left: S.size.w / 2 + nudge, top: S.size.h / 2 + nudge, originX: 'center', originY: 'center', propId: meta.id, propName: meta.name });
      decorate(img);
      S.canvas.add(img);
      keepCaptionOnTop();
      S.canvas.setActiveObject(img);
      S.canvas.requestRenderAll();
      pushHistory();
    });
  }

  function removeSelected() {
    const selected = S.canvas ? S.canvas.getActiveObjects() : [];
    if (!selected.length) {
      Party.toast('Tap a sticker first, then Remove');
      return;
    }
    if (selected.some(isCaption)) {
      setCaptionPos('hide');
      Party.toast('Caption hidden. Tap Top or Bottom to bring it back');
      return;
    }
    S.canvas.discardActiveObject();
    S.canvas.remove(...selected);
    S.canvas.requestRenderAll();
    pushHistory();
  }

  function clearAll() {
    if (!ready()) return;
    if (!S.canvas.getObjects().length && !S.caption) {
      Party.toast('Nothing to clear yet');
      return;
    }
    S.canvas.discardActiveObject();
    S.canvas.remove(...S.canvas.getObjects());
    S.captionObj = null;
    S.captionPos = 'bottom';
    setCaption('');
    pushHistory();
    Party.toast('Cleared! Tap Undo to bring it back');
  }

  // ------------------------------------------------------------ undo history (props + caption; background kept separately)

  /** Props are serialised by Fabric; the caption as text + position + geometry (its pixels are re-rendered). */
  function currentState() {
    const obj = S.captionObj;
    const geom = obj ? { left: obj.left, top: obj.top, scaleX: obj.scaleX, scaleY: obj.scaleY, angle: obj.angle } : null;
    return JSON.stringify({
      objects: S.canvas.getObjects().filter((o) => !isCaption(o)).map((o) => o.toObject(SERIAL_PROPS)),
      caption: { text: S.caption, pos: S.captionPos, geom },
    });
  }

  function pushHistory() {
    if (S.restoring || !ready()) return;
    clearTimeout(S.captionTimer);
    const state = currentState();
    if (S.history[S.history.length - 1] === state) return;
    S.history.push(state);
    if (S.history.length > HISTORY_LIMIT) S.history.shift();
    markDirty();
    updateToolbar();
  }

  function undo() {
    if (!ready() || S.history.length < 2) {
      Party.toast('Nothing to undo');
      return;
    }
    S.history.pop();
    const state = JSON.parse(S.history[S.history.length - 1]);
    S.restoring = true;
    fabric.util.enlivenObjects(state.objects, (objects) => {
      S.canvas.discardActiveObject();
      S.canvas.remove(...S.canvas.getObjects());
      objects.forEach((o) => {
        decorate(o);
        S.canvas.add(o);
      });
      S.captionObj = null;
      S.captionPos = state.caption.pos;
      if (state.caption.geom) createCaptionObject().set(state.caption.geom);
      setCaption(state.caption.text);
      S.restoring = false;
      S.canvas.requestRenderAll();
      markDirty();
      updateToolbar();
    });
  }

  function updateToolbar() {
    if (!S.canvas) return;
    byId('ed-undo').disabled = S.history.length < 2;
    byId('ed-remove').disabled = !S.canvas.getActiveObject();
  }

  function markDirty() {
    S.version += 1;
  }

  // ------------------------------------------------------------ caption (a movable Fabric object above the frame)

  /** The caption's pixels are rendered at photo resolution, so its display scale starts at canvas/photo. */
  function createCaptionObject() {
    const obj = new fabric.Image(Img().createCanvas(1, 1), {
      left: S.size.w / 2, top: S.size.h / 2, originX: 'center', originY: 'center', objectCaching: false, isCaption: true,
    });
    obj.scale(S.size.w / S.original.width);
    S.captionObj = obj;
    S.canvas.add(obj);
    return obj;
  }

  function keepCaptionOnTop() {
    if (S.captionObj) S.captionObj.bringToFront();
  }

  /** Top/Bottom: centred horizontally with its bounding box `CAPTION_INSET_RATIO` of the short side from the edge. */
  function anchorCaption(obj, pos) {
    const inset = Math.min(S.size.w, S.size.h) * CAPTION_INSET_RATIO;
    obj.set({ left: S.size.w / 2 });
    obj.setCoords();
    const box = obj.getBoundingRect(true, true);
    const wantTop = pos === 'top' ? inset : S.size.h - inset - box.height;
    obj.set({ top: obj.top + wantTop - box.top });
  }

  /** Shifts the caption back inside the photo after its text grew; if it is now wider/taller than the photo, centres it on that axis. */
  function nudgeInside(obj) {
    obj.setCoords();
    const box = obj.getBoundingRect(true, true);
    const shift = (start, size, limit) => (size > limit ? (limit - size) / 2 - start : Math.max(0, -start) - Math.max(0, start + size - limit));
    obj.set({ left: obj.left + shift(box.left, box.width, S.size.w), top: obj.top + shift(box.top, box.height, S.size.h) });
  }

  /**
   * Syncs the caption object with S.caption + S.captionPos. A text change re-renders the pill in place:
   * a moved caption keeps its centre, scale and angle (nudged only if it would run off the photo);
   * a Top/Bottom caption is re-anchored to its edge.
   */
  function refreshCaption() {
    S.captionFrame = 0;
    if (!ready()) return;
    const text = S.caption.trim();
    if (!text && !S.captionObj) {
      updateCaptionPosUi();
      return;
    }
    const obj = S.captionObj || createCaptionObject();
    const rerendered = Boolean(text) && text !== obj.captionText;
    const textChanged = rerendered && Boolean(obj.captionText);
    if (rerendered) {
      obj.setElement(Img().renderCaption(text, S.original.width, S.original.height));
      obj.captionText = text;
      decorate(obj);
    }
    const visible = Boolean(text) && S.captionPos !== 'hide';
    obj.set({ visible, evented: visible, selectable: visible });
    if (!visible && S.canvas.getActiveObject() === obj) S.canvas.discardActiveObject();
    if (visible && S.captionPos !== 'custom') anchorCaption(obj, S.captionPos);
    else if (textChanged && S.captionPos === 'custom') nudgeInside(obj);
    obj.setCoords();
    keepCaptionOnTop();
    S.canvas.requestRenderAll();
    markDirty();
    updateCaptionPosUi();
    updateToolbar();
  }

  function scheduleCaption() {
    if (!S.captionFrame) S.captionFrame = requestAnimationFrame(refreshCaption);
  }

  /** Once the festive font arrives, redraw the pill (it may have been drawn with the fallback font). */
  function rerenderCaption() {
    if (S.captionObj) S.captionObj.captionText = null;
    scheduleCaption();
  }

  function setCaptionPos(pos) {
    if (!ready()) return;
    S.captionPos = pos;
    refreshCaption();
    pushHistory();
  }

  function updateCaptionPosUi() {
    document.querySelectorAll('[data-cappos]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cappos === S.captionPos)));
  }

  /** A drag, handle resize or pinch on the caption makes its position the user's own ('custom'). */
  function onObjectChanged(target) {
    if (isCaption(target) && S.captionPos !== 'custom') {
      S.captionPos = 'custom';
      updateCaptionPosUi();
    }
    pushHistory();
  }

  function setCaption(text) {
    S.caption = text;
    const input = byId('ed-caption-input');
    if (input.value !== text) input.value = text;
    refreshCaption();
  }

  function onCaptionInput(e) {
    S.caption = e.target.value;
    scheduleCaption();
    clearTimeout(S.captionTimer);
    S.captionTimer = setTimeout(pushHistory, CAPTION_HISTORY_DELAY_MS);
  }

  function renderChips() {
    const waiting = Boolean(S.captionRequest);
    const list = S.aiCaptions || S.presets;
    byId('caption-chips').innerHTML = `
      <button type="button" class="btn chip chip-suggest${waiting ? ' is-waiting' : ''}" data-suggest>${waiting ? '✨ Thinking…' : '✨ Suggest captions'}</button>
      ${list.map((c) => `<button type="button" class="btn chip${S.aiCaptions ? ' chip-ai' : ''}${waiting ? ' shimmer' : ''}" data-caption="${esc(c)}">${esc(c)}</button>`).join('')}`;
  }

  function propNames() {
    return [...new Set(S.canvas.getObjects().map((o) => o.propName).filter(Boolean))];
  }

  async function suggestCaptions() {
    if (!ready() || S.captionRequest) return;
    S.captionRequest = { id: null, timer: 0 };
    renderChips();
    try {
      const preview = await toJpegBlob(S.canvas.toCanvasElement(PREVIEW_EDGE / Math.max(S.size.w, S.size.h)), PREVIEW_QUALITY);
      const res = await Party.api('/api/caption', {
        method: 'POST',
        raw: preview,
        headers: {
          'x-guest-id': G().id,
          'x-frame': encodeURIComponent(S.frame ? S.frame.name : ''),
          'x-props': encodeURIComponent(propNames().join(',')),
        },
      });
      if (res.presets && res.presets.length) S.presets = res.presets;
      S.aiCaptions = null;
      S.captionRequest = { id: res.requestId, timer: setTimeout(() => finishCaptions(null), CAPTION_WAIT_MS) };
      const early = S.earlyCaptions.get(res.requestId);
      if (early) finishCaptions(early);
      else renderChips();
    } catch (err) {
      S.captionRequest = null;
      renderChips();
      Party.toast(err.message, { error: true });
    }
  }

  /** `fx captions` can beat the POST response over SSE, so unmatched ones are parked briefly. */
  function onFx(fx) {
    if (fx.type !== 'captions') return;
    if (S.captionRequest && S.captionRequest.id === fx.requestId) finishCaptions(fx);
    else S.earlyCaptions.set(fx.requestId, fx);
  }

  function finishCaptions(fx) {
    if (S.captionRequest) clearTimeout(S.captionRequest.timer);
    S.captionRequest = null;
    S.earlyCaptions.clear();
    if (fx && fx.captions.length) {
      S.aiCaptions = fx.captions;
      Party.toast('✨ Fresh captions for your photo!');
    }
    renderChips();
  }

  // ------------------------------------------------------------ export, save, share

  function toJpegBlob(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('JPEG export failed'))), 'image/jpeg', quality);
    });
  }

  /** Flattened full-resolution JPEG (long edge = the decoded photo's, ≤ 2400). Cached until the next edit. */
  async function getExport() {
    if (S.exported && S.exported.version === S.version) return S.exported;
    const multiplier = S.original.width / S.size.w;
    const blob = await toJpegBlob(S.canvas.toCanvasElement(multiplier), EXPORT_QUALITY);
    if (S.exported) URL.revokeObjectURL(S.exported.url);
    S.exported = { version: S.version, blob, url: URL.createObjectURL(blob) };
    return S.exported;
  }

  async function save() {
    if (!ready()) return;
    setBusy(true, 'Making your photo…');
    try {
      const out = await getExport();
      byId('ed-result-img').src = out.url;
      const link = byId('ed-download');
      link.href = out.url;
      link.download = `diwali-photo-${Date.now()}.jpg`;
      setView('saved');
    } catch (err) {
      console.error('[editor] save failed', err);
      Party.toast('Could not make the photo. Please try again.', { error: true });
    } finally {
      setBusy(false);
    }
  }

  function setShareButtons(label, disabled) {
    document.querySelectorAll('[data-ed="share"]').forEach((b) => {
      b.disabled = disabled;
      b.textContent = label;
    });
  }

  async function share() {
    if (!ready() || S.sharing) return;
    S.sharing = true;
    setShareButtons('📡 Sending…', true);
    try {
      const out = await getExport();
      const res = await Party.api('/api/photos', {
        method: 'POST',
        raw: out.blob,
        headers: { 'x-guest-id': G().id, 'x-caption': encodeURIComponent(S.caption.trim()) },
      });
      const live = res.status === 'live';
      byId('shared-title').textContent = live ? "🎉 It's on the TV!" : '⏳ Waiting for the host to approve';
      byId('shared-sub').textContent = live ? 'Look up at the big screen!' : 'It will pop up on the TV as soon as the host says yes.';
      byId('ed-shared-img').src = out.url;
      setView('shared');
      if (live) G().burst();
    } catch (err) {
      Party.toast(err.message, { error: true });
    } finally {
      S.sharing = false;
      setShareButtons('📺 Share on TV', false);
    }
  }

  // ------------------------------------------------------------ wiring

  function switchTab(name) {
    document.querySelectorAll('.ed-tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === name));
    document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== name; });
    if (name === 'caption') renderChips();
  }

  const ACTIONS = {
    camera: () => byId('ed-camera-input').click(),
    gallery: () => byId('ed-gallery-input').click(),
    resume: () => setView('main'),
    home: () => G().go('home'),
    new: () => setView('start'),
    undo,
    remove: removeSelected,
    clear: clearAll,
    save,
    share,
    'close-result': () => setView('main'),
    another: () => setView('start'),
  };

  function onClick(e) {
    const t = e.target;
    const action = t.closest('[data-ed]');
    if (action && ACTIONS[action.dataset.ed]) {
      ACTIONS[action.dataset.ed]();
      return;
    }
    const tab = t.closest('[data-tab]');
    if (tab) return switchTab(tab.dataset.tab);
    const frame = t.closest('[data-frame]');
    if (frame) return setFrame(frame.dataset.frame);
    const prop = t.closest('[data-prop]');
    if (prop) return addProp(prop.dataset.prop);
    const filter = t.closest('[data-filter]');
    if (filter) return setFilter(filter.dataset.filter);
    const scene = t.closest('[data-scene]');
    if (scene) return pickScene(scene.dataset.scene);
    if (t.closest('#bd-toggle')) return toggleBackdrop();
    if (t.closest('[data-suggest]')) return suggestCaptions();
    const pos = t.closest('[data-cappos]');
    if (pos && CAPTION_POSITIONS.includes(pos.dataset.cappos)) return setCaptionPos(pos.dataset.cappos);
    const chip = t.closest('[data-caption]');
    if (chip) {
      setCaption(chip.dataset.caption);
      pushHistory();
    }
    return undefined;
  }

  function init() {
    const screen = document.querySelector('[data-screen="photo"]');
    screen.addEventListener('click', onClick);
    ['ed-camera-input', 'ed-gallery-input'].forEach((id) => {
      byId(id).addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        loadPhoto(file);
      });
    });
    const caption = byId('ed-caption-input');
    caption.addEventListener('input', onCaptionInput);
    caption.addEventListener('keydown', (e) => { if (e.key === 'Enter') caption.blur(); });
    caption.addEventListener('blur', () => setTimeout(refit, 300));
    byId('bd-sensitivity').addEventListener('input', onSensitivity);
    buildFilterTray();
    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (G().route === 'photo') refit(); }, 150);
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  window.PhotoEditor = { open, update, onFx };
})();
