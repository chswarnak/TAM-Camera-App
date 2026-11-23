'use strict';

/**
 * Builds the party highlights video and the full-resolution photo zip:
 *   exports/diwali-night-2026.mp4            1080p30 H.264 + AAC
 *   exports/diwali-night-2026-whatsapp.mp4   under 64 MB (720p)
 *   exports/diwali-photos.zip                every visible photo, in share order
 *
 * Needs ffmpeg (brew install ffmpeg) and Google Chrome (renders the title,
 * lower-third and closing cards with the app's own fonts and artwork).
 * Usage: npm run highlights   (DATA_DIR=… to use another party's data)
 */

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { partyOverridesFromEnv } = require('../lib/party-config');
const { joinNames } = require('../lib/views');
const plan = require('./highlights-plan');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const OUT_DIR = path.join(ROOT, 'exports');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MUSIC_EXT = /\.(mp3|m4a|aac|wav|ogg)$/i;
const TARGET_LUFS = -16;
const PARALLEL = Math.max(2, Math.min(6, os.cpus().length - 2));

function run(cmd, args, { quiet = true } = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.error) throw new Error(`${cmd} could not start: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`${cmd} ${args.slice(0, 6).join(' ')} … failed (${res.status}):\n${(res.stderr || '').slice(-2000)}`);
  if (!quiet) process.stdout.write(res.stdout);
  return res;
}

/** Runs async jobs with at most `limit` at a time. */
async function pool(items, limit, job) {
  const queue = items.map((item, i) => [item, i]);
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) await job(...next);
  };
  await Promise.all(Array.from({ length: limit }, worker));
}

function runAsync(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} failed (${code}):\n${err}`))));
  });
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fileUrl = (p) => `file://${encodeURI(p)}`;

function pageHtml(body, { transparent = false } = {}) {
  const font = (family, file, weight) => `@font-face{font-family:'${family}';src:url('${fileUrl(path.join(ROOT, 'public/fonts', file))}') format('woff2');font-weight:${weight}}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${font('Yatra One', 'yatra-one-400.woff2', 400)}
${font('Playfair Display', 'playfair-display-700.woff2', 700)}
${font('Playfair Display', 'playfair-display-900.woff2', 900)}
${font('Nunito', 'nunito-600.woff2', 600)}
${font('Nunito', 'nunito-800.woff2', 800)}
:root{--burgundy:#6B1E2E;--deep:#3E0F1A;--night:#24070F;--gold:#D4A017;--gold-light:#F3D27A;--cream:#FFF6E5}
*{box-sizing:border-box;margin:0}
html,body{width:1920px;height:1080px;overflow:hidden;background:${transparent ? 'transparent' : 'var(--night)'};color:var(--cream);font-family:'Nunito',sans-serif}
.card{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
  background:radial-gradient(ellipse at 50% 38%,#8a2a3d 0%,var(--burgundy) 32%,var(--deep) 68%,var(--night) 100%)}
.card::before{content:'';position:absolute;inset:36px;border:3px solid var(--gold);border-radius:28px;box-shadow:inset 0 0 0 10px rgba(212,160,23,.18)}
.dots{position:absolute;inset:0;background-image:radial-gradient(rgba(243,210,122,.13) 2px,transparent 2.5px);background-size:44px 44px}
.diyas{display:flex;gap:56px;align-items:flex-end}
.diyas img{width:120px;filter:drop-shadow(0 0 28px rgba(255,190,60,.75))}
.diyas img.big{width:190px}
.serif{font-family:'Playfair Display',serif;font-variant-numeric:lining-nums}
.festive{font-family:'Yatra One',serif;color:var(--gold-light);text-shadow:0 0 30px rgba(243,210,122,.45)}
.spark{color:var(--gold-light)}
</style></head><body>${body}</body></html>`;
}

function titleCard(settings) {
  const diya = fileUrl(path.join(ROOT, 'public/props/diya.png'));
  return pageHtml(`<div class="card"><div class="dots"></div>
  <div class="diyas" style="position:relative;margin-bottom:46px"><img src="${diya}"><img class="big" src="${diya}"><img src="${diya}"></div>
  <h1 class="serif" style="position:relative;font-size:150px;font-weight:900;color:var(--gold-light);letter-spacing:1px;text-shadow:0 6px 40px rgba(0,0,0,.45)">${esc(settings.partyName)}</h1>
  <div style="width:520px;height:3px;margin:34px 0;background:linear-gradient(90deg,transparent,var(--gold),transparent)"></div>
  <p class="festive" style="position:relative;font-size:64px">${esc(joinNames(settings.hosts))}</p></div>`);
}

