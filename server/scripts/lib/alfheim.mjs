// Shared helpers for the Alfheim (Simula) soccer dataset scripts
// (alfheim-fetch / -prep / -telemetry / -events, fb-clip-window).
//
// Dataset facts (verified 2026-09-15):
// - Video comes as 3 s raw Annex-B H.264 segments named
//   `NNNN_YYYY-MM-DD hh:mm:ss.nnnnnnnnn.h264`; the time is the local wall
//   clock (Europe/Oslo, UTC+1 on all match days — DST ended 2013-10-27).
// - ZXY player positions use the same wall clock: rows
//   `"YYYY-MM-DD hh:mm:ss[.ff]",tag,x,y,heading,direction,energy,speed,total_distance`
//   (x 0..105 m along the pitch, y 0..68 m; off-pitch values on the bench).
// - Ball tracks (Tottenham panorama only; 2013-11-07 gets a hand-keyed
//   ball.json from fb-ball-keyframes.mjs): one `<segment>.h264_track.txt`
//   per segment, lines `frameNo x y` in panorama pixels (4450×2000).
//
// Media time of every prepared clip = wall clock − t0Utc (same anchor for
// every camera of a session), which is what the sidecars carry.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

/** Local-time offset of the recordings (Europe/Oslo in November = CET). */
export const OSLO_OFFSET = '+01:00';

export const SESSIONS = {
  pano: {
    id: 'pano-2013-11-28',
    match: '2013-11-28',
    title: '2013-11-28 Tromsø IL – Tottenham Hotspur (UEFA Europa League)',
    home: 'Tromsø',
    away: 'Tottenham',
    session: 'pano',
    fps: 25,
    framesPerSegment: 75,
    pano: { w: 4450, h: 2000 },
    cams: { pano: { dir: '2013-11-28/panorama', role: 'pano' } },
    zxy: '2013-11-28/zxy/2013-11-28_tromso_tottenham.csv',
    ballTracks: '2013-11-28/ball/track',
  },
  // Second half only: the footage's one goal (Anzhi, 90+3', ≈22:53:32 local,
  // right goal). Different stitch than 2013-11-28 (shot from behind the
  // crowd) → its own camera model; no ball track for this match.
  pano1107: {
    id: 'pano-2013-11-07',
    match: '2013-11-07',
    title:
      '2013-11-07 Tromsø IL – Anzhi Makhachkala (UEFA Europa League), second half',
    home: 'Tromsø',
    away: 'Anzhi',
    session: 'pano',
    period: 2,
    fps: 25,
    framesPerSegment: 75,
    pano: { w: 4450, h: 2000 },
    cams: { pano: { dir: '2013-11-07/Second Half/panorama', role: 'pano' } },
    zxy: '2013-11-07/zxy/2013-11-07_tromso_anji_second.csv',
    ballTracks: null,
  },
  tricam: {
    id: 'tricam-2013-11-03',
    match: '2013-11-03',
    title: '2013-11-03 Tromsø IL – Strømsgodset (Tippeligaen), first half',
    home: 'Tromsø',
    away: 'Strømsgodset',
    session: 'tricam',
    fps: 30,
    framesPerSegment: 90,
    pano: null,
    cams: {
      0: { dir: '2013-11-03/First Half/0', role: 'left' },
      1: { dir: '2013-11-03/First Half/1', role: 'centre' },
      2: { dir: '2013-11-03/First Half/2', role: 'right' },
    },
    zxy: '2013-11-03/zxy/2013-11-03_tromso_stromsgodset_first.csv',
    ballTracks: null,
  },
};

/**
 * The SESSIONS entry a prepared clip came from. Two sets share the 'pano'
 * rig tag, so go by the sidecar's `sessionId`, then by the match date
 * (sidecars written before `sessionId` existed), then by the rig.
 */
export function sessionOfSidecar(sidecar) {
  const all = Object.entries(SESSIONS);
  const date = String(sidecar.t0Iso ?? sidecar.match ?? '').slice(0, 10);
  return (
    all.find(([key]) => key === sidecar.sessionId)?.[1] ??
    all.find(
      ([, s]) => s.session === sidecar.session && s.match === date,
    )?.[1] ??
    all.find(([, s]) => s.session === sidecar.session)?.[1] ??
    null
  );
}

