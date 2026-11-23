'use strict';

/**
 * Server-side slideshow cursor. The TV asks for the next photo instead of
 * counting through the list itself, so the sequence survives the TV leaving
 * the slideshow (leaderboard, who's here, a question), a TV reload and a
 * server restart.
 *
 * Order is stride scheduling: every live photo has a "pass" value and the
 * lowest pass is shown next, then its pass grows by 1 / weight. Over an
 * evening each photo is shown about equally often, and the newest few
 * (weight NEWEST_WEIGHT) about twice as often. A photo that just went live
 * jumps the queue once, newest upload first (at most NEWEST_COUNT waiting), then
 * joins the rotation. New photos past that cap still come up early: they enter
 * the rotation with the lowest pass value.
 */

const NEWEST_COUNT = 5;
const NEWEST_WEIGHT = 2;

function emptyCursor() {
  return { currentId: null, pass: {}, shows: {}, last: {}, seq: 0, jumps: [] };
}

/** Drops bookkeeping for photos that are no longer live. */
function prune(cursor, liveIds) {
  cursor.last = cursor.last || {};
  cursor.seq = cursor.seq || 0;
  for (const key of ['pass', 'shows', 'last']) {
    for (const id of Object.keys(cursor[key])) if (!liveIds.has(id)) delete cursor[key][id];
  }
  cursor.jumps = cursor.jumps.filter((id) => liveIds.has(id));
  if (cursor.currentId && !liveIds.has(cursor.currentId)) cursor.currentId = null;
}

function strideFor(photos) {
  const newest = new Set([...photos].sort((a, b) => b.createdAt - a.createdAt).slice(0, NEWEST_COUNT).map((p) => p.id));
  return (id) => 1 / (newest.has(id) ? NEWEST_WEIGHT : 1);
}

/** Queues a newly live photo to be shown next, once; the latest upload goes first. */
function queueJump(cursor, photoId) {
  cursor.jumps = [photoId, ...cursor.jumps.filter((id) => id !== photoId)].slice(0, NEWEST_COUNT);
}

/**
 * Moves the cursor to the next photo and returns its id (null when nothing is live).
 * `from` is the photo the caller is showing: if another TV already advanced past it,
 * the current photo is returned unchanged so two screens never skip photos. With
 * `from` null (a TV that just loaded) the current photo is resumed as is.
 */
function advance(cursor, livePhotos, from) {
  const liveIds = new Set(livePhotos.map((p) => p.id));
  prune(cursor, liveIds);
  if (!livePhotos.length) return null;
  if (cursor.currentId && from !== cursor.currentId) return cursor.currentId;

  const stride = strideFor(livePhotos);
  const passes = livePhotos.map((p) => cursor.pass[p.id]).filter((v) => v !== undefined);
  const base = passes.length ? Math.min(...passes) : 0;
  for (const p of livePhotos) if (cursor.pass[p.id] === undefined) cursor.pass[p.id] = base;

  let next = cursor.jumps.shift() || null;
  if (!next) {
    const pool = livePhotos.length > 1 ? livePhotos.filter((p) => p.id !== cursor.currentId) : livePhotos;
    next = pool.reduce((best, p) => {
      if (!best) return p;
      const d = cursor.pass[p.id] - cursor.pass[best.id];
      if (Math.abs(d) > 1e-9) return d < 0 ? p : best;
      // Ties: the photo shown longest ago (never shown first), then the newer one.
      const lp = cursor.last[p.id] ?? -1;
      const lb = cursor.last[best.id] ?? -1;
      if (lp !== lb) return lp < lb ? p : best;
      return p.createdAt > best.createdAt ? p : best;
    }, null).id;
  }
  cursor.pass[next] = Math.max(cursor.pass[next], base) + stride(next);
  cursor.shows[next] = (cursor.shows[next] || 0) + 1;
  cursor.seq += 1;
  cursor.last[next] = cursor.seq;
  cursor.currentId = next;
  return next;
}

module.exports = { emptyCursor, queueJump, advance, NEWEST_COUNT, NEWEST_WEIGHT };