function thanksCard(settings) {
  const diya = fileUrl(path.join(ROOT, 'public/props/diya.png'));
  return pageHtml(`<div class="card"><div class="dots"></div>
  <p class="festive" style="font-size:118px;position:relative">Thank you for coming! ✨</p>
  <p class="serif" style="position:relative;font-size:48px;margin-top:40px;color:var(--cream);opacity:.9">${esc(settings.partyName)} · with love, ${esc(joinNames(settings.hosts))}</p>
  <div class="diyas" style="position:relative;margin-top:60px"><img src="${diya}"><img src="${diya}"><img src="${diya}"><img src="${diya}"></div></div>`);
}

function boardCard(teams) {
  const medals = ['🥇', '🥈', '🥉'];
  // Equal scores share a rank; when every team is level there is no podium to show.
  const allLevel = teams.every((t) => t.score === teams[0].score);
  const rows = teams.map((t) => {
    const rank = teams.filter((x) => x.score > t.score).length;
    const badge = allLevel ? '🪔' : medals[rank] || `<span class="serif" style="color:var(--gold-light)">${rank + 1}</span>`;
    return `<div style="display:grid;grid-template-columns:90px 1fr auto;align-items:center;gap:28px;padding:12px 40px;border-radius:24px;
      background:rgba(36,7,15,.55);border:3px solid ${t.color};box-shadow:0 0 30px ${t.color}55">
      <span style="font-size:58px">${badge}</span>
      <span style="text-align:left"><span class="serif" style="font-size:50px;font-weight:900;color:${t.color}">Team ${esc(t.name)}</span>
        <span style="display:block;font-size:28px;font-weight:600;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:1000px">${esc(t.members.join(' · ') || 'No members')}</span></span>
      <span class="serif" style="font-size:64px;font-weight:900;color:var(--gold-light)">${t.score}<span style="font-size:32px;font-family:Nunito;font-weight:800;opacity:.8"> pts</span></span></div>`;
  }).join('');
  return pageHtml(`<div class="card" style="justify-content:flex-start;padding-top:90px"><div class="dots"></div>
  <p class="festive" style="position:relative;font-size:84px;margin-bottom:${allLevel ? 6 : 36}px">🏆 Final Leaderboard</p>
  ${allLevel ? '<p class="serif" style="position:relative;font-size:40px;margin-bottom:36px;opacity:.9">All square: every team shares the glory!</p>' : ''}
  <div style="position:relative;display:grid;gap:20px;width:1500px">${rows}</div></div>`);
}

function bestCard(best, photoPath) {
  const p = best.photo;
  const hearts = p.hearts.length;
  return pageHtml(`<div class="card" style="flex-direction:row;gap:90px"><div class="dots"></div>
  <img src="${fileUrl(photoPath)}" style="position:relative;max-width:900px;max-height:860px;border:8px solid var(--gold);border-radius:18px;box-shadow:0 0 60px rgba(243,210,122,.5)">
  <div style="position:relative;text-align:left;max-width:700px">
    <p class="festive" style="font-size:92px;line-height:1.1;white-space:nowrap">📸 Best Photo</p>
    <p class="serif" style="font-size:84px;font-weight:900;margin-top:30px">${esc(p.nickname)}</p>
    <p style="font-size:44px;font-weight:600;margin-top:22px;opacity:.92">“${esc(p.caption)}”</p>
    <p style="font-size:44px;font-weight:800;margin-top:30px;color:var(--gold-light)">${hearts} ❤️ ${hearts === 1 ? 'heart' : 'hearts'}${best.awarded ? '' : ' · the most loved photo of the night'}</p>
  </div></div>`);
}