/**
 * `0123_2013-11-28 19:10:03.469509000.h264` → { index, name, wallMs } where
 * wallMs is UTC epoch milliseconds with a fractional part (µs precision).
 */
export function parseSegmentName(name) {
  const m =
    /^(\d{4})_(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d+)\.h264(?:_track\.txt)?$/.exec(
      path.basename(name),
    );
  if (!m) return null;
  const [, idx, date, hh, mm, ss, frac] = m;
  const base = Date.parse(`${date}T${hh}:${mm}:${ss}${OSLO_OFFSET}`);
  const fracMs = Number(`0.${frac}`) * 1000;
  return {
    index: Number(idx),
    name: path.basename(name),
    wallMs: base + fracMs,
    date,
  };
}

/** `"2013-11-28 19:03:51.05"` (local) → UTC epoch ms (fractional). */
export function parseLocalTimestamp(s) {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(
    s.replace(/"/g, ''),
  );
  if (!m) return NaN;
  const [, date, hh, mm, ss, frac] = m;
  const base = Date.parse(`${date}T${hh}:${mm}:${ss}${OSLO_OFFSET}`);
  return base + (frac ? Number(`0.${frac}`) * 1000 : 0);
}

/** Parse `--from/--to`: `HH:MM:SS[.fff]` (local, on the match date), ISO, or epoch seconds. */
export function parseWhen(s, matchDate) {
  if (s == null) return null;
  const str = String(s);
  if (/^\d+(\.\d+)?$/.test(str)) return Number(str) * 1000;
  if (/^\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(str))
    return parseLocalTimestamp(`${matchDate} ${str}`);
  const v = Date.parse(str);
  return Number.isFinite(v) ? v : NaN;
}

/** Sorted segment list of a local directory: [{index, name, wallMs, file}]. */
export function listLocalSegments(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.h264'))
    .map((f) => ({ ...parseSegmentName(f), file: path.join(dir, f) }))
    .filter((s) => s.index != null)
    .sort((a, b) => a.index - b.index);
}

/** One ZXY row (interpolated 20 Hz file, no header). */
export function parseZxyRow(line) {
  // "2013-11-28 19:03:51.05",3,77.134,70.651,-2.24,0,4.249,0,0.844
  const i = line.indexOf('",');
  if (i < 0) return null;
  const ts = line.slice(1, i);
  const rest = line.slice(i + 2).split(',');
  if (rest.length < 8) return null;
  const wallMs = parseLocalTimestamp(ts);
  if (!Number.isFinite(wallMs)) return null;
  return {
    wallMs,
    tag: Number(rest[0]),
    x: Number(rest[1]),
    y: Number(rest[2]),
    heading: Number(rest[3]),
    direction: Number(rest[4]),
    energy: Number(rest[5]),
    speed: Number(rest[6]),
    totalDistance: Number(rest[7]),
  };
}

/** Stream a ZXY CSV row by row (65–90 MB files). */
export async function forEachZxyRow(file, fn) {
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line) continue;
    const row = parseZxyRow(line);
    if (row) fn(row);
  }
}

export const PITCH = { length: 105, width: 68 };

/**
 * Tilted-cylinder panorama camera model (see scripts/fb-zones/*.json):
 * pitch metres (X 0..105 left→right goal line in the panorama, Y 0..68
 * far→near touchline) → panorama pixels. Fitted on hand-read landmarks;
 * ~1 m accuracy over the whole pitch.
 */
