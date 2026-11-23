/* Pure canvas helpers for the photo editor: decoding, filters, white-wall backdrop keying,
 * 9-slice frame composition and the caption pill. No Fabric and no DOM state in here. */
(function () {
  'use strict';

  const MAX_EDGE = 2400;
  const MASK_EDGE = 900;
  const WARM_TINT = 'rgba(255,150,50,0.18)';
  const CHUNK_PIXELS = 50000;
  const FRAME_CORNER_RATIO = 0.25;
  const CAPTION_FONT = '"Yatra One", "Playfair Display", Georgia, serif';
  const CAPTION_MARGIN_RATIO = 0.6;

  class DecodeError extends Error {}

  function createCanvas(width, height) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(width));
    c.height = Math.max(1, Math.round(height));
    return c;
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new DecodeError(`Could not load image ${url}`));
      img.src = url;
    });
  }

  async function decodeSource(file) {
    if (typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch (err) {
        console.warn('[editor] createImageBitmap failed, falling back to <img>', err);
      }
    }
    const url = URL.createObjectURL(file);
    try {
      return await loadImage(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** File → canvas with EXIF orientation applied and the long edge capped at MAX_EDGE. */
  async function decodeFile(file) {
    const source = await decodeSource(file);
    const w = source.naturalWidth || source.width;
    const h = source.naturalHeight || source.height;
    if (!w || !h) throw new DecodeError('Image has no size');
    const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
    const canvas = createCanvas(w * scale, h * scale);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    if (typeof source.close === 'function') source.close();
    return canvas;
  }

  function scaledCopy(source, maxEdge) {
    const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
    const out = createCanvas(source.width * scale, source.height * scale);
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, out.width, out.height);
    return out;
  }

  /** Background-only filters: warm = multiply an orange layer, bw = luminance grayscale. */
  function applyFilter(source, filter) {
    const out = createCanvas(source.width, source.height);
    const ctx = out.getContext('2d');
    ctx.drawImage(source, 0, 0);
    if (filter === 'warm') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = WARM_TINT;
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.globalCompositeOperation = 'source-over';
    } else if (filter === 'bw') {
      const data = ctx.getImageData(0, 0, out.width, out.height);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        const y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        px[i] = y;
        px[i + 1] = y;
        px[i + 2] = y;
      }
      ctx.putImageData(data, 0, 0);
    }
    return out;
  }

  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

  /**
   * Builds an alpha mask that hides near-white, low-saturation pixels (the white wall).
   * Runs on a downscaled copy in chunks so the UI keeps responding; `job.cancelled` aborts.
   * sensitivity 0..1: higher removes more (darker / slightly tinted whites too).
   */
  async function computeMask(source, sensitivity, job) {
    const small = scaledCopy(source, MASK_EDGE);
    const data = small.getContext('2d').getImageData(0, 0, small.width, small.height);
    const px = data.data;
    const lumStart = 245 - sensitivity * 95;
    const lumFull = lumStart + 22;
    const satMax = 0.08 + sensitivity * 0.22;
    for (let start = 0; start < px.length; start += CHUNK_PIXELS * 4) {
      if (job.cancelled) return null;
      const end = Math.min(px.length, start + CHUNK_PIXELS * 4);
      for (let i = start; i < end; i += 4) {
        const r = px[i];
        const g = px[i + 1];
        const b = px[i + 2];
        const max = Math.max(r, g, b);
        const sat = max ? (max - Math.min(r, g, b)) / max : 0;
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const white = Math.min(1, Math.max(0, (lum - lumStart) / (lumFull - lumStart)));
        const neutral = Math.min(1, Math.max(0, (satMax - sat) / (satMax * 0.5)));
        px[i + 3] = Math.round(255 * (1 - white * neutral));
      }
      await nextFrame();
    }
    if (job.cancelled) return null;
    small.getContext('2d').putImageData(data, 0, 0);
    return small;
  }

  /** Draws `img` to cover a w×h box (like CSS object-fit: cover). */
  function drawCover(ctx, img, w, h) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const scale = Math.max(w / iw, h / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  /** Scene (cover-fit) + the photo with the white wall made transparent by `mask` (soft edges from upscaling). */
  function compositeBackdrop(original, mask, scene) {
    const { width: w, height: h } = original;
    const cut = createCanvas(w, h);
    const cctx = cut.getContext('2d');
    cctx.drawImage(original, 0, 0);
    cctx.globalCompositeOperation = 'destination-in';
    cctx.imageSmoothingQuality = 'high';
    cctx.drawImage(mask, 0, 0, w, h);
    const out = createCanvas(w, h);
    const ctx = out.getContext('2d');
    drawCover(ctx, scene, w, h);
    ctx.drawImage(cut, 0, 0);
    return out;
  }

  /**
   * 9-slice frame: source corners are the outer 25% squares of the PNG, edges are stretched along
   * their length, the centre is skipped. Corners on the target are 25% of its shorter side, so
   * the artwork stays undistorted on portrait and landscape photos.
   */
  function drawFrame(ctx, frame, w, h) {
    const sw = frame.naturalWidth || frame.width;
    const sh = frame.naturalHeight || frame.height;
    const sx = sw * FRAME_CORNER_RATIO;
    const sy = sh * FRAME_CORNER_RATIO;
    const c = Math.round(Math.min(w, h) * FRAME_CORNER_RATIO);
    const midSW = sw - 2 * sx;
    const midSH = sh - 2 * sy;
    const midW = w - 2 * c;
    const midH = h - 2 * c;
    ctx.drawImage(frame, 0, 0, sx, sy, 0, 0, c, c);
    ctx.drawImage(frame, sw - sx, 0, sx, sy, w - c, 0, c, c);
    ctx.drawImage(frame, 0, sh - sy, sx, sy, 0, h - c, c, c);
    ctx.drawImage(frame, sw - sx, sh - sy, sx, sy, w - c, h - c, c, c);
    if (midW > 0) {
      ctx.drawImage(frame, sx, 0, midSW, sy, c, 0, midW, c);
      ctx.drawImage(frame, sx, sh - sy, midSW, sy, c, h - c, midW, c);
    }
    if (midH > 0) {
      ctx.drawImage(frame, 0, sy, sx, midSH, 0, c, c, midH);
      ctx.drawImage(frame, sw - sx, sy, sx, midSH, w - c, c, c, midH);
    }
  }

  function wrapWords(ctx, text, maxWidth) {
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(test).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  /** Largest font size (down to a floor) at which the caption fits in at most two lines. */
  function layoutCaption(ctx, text, maxWidth, startSize, minSize) {
    const step = Math.max(1, Math.round(startSize * 0.06));
    for (let size = startSize; size >= minSize; size -= step) {
      ctx.font = `${size}px ${CAPTION_FONT}`;
      const lines = wrapWords(ctx, text, maxWidth);
      if (lines.length <= 2 && lines.every((l) => ctx.measureText(l).width <= maxWidth)) return { size, lines };
    }
    ctx.font = `${minSize}px ${CAPTION_FONT}`;
    return { size: minSize, lines: wrapWords(ctx, text, maxWidth).slice(0, 2) };
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /**
   * Caption pill as its own canvas (dark burgundy glass, gold border, gold festive type), sized for a
   * w×h photo so it stays crisp at export resolution. The editor shows it as a movable Fabric object.
   * A margin around the pill leaves room for the soft shadow.
   */
  function renderCaption(text, w, h) {
    const short = Math.min(w, h);
    const measure = createCanvas(1, 1).getContext('2d');
    const { size, lines } = layoutCaption(measure, text, w * 0.8, Math.round(short * 0.075), Math.round(short * 0.04));
    const lineHeight = size * 1.2;
    const padX = size * 0.75;
    const padY = size * 0.4;
    const textWidth = Math.max(...lines.map((l) => measure.measureText(l).width));
    const boxW = Math.ceil(textWidth + padX * 2);
    const boxH = Math.ceil(lines.length * lineHeight + padY * 2);
    const margin = Math.ceil(size * CAPTION_MARGIN_RATIO);
    const out = createCanvas(boxW + margin * 2, boxH + margin * 2);
    const ctx = out.getContext('2d');
    ctx.font = measure.font;
    roundRectPath(ctx, margin, margin, boxW, boxH, Math.min(boxH / 2, size * 0.8));
    ctx.fillStyle = 'rgba(36, 7, 15, 0.78)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = size * 0.4;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(2, size * 0.08);
    ctx.strokeStyle = '#D4A017';
    ctx.stroke();
    ctx.fillStyle = '#F3D27A';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((line, i) => ctx.fillText(line, out.width / 2, margin + padY + lineHeight * (i + 0.5) + size * 0.04));
    return out;
  }

  /** Redraws the frame into `target` (reused between frame swaps). Returns false when empty. */
  function drawOverlay(target, { frame }) {
    const ctx = target.getContext('2d');
    ctx.clearRect(0, 0, target.width, target.height);
    if (frame) drawFrame(ctx, frame, target.width, target.height);
    return Boolean(frame);
  }

  window.EditorImage = {
    MAX_EDGE, DecodeError, createCanvas, loadImage, decodeFile, scaledCopy, applyFilter,
    computeMask, compositeBackdrop, drawOverlay, renderCaption,
  };
})();