/** Transparent overlay: caption and name in a pill centred in the strip below the photo. */
function lowerThird(photo) {
  const top = plan.PHOTO_AREA_H;
  return pageHtml(`<div style="position:absolute;left:0;right:0;top:${top}px;bottom:0;display:flex;align-items:center;justify-content:center">
  <div style="display:flex;align-items:baseline;gap:22px;max-width:1700px;padding:16px 40px;border-radius:999px;background:rgba(36,7,15,.78);border:2px solid var(--gold);box-shadow:0 4px 24px rgba(0,0,0,.4)">
    <span style="font-size:38px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(photo.caption)}</span>
    <span class="festive" style="font-size:34px;white-space:nowrap;text-shadow:none">— ${esc(photo.nickname)}</span>
  </div></div>`, { transparent: true });
}

async function renderPng(html, htmlPath, pngPath) {
  fs.writeFileSync(htmlPath, html);
  await runAsync(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
    '--default-background-color=00000000', '--force-device-scale-factor=1', '--window-size=1920,1080',
    `--user-data-dir=${path.join(path.dirname(htmlPath), `chrome-${path.basename(htmlPath)}`)}`,
    '--virtual-time-budget=3000', `--screenshot=${pngPath}`, fileUrl(htmlPath),
  ]);
}

function imageSize(file) {
  const out = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:stream_side_data=rotation', '-of', 'json', file]).stdout;
  const s = JSON.parse(out).streams[0];
  const rotation = Math.abs(Number(s.side_data_list?.find((d) => 'rotation' in d)?.rotation || 0));
  // ffmpeg auto-rotates from EXIF, so a 90/270 orientation swaps the displayed size.
  return rotation % 180 === 90 ? { w: s.height, h: s.width } : { w: s.width, h: s.height };
}

// JPEGs decode as full-range YUV; convert to standard video (tv) range so players and
// WhatsApp show true colours and photos match the cards. TV_RANGE ends every graph.
const TV_RANGE = 'scale=out_range=tv,format=yuv420p';
const ENC = ['-color_range', 'tv', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', '-r', String(plan.FPS)];

/** One photo clip: blurred fill + fitted photo, slow Ken Burns, lower-third on top. Composed at 2x so the zoom is smooth. */
function photoClipArgs(src, overlay, seg, out) {
  const { w, h } = imageSize(src);
  const S = 2;
  const box = plan.photoBox(w, h, S);
  const last = seg.frames - 1;
  const graph = [
    '[0:v]split=2[a][b]',
    '[a]scale=480:270:force_original_aspect_ratio=increase,crop=480:270,boxblur=14:3,eq=brightness=-0.16:saturation=1.15,'
      + `scale=${plan.W * S}:${plan.H * S},setsar=1[bg]`,
    `[b]scale=${box.w}:${box.h}:flags=lanczos,setsar=1[fg]`,
    `[bg][fg]overlay=${box.x}:${box.y}[comp]`,
    `[comp]zoompan=z='1+${plan.KB_ZOOM}*on/${last}':x='iw/2-iw/zoom/2':y='${box.cy}-${box.cy}/zoom':d=${seg.frames}:s=${plan.W}x${plan.H}:fps=${plan.FPS}[kb]`,
    `[kb][1:v]overlay=0:0,${TV_RANGE}[v]`,
  ].join(';');
  return ['-y', '-v', 'error', '-i', src, '-i', overlay, '-filter_complex', graph, '-map', '[v]', '-frames:v', String(seg.frames), ...ENC, out];
}

function cardClipArgs(png, seg, out) {
  return ['-y', '-v', 'error', '-loop', '1', '-framerate', String(plan.FPS), '-i', png, '-frames:v', String(seg.frames), '-vf', TV_RANGE, ...ENC, out];
}

function pickMusic() {
  const dir = path.join(DATA_DIR, 'music');
  const file = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => MUSIC_EXT.test(f) && !f.startsWith('.')).sort()[0] : null;
  return file ? path.join(dir, file) : null;
}

/**
 * Music bed: the party MP3 looped and trimmed to the video, or a gentle
 * synthesized festive loop (tanpura-like drone + soft pentatonic bells), then
 * faded and loudness-normalised to TARGET_LUFS (two-pass loudnorm).
 */