export function projectPitch(cam, X, Y) {
  const { cx, d, hc, f, x0, y0, tilt, roll = 0 } = cam;
  const dx = X - cx;
  const dz = PITCH.width + d - Y;
  const theta = Math.atan2(dx, dz);
  const r = Math.hypot(dx, dz);
  const phi = Math.atan2(-hc, r);
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const cp = Math.cos(phi);
  const ry = Math.sin(phi) * ct + Math.cos(theta) * cp * st;
  const rz = -Math.sin(phi) * st + Math.cos(theta) * cp * ct;
  const rx0 = Math.sin(theta) * cp;
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const rx = rx0 * cr - ry * sr;
  const ryr = rx0 * sr + ry * cr;
  return [x0 + f * Math.atan2(rx, rz), y0 - (f * ryr) / Math.hypot(rx, rz)];
}

const unprojectGrids = new WeakMap();

/** Inverse of projectPitch: panorama px → pitch metres (coarse grid + Newton refinement). */
export function unprojectPitch(cam, px, py) {
  let grid = unprojectGrids.get(cam);
  if (!grid) {
    grid = [];
    for (let X = -15; X <= 120; X += 1) {
      for (let Y = -15; Y <= 83; Y += 1) {
        const [x, y] = projectPitch(cam, X, Y);
        grid.push([X, Y, x, y]);
      }
    }
    unprojectGrids.set(cam, grid);
  }
  let best = null;
  let bestD = Infinity;
  for (const g of grid) {
    const dd = (g[2] - px) ** 2 + (g[3] - py) ** 2;
    if (dd < bestD) {
      bestD = dd;
      best = g;
    }
  }
  let X = best[0];
  let Y = best[1];
  for (let it = 0; it < 6; it++) {
    const [x, y] = projectPitch(cam, X, Y);
    const ex = px - x;
    const ey = py - y;
    if (Math.abs(ex) < 0.05 && Math.abs(ey) < 0.05) break;
    const h = 0.05;
    const [xa, ya] = projectPitch(cam, X + h, Y);
    const [xb, yb] = projectPitch(cam, X, Y + h);
    const a = (xa - x) / h;
    const b = (xb - x) / h;
    const c = (ya - y) / h;
    const dd = (yb - y) / h;
    const det = a * dd - b * c;
    if (Math.abs(det) < 1e-9) break;
    const sX = (dd * ex - b * ey) / det;
    const sY = (-c * ex + a * ey) / det;
    const cap = 5;
    X += Math.max(-cap, Math.min(cap, sX));
    Y += Math.max(-cap, Math.min(cap, sY));
  }
  return [X, Y];
}

/** ZXY sensor frame → the panorama's pitch frame. */
export function zxyToPitch(zones, zx, zy) {
  const X = zones.zxy?.flipX ? PITCH.length - zx : zx;
  const Y = zones.zxy?.flipY ? PITCH.width - zy : zy;
  return [X, Y];
}

export function loadZones(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** A ZXY position is on the pitch (with a 1 m margin for the touchlines). */
export function onPitch(x, y, margin = 1) {
  return (
    x >= -margin &&
    x <= PITCH.length + margin &&
    y >= -margin &&
    y <= PITCH.width + margin
  );
}

/** Ray-casting point in polygon; poly = [[x,y],…]. */
export function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const hit =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

export function median3(arr) {
  const out = arr.slice();
  for (let i = 1; i < arr.length - 1; i++) {
    const a = arr[i - 1];
    const b = arr[i];
    const c = arr[i + 1];
    out[i] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  }
  return out;
}

export function ema(arr, alpha) {
  const out = new Array(arr.length);
  let s = arr[0];
  for (let i = 0; i < arr.length; i++) {
    s = i === 0 ? arr[0] : alpha * arr[i] + (1 - alpha) * s;
    out[i] = s;
  }
  return out;
}

export function fmtClock(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Read `<clip>.alfheim.json` next to an mp4 under data/mp4s (or a folder's first one). */
export function readAlfheimSidecar(mp4Path) {
  const sidecar = mp4Path.replace(/\.mp4$/i, '.alfheim.json');
  if (fs.existsSync(sidecar))
    return JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  const dir = path.dirname(mp4Path);
  const any = fs.readdirSync(dir).find((f) => f.endsWith('.alfheim.json'));
  return any ? JSON.parse(fs.readFileSync(path.join(dir, any), 'utf8')) : null;
}
