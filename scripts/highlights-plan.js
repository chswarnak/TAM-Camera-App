'use strict';

/**
 * Pure planning for the highlights video (no ffmpeg, no files), so the
 * timeline, layout and bitrate maths can be unit tested.
 *
 * Layout (1080p frame): every photo is fitted, never cropped or stretched, into
 * a box in the upper part of the frame over a blurred, darkened copy of itself.
 * The lower-third (caption + name) sits in the strip below that box, so it
 * never covers a face or a caption the guest already baked into the photo.
 * The slow Ken Burns zoom grows the photo by KB_ZOOM around the box centre, and
 * the box is the photo area shrunk by that much, so the photo never leaves it.
 */

const W = 1920;
const H = 1080;
const FPS = 30;
const FADE = 0.5;
const PHOTO_SECONDS = 3;
const TITLE_SECONDS = 4;
const THANKS_SECONDS = 3.5;
const BOARD_SECONDS = 5;
const BEST_SECONDS = 5;
const KB_ZOOM = 0.05;
/** Photo area: everything above the lower-third strip. */
const PHOTO_AREA_H = 930;
const WHATSAPP_MAX_BYTES = 64 * 1024 * 1024;

/** Live photos in the order they were shared; hidden (moderated) ones are left out. */
function orderedPhotos(state) {
  return state.photos
    .filter((p) => p.status === 'live')
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((p) => ({ ...p, nickname: state.guests[p.guestId]?.nickname || 'A guest' }));
}

/** Largest even size that fits w×h inside boxW×boxH without changing the aspect ratio. */
function fit(w, h, boxW, boxH) {
  const s = Math.min(boxW / w, boxH / h);
  const even = (n) => Math.max(2, Math.floor(n / 2) * 2);
  return { w: even(w * s), h: even(h * s) };
}

/** Photo placement at zoom 1 in a frame `scale` times 1080p (the clips are composed at 2x for a smooth zoom). */
function photoBox(w, h, scale = 1) {
  const boxW = Math.floor(W / (1 + KB_ZOOM)) * scale;
  const boxH = Math.floor(PHOTO_AREA_H / (1 + KB_ZOOM)) * scale;
  const size = fit(w, h, boxW, boxH);
  const cy = (PHOTO_AREA_H / 2) * scale;
  return { ...size, x: Math.round((W * scale - size.w) / 2), y: Math.round(cy - size.h / 2), cy };
}

/**
 * Segments in play order with their clip length (visible time + the crossfade
 * that overlaps the next one) and the xfade offset where each one starts.
 */
function timeline(photoCount) {
  const segs = [
    { kind: 'title', seconds: TITLE_SECONDS },
    ...Array.from({ length: photoCount }, (_, i) => ({ kind: 'photo', index: i, seconds: PHOTO_SECONDS })),
    { kind: 'thanks', seconds: THANKS_SECONDS },
    { kind: 'board', seconds: BOARD_SECONDS },
    { kind: 'best', seconds: BEST_SECONDS },
  ];
  let start = 0;
  return {
    segments: segs.map((s, i) => {
      const last = i === segs.length - 1;
      const clip = s.seconds + (last ? 0 : FADE);
      const seg = { ...s, clip, frames: Math.round(clip * FPS), offset: start };
      start += s.seconds;
      return seg;
    }),
    duration: start,
  };
}

/** Team standings for the closing card, highest first; ties keep team order. */
function standings(state) {
  const totals = Object.fromEntries(state.teams.map((t) => [t.id, 0]));
  for (const e of state.ledger) if (e.teamId in totals) totals[e.teamId] += e.points;
  return state.teams
    .map((t, order) => ({
      name: t.name, color: t.color, score: totals[t.id], order,
      members: Object.values(state.guests).filter((g) => g.teamId === t.id).map((g) => g.nickname),
    }))
    .sort((a, b) => b.score - a.score || a.order - b.order);
}

/**
 * Best Photo: the photo the host awarded (trophy or ledger), otherwise the app's
 * own rule (most hearts among live photos, earliest wins a tie).
 */
function bestPhoto(state) {
  const live = orderedPhotos(state);
  if (!live.length) return null;
  const awardedId = state.trophy?.kind === 'bestPhoto' ? state.trophy.photoId : null;
  const awarded = live.find((p) => p.id === awardedId);
  if (awarded) return { photo: awarded, awarded: true };
  const top = live.reduce((a, b) => (b.hearts.length > a.hearts.length ? b : a));
  return { photo: top, awarded: false };
}

/** Video bitrate (kbit/s) that lands the file at ~85 % of the WhatsApp cap. */
function whatsappVideoKbps(durationSeconds, audioKbps = 96) {
  const budgetKbit = (WHATSAPP_MAX_BYTES * 0.85 * 8) / 1000;
  return Math.floor(budgetKbit / durationSeconds - audioKbps);
}

module.exports = {
  W, H, FPS, FADE, KB_ZOOM, PHOTO_AREA_H, WHATSAPP_MAX_BYTES,
  orderedPhotos, fit, photoBox, timeline, standings, bestPhoto, whatsappVideoKbps,
};