function buildAudio(duration, out, work) {
  const music = pickMusic();
  const raw = path.join(work, 'music-raw.wav');
  if (music) {
    run('ffmpeg', ['-y', '-v', 'error', '-stream_loop', '-1', '-i', music, '-t', String(duration), '-ar', '48000', '-ac', '2', raw]);
  } else {
    const bells = [0, 2, 4, 7, 9, 12, 9, 7].map((st, i) => `0.18*sin(2*PI*${(261.63 * 2 ** (st / 12)).toFixed(2)}*t)*exp(-3*mod(t-${i * 0.5},4))*gte(mod(t,4),${i * 0.5})`).join('+');
    const drone = '0.22*sin(2*PI*130.81*t)+0.12*sin(2*PI*196*t)+0.08*sin(2*PI*261.63*t)';
    run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `aevalsrc='(${drone})*(0.8+0.2*sin(2*PI*0.25*t))+${bells}':s=48000:d=${duration}`,
      '-af', 'aecho=0.8:0.7:120|240:0.35|0.2,lowpass=f=5000', '-ac', '2', raw]);
  }
  const fades = `afade=t=in:d=1.5,afade=t=out:st=${Math.max(0, duration - 3)}:d=3`;
  const measure = run('ffmpeg', ['-hide_banner', '-i', raw, '-af', `${fades},loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11:print_format=json`, '-f', 'null', '-']).stderr;
  const m = JSON.parse(measure.slice(measure.lastIndexOf('{'), measure.lastIndexOf('}') + 1));
  const norm = `loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  run('ffmpeg', ['-y', '-v', 'error', '-i', raw, '-af', `${fades},${norm}`, '-ar', '48000', '-c:a', 'pcm_s16le', out]);
  return music ? path.basename(music) : 'synthesized festive loop';
}

/** Integrated loudness (LUFS) of a file's audio, measured with ebur128. */
function loudness(file) {
  const err = run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-filter_complex', 'ebur128', '-f', 'null', '-']).stderr;
  const all = [...err.matchAll(/I:\s+(-?[\d.]+) LUFS/g)];
  return Number(all.at(-1)[1]);
}

function duration(file) {
  return Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).stdout.trim());
}

function zipPhotos(photos, zipPath, work) {
  const dir = path.join(work, 'diwali-photos');
  fs.mkdirSync(dir, { recursive: true });
  const width = String(photos.length).length;
  photos.forEach((p, i) => {
    const safe = p.nickname.replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/\s+/g, '-') || 'guest';
    fs.copyFileSync(path.join(DATA_DIR, 'photos', p.file), path.join(dir, `${String(i + 1).padStart(width, '0')}-${safe}.jpg`));
  });
  fs.rmSync(zipPath, { force: true });
  // -0: JPEGs don't compress further; storing keeps the zip fast to make and open.
  spawnSync('zip', ['-q', '-0', '-r', zipPath, 'diwali-photos'], { cwd: work, stdio: 'inherit' });
  if (!fs.existsSync(zipPath)) throw new Error('zip failed');
}

const mb = (file) => `${(fs.statSync(file).size / 1048576).toFixed(1)} MB`;
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

async function main() {
  for (const tool of ['ffmpeg', 'ffprobe']) if (spawnSync(tool, ['-version']).status !== 0) throw new Error(`${tool} not found. Install it with: brew install ffmpeg`);
  if (!fs.existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}. Set CHROME_PATH.`);

  const state = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'state.json'), 'utf8'));
  const photos = plan.orderedPhotos(state);
  if (!photos.length) throw new Error('No visible photos to make a video from.');
  for (const p of photos) if (!fs.existsSync(path.join(DATA_DIR, 'photos', p.file))) throw new Error(`Missing photo file ${p.file}`);
  const best = plan.bestPhoto(state);
  const { segments, duration: total } = plan.timeline(photos.length);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'diwali-highlights-'));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`${photos.length} photos, ${clock(total)} planned. Working in ${work}`);

  if (fs.existsSync(path.join(ROOT, '.env'))) require('dotenv').config({ path: path.join(ROOT, '.env') });
  const settings = { ...state.settings, ...partyOverridesFromEnv(process.env) };
  const cardHtml = {
    title: titleCard(settings),
    thanks: thanksCard(settings),
    board: boardCard(plan.standings(state)),
    best: bestCard(best, path.join(DATA_DIR, 'photos', best.photo.file)),
  };
  const pngs = {};
  await pool([...Object.keys(cardHtml), ...photos.map((_, i) => `lt${i}`)], PARALLEL, async (key) => {
    const html = key.startsWith('lt') ? lowerThird(photos[Number(key.slice(2))]) : cardHtml[key];
    pngs[key] = path.join(work, `${key}.png`);
    await renderPng(html, path.join(work, `${key}.html`), pngs[key]);
  });
  console.log('Cards and lower-thirds rendered.');

  const clips = segments.map((_, i) => path.join(work, `clip${String(i).padStart(3, '0')}.mp4`));
  await pool(segments, PARALLEL, async (seg, i) => {
    const args = seg.kind === 'photo'
      ? photoClipArgs(path.join(DATA_DIR, 'photos', photos[seg.index].file), pngs[`lt${seg.index}`], seg, clips[i])
      : cardClipArgs(pngs[seg.kind], seg, clips[i]);
    await runAsync('ffmpeg', args);
  });
  console.log(`${clips.length} clips made.`);

  const audio = path.join(work, 'music.wav');
  const musicSource = buildAudio(total, audio, work);

  // Crossfade chain, fade in from / out to black, then the final 1080p encode with music.
  const xf = [];
  let prev = '[0:v]';
  segments.slice(1).forEach((seg, k) => {
    const label = `[x${k}]`;
    xf.push(`${prev}[${k + 1}:v]xfade=transition=fade:duration=${plan.FADE}:offset=${seg.offset}${label}`);
    prev = label;
  });
  xf.push(`${prev}fade=t=in:d=0.6,fade=t=out:st=${total - 1}:d=1,${TV_RANGE}[v]`);
  const graphFile = path.join(work, 'xfade.txt');
  fs.writeFileSync(graphFile, xf.join(';\n'));
  const main1080 = path.join(OUT_DIR, 'diwali-night-2026.mp4');
  run('ffmpeg', ['-y', '-v', 'error', ...clips.flatMap((c) => ['-i', c]), '-i', audio,
    '-/filter_complex', graphFile, '-map', '[v]', '-map', `${clips.length}:a`,
    '-color_range', 'tv', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(plan.FPS),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', String(total), '-movflags', '+faststart', main1080]);
  console.log('1080p video encoded.');

  // WhatsApp copy: 720p, two-pass to a bitrate that lands well under 64 MB.
  const wa = path.join(OUT_DIR, 'diwali-night-2026-whatsapp.mp4');
  const kbps = plan.whatsappVideoKbps(total);
  const passLog = path.join(work, 'x264pass');
  const waVideo = ['-vf', 'scale=1280:720:flags=lanczos', '-color_range', 'tv', '-c:v', 'libx264', '-preset', 'slow', '-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.5)}k`,
    '-bufsize', `${kbps * 2}k`, '-profile:v', 'high', '-level', '3.1', '-pix_fmt', 'yuv420p', '-passlogfile', passLog];
  run('ffmpeg', ['-y', '-v', 'error', '-i', main1080, ...waVideo, '-pass', '1', '-an', '-f', 'mp4', '/dev/null']);
  run('ffmpeg', ['-y', '-v', 'error', '-i', main1080, ...waVideo, '-pass', '2', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', wa]);
  if (fs.statSync(wa).size >= plan.WHATSAPP_MAX_BYTES) throw new Error(`WhatsApp copy is ${mb(wa)}, over 64 MB`);

  const zip = path.join(OUT_DIR, 'diwali-photos.zip');
  zipPhotos(photos, zip, work);

  console.log('\nDone');
  console.log(`  Music: ${musicSource}`);
  console.log(`  Best Photo: ${best.photo.nickname} (${best.photo.hearts.length} hearts${best.awarded ? ', awarded by the host' : ', most hearts; not awarded during the party'})`);
  console.log(`  ${path.relative(ROOT, main1080)}  ${clock(duration(main1080))} (${duration(main1080).toFixed(1)} s)  ${mb(main1080)}  ${loudness(main1080).toFixed(1)} LUFS`);
  console.log(`  ${path.relative(ROOT, wa)}  ${clock(duration(wa))}  ${mb(wa)}  ${loudness(wa).toFixed(1)} LUFS`);
  console.log(`  ${path.relative(ROOT, zip)}  ${photos.length} photos  ${mb(zip)}`);
  if (process.env.KEEP_WORK) console.log(`  Work files kept in ${work}`);
  else fs.rmSync(work, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(`[highlights] ${err.message}`);
  process.exit(1);
});
