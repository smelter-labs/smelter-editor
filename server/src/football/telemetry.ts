/**
 * Clip telemetry for the football game: the sidecars scripts/alfheim-*.mjs
 * write next to a prepared Alfheim clip (`zxy.json` player positions,
 * `ball.json` ball track, `zones.json` panorama camera model) parsed into
 * typed arrays, plus the lookups the director / HUD / events need. Pure —
 * no fs, no timers — so it is unit-testable and the controller tests stay
 * in-memory.
 *
 * Pitch frame (metres): X 0..105 = left → right goal line AS SEEN IN THE
 * PANORAMA, Y 0..68 = far → near touchline. Both sidecars are written in it.
 */
import type { FbSession } from '@smelter-editor/types';

export const PITCH_LENGTH = 105;
export const PITCH_WIDTH = 68;

/** Tilted-cylinder panorama camera (see scripts/fb-zones/*.json). */
export type FbCameraModel = {
  cx: number;
  d: number;
  hc: number;
  f: number;
  x0: number;
  y0: number;
  tilt: number;
};

export type FbZones = {
  pano: { w: number; h: number };
  camera: FbCameraModel | null;
};

export type FbSprint = {
  tag: number;
  startMs: number;
  endMs: number;
  topKmh: number;
  meters: number;
};

export type FbZxyTag = {
  id: number;
  firstMs: number;
  lastMs: number;
  /** Sample i ↔ media ms i·1000/hz; NaN = no fix. */
  x: Float64Array;
  y: Float64Array;
  /** Speed (m/s). */
  v: Float64Array;
  /** Total distance (m, the sensor's own odometer). */
  d: Float64Array;
  /** Running maximum of `v` (m/s) up to sample i. */
  vMax: Float64Array;
};

export type FbZxy = {
  hz: number;
  durationMs: number;
  team: string;
  /** 'pano' = pitch frame of the panorama; 'sensor' = raw ZXY axes. */
  frame: 'pano' | 'sensor';
  tags: FbZxyTag[];
  sprints: FbSprint[];
};

export type FbBall = {
  fps: number;
  w: number;
  h: number;
  /** Sorted media ms. */
  t: Float64Array;
  px: Float64Array;
  py: Float64Array;
  /** Pitch metres (NaN when the sidecar has no camera model). */
  X: Float64Array;
  Y: Float64Array;
};

export type FbClipMeta = {
  session: FbSession | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  panoWidth: number | null;
  panoHeight: number | null;
  t0Utc: number | null;
  homeTeam: string | null;
  awayTeam: string | null;
};

export type FbTelemetry = {
  meta: FbClipMeta | null;
  zxy: FbZxy | null;
  ball: FbBall | null;
  zones: FbZones | null;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export function parseClipMeta(json: unknown): FbClipMeta {
  if (!isRecord(json)) throw new Error('alfheim.json: expected an object');
  const session =
    json.session === 'pano' || json.session === 'tricam' ? json.session : null;
  return {
    session,
    fps: num(json.fps),
    width: num(json.width),
    height: num(json.height),
    panoWidth: num(json.panoWidth),
    panoHeight: num(json.panoHeight),
    t0Utc: num(json.t0Utc),
    homeTeam: typeof json.homeTeam === 'string' ? json.homeTeam : null,
    awayTeam: typeof json.awayTeam === 'string' ? json.awayTeam : null,
  };
}

export function parseZones(json: unknown): FbZones {
  if (!isRecord(json) || !isRecord(json.pano)) {
    throw new Error('zones.json: expected { pano, camera }');
  }
  const w = num(json.pano.w);
  const h = num(json.pano.h);
  if (w == null || h == null) throw new Error('zones.json: bad pano size');
  let camera: FbCameraModel | null = null;
  if (isRecord(json.camera)) {
    const c = json.camera;
    const vals = ['cx', 'd', 'hc', 'f', 'x0', 'y0', 'tilt'].map((k) =>
      num(c[k]),
    );
    if (vals.every((v) => v != null)) {
      const [cx, d, hc, f, x0, y0, tilt] = vals as number[];
      camera = { cx, d, hc, f, x0, y0, tilt };
    }
  }
  return { pano: { w, h }, camera };
}

function toFloat(arr: unknown, n: number): Float64Array {
  const out = new Float64Array(n).fill(NaN);
  if (Array.isArray(arr)) {
    for (let i = 0; i < Math.min(n, arr.length); i++) {
      const v = arr[i];
      if (typeof v === 'number' && Number.isFinite(v)) out[i] = v;
    }
  }
  return out;
}

export function parseZxy(json: unknown): FbZxy {
  if (!isRecord(json) || !Array.isArray(json.tags)) {
    throw new Error('zxy.json: expected { hz, tags[] }');
  }
  const hz = num(json.hz) ?? 10;
  const durationMs = num(json.durationMs) ?? 0;
  const n = Math.ceil(durationMs / (1000 / hz)) + 1;
  const tags: FbZxyTag[] = [];
  for (const raw of json.tags) {
    if (!isRecord(raw)) continue;
    const id = num(raw.id);
    if (id == null) continue;
    const len = Math.max(n, Array.isArray(raw.x) ? raw.x.length : 0);
    const v = toFloat(raw.v, len);
    const vMax = new Float64Array(len);
    let m = 0;
    for (let i = 0; i < len; i++) {
      if (!Number.isNaN(v[i])) m = Math.max(m, v[i]);
      vMax[i] = m;
    }
    tags.push({
      id,
      firstMs: num(raw.firstMs) ?? 0,
      lastMs: num(raw.lastMs) ?? durationMs,
      x: toFloat(raw.x, len),
      y: toFloat(raw.y, len),
      v,
      d: toFloat(raw.d, len),
      vMax,
    });
  }
  const sprints: FbSprint[] = [];
  if (Array.isArray(json.sprints)) {
    for (const s of json.sprints) {
      if (!isRecord(s)) continue;
      const tag = num(s.tag);
      const startMs = num(s.startMs) ?? num(s.tMs);
      const endMs = num(s.endMs) ?? startMs;
      if (tag == null || startMs == null || endMs == null) continue;
      sprints.push({
        tag,
        startMs,
        endMs,
        topKmh: num(s.topKmh) ?? 0,
        meters: num(s.meters) ?? 0,
      });
    }
  }
  sprints.sort((a, b) => a.startMs - b.startMs);
  return {
    hz,
    durationMs,
    team: typeof json.team === 'string' ? json.team : 'HOME',
    frame: json.frame === 'pano' ? 'pano' : 'sensor',
    tags,
    sprints,
  };
}

export function parseBall(json: unknown): FbBall {
  if (!isRecord(json) || !Array.isArray(json.samples)) {
    throw new Error('ball.json: expected { fps, w, h, samples[] }');
  }
  const rows = json.samples.filter(
    (s): s is number[] => Array.isArray(s) && s.length >= 3,
  );
  rows.sort((a, b) => a[0] - b[0]);
  const n = rows.length;
  const t = new Float64Array(n);
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const X = new Float64Array(n).fill(NaN);
  const Y = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    t[i] = r[0];
    px[i] = r[1];
    py[i] = r[2];
    if (r.length >= 5 && Number.isFinite(r[3]) && Number.isFinite(r[4])) {
      X[i] = r[3];
      Y[i] = r[4];
    }
  }
  return {
    fps: num(json.fps) ?? 25,
    w: num(json.w) ?? 4450,
    h: num(json.h) ?? 2000,
    t,
    px,
    py,
    X,
    Y,
  };
}

// ── camera model ──────────────────────────────────────────────────────────

/** Pitch metres → panorama pixels. */
export function projectPitch(
  cam: FbCameraModel,
  X: number,
  Y: number,
): [number, number] {
  const dx = X - cam.cx;
  const dz = PITCH_WIDTH + cam.d - Y;
  const theta = Math.atan2(dx, dz);
  const r = Math.hypot(dx, dz);
  const phi = Math.atan2(-cam.hc, r);
  const ct = Math.cos(cam.tilt);
  const st = Math.sin(cam.tilt);
  const cp = Math.cos(phi);
  const ry = Math.sin(phi) * ct + Math.cos(theta) * cp * st;
  const rz = -Math.sin(phi) * st + Math.cos(theta) * cp * ct;
  const rx = Math.sin(theta) * cp;
  return [
    cam.x0 + cam.f * Math.atan2(rx, rz),
    cam.y0 - (cam.f * ry) / Math.hypot(rx, rz),
  ];
}

const unprojectGrids = new WeakMap<FbCameraModel, number[][]>();

/** Panorama pixels → pitch metres (coarse grid + Newton refinement). */
export function unprojectPitch(
  cam: FbCameraModel,
  px: number,
  py: number,
): [number, number] {
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
  let best = grid[0];
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
    X += Math.max(-5, Math.min(5, sX));
    Y += Math.max(-5, Math.min(5, sY));
  }
  return [X, Y];
}

export function onPitch(x: number, y: number, margin = 1): boolean {
  return (
    x >= -margin &&
    x <= PITCH_LENGTH + margin &&
    y >= -margin &&
    y <= PITCH_WIDTH + margin
  );
}

// ── lookups ───────────────────────────────────────────────────────────────

export type BallSample = {
  tMs: number;
  px: number;
  py: number;
  X: number;
  Y: number;
};

/** Index of the last sample at or before `tMs` (−1 before the first). */
function lastIndexAtOrBefore(t: Float64Array, tMs: number): number {
  let lo = 0;
  let hi = t.length - 1;
  if (hi < 0 || tMs < t[0]) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t[mid] <= tMs) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Ball at `tMs` (linear interpolation; null outside the track or across a gap > `maxGapMs`). */
export function ballAt(
  ball: FbBall,
  tMs: number,
  maxGapMs = 500,
): BallSample | null {
  const i = lastIndexAtOrBefore(ball.t, tMs);
  if (i < 0) return null;
  if (i >= ball.t.length - 1) {
    return tMs - ball.t[i] <= maxGapMs ? sampleAt(ball, i) : null;
  }
  const j = i + 1;
  if (ball.t[j] - ball.t[i] > maxGapMs) {
    return tMs - ball.t[i] <= maxGapMs ? sampleAt(ball, i) : null;
  }
  const f = (tMs - ball.t[i]) / (ball.t[j] - ball.t[i]);
  const lerp = (a: Float64Array) => a[i] + (a[j] - a[i]) * f;
  return {
    tMs,
    px: lerp(ball.px),
    py: lerp(ball.py),
    X: lerp(ball.X),
    Y: lerp(ball.Y),
  };
}

function sampleAt(ball: FbBall, i: number): BallSample {
  return {
    tMs: ball.t[i],
    px: ball.px[i],
    py: ball.py[i],
    X: ball.X[i],
    Y: ball.Y[i],
  };
}

/** Mean ball position over [fromMs, toMs] (null when no samples). */
export function ballMean(
  ball: FbBall,
  fromMs: number,
  toMs: number,
): BallSample | null {
  let i = lastIndexAtOrBefore(ball.t, fromMs);
  if (i < 0) i = 0;
  let n = 0;
  let px = 0;
  let py = 0;
  let X = 0;
  let Y = 0;
  for (; i < ball.t.length && ball.t[i] <= toMs; i++) {
    if (ball.t[i] < fromMs) continue;
    n++;
    px += ball.px[i];
    py += ball.py[i];
    X += ball.X[i];
    Y += ball.Y[i];
  }
  if (n === 0) return null;
  return {
    tMs: (fromMs + toMs) / 2,
    px: px / n,
    py: py / n,
    X: X / n,
    Y: Y / n,
  };
}

/** Ball speed (panorama px/s) around `tMs` from a 200 ms window. */
/**
 * Ball speed (px/s) from a ±100 ms central difference; falls back to a
 * ±one-frame window at the ends of a run.
 */
export function ballSpeedPx(ball: FbBall, tMs: number): number {
  const frameMs = 1000 / Math.max(1, ball.fps);
  for (const half of [100, frameMs]) {
    const a = ballAt(ball, tMs - half);
    const b = ballAt(ball, tMs + half);
    if (a && b) {
      return Math.hypot(b.px - a.px, b.py - a.py) / ((2 * half) / 1000);
    }
  }
  return 0;
}

export type PlayerSample = { tag: number; x: number; y: number; v: number };

export function tagAt(
  zxy: FbZxy,
  tag: FbZxyTag,
  tMs: number,
): PlayerSample | null {
  const i = Math.round(tMs / (1000 / zxy.hz));
  if (i < 0 || i >= tag.x.length) return null;
  const x = tag.x[i];
  const y = tag.y[i];
  if (Number.isNaN(x) || Number.isNaN(y)) return null;
  return { tag: tag.id, x, y, v: Number.isNaN(tag.v[i]) ? 0 : tag.v[i] };
}

/** Tagged players on the pitch at `tMs`. */
export function playersAt(zxy: FbZxy, tMs: number, margin = 1): PlayerSample[] {
  const out: PlayerSample[] = [];
  for (const tag of zxy.tags) {
    const s = tagAt(zxy, tag, tMs);
    if (s && onPitch(s.x, s.y, margin)) out.push(s);
  }
  return out;
}

/** Centroid of the tagged players on the pitch (null when fewer than 3). */
export function centroidAt(
  zxy: FbZxy,
  tMs: number,
): { x: number; y: number; n: number } | null {
  const ps = playersAt(zxy, tMs);
  if (ps.length < 3) return null;
  let x = 0;
  let y = 0;
  for (const p of ps) {
    x += p.x;
    y += p.y;
  }
  return { x: x / ps.length, y: y / ps.length, n: ps.length };
}

export type TagStats = {
  tag: number;
  topKmh: number;
  meters: number;
  sprints: number;
};

/** Per-tag stats up to `tMs` (top speed so far, distance so far, sprints so far). */
export function statsAt(zxy: FbZxy, tMs: number): TagStats[] {
  const i = Math.max(
    0,
    Math.min(Math.round(tMs / (1000 / zxy.hz)), Number.MAX_SAFE_INTEGER),
  );
  const out: TagStats[] = [];
  for (const tag of zxy.tags) {
    const idx = Math.min(i, tag.x.length - 1);
    if (idx < 0) continue;
    let first = NaN;
    for (let k = 0; k <= idx; k++) {
      if (!Number.isNaN(tag.d[k])) {
        first = tag.d[k];
        break;
      }
    }
    let last = NaN;
    for (let k = idx; k >= 0; k--) {
      if (!Number.isNaN(tag.d[k])) {
        last = tag.d[k];
        break;
      }
    }
    const meters =
      Number.isNaN(first) || Number.isNaN(last) ? 0 : Math.max(0, last - first);
    out.push({
      tag: tag.id,
      topKmh: Math.round(tag.vMax[idx] * 36) / 10,
      meters: Math.round(meters),
      sprints: zxy.sprints.filter((s) => s.tag === tag.id && s.startMs <= tMs)
        .length,
    });
  }
  return out;
}

/** A sprint in progress at `tMs`, or one that ended within `lingerMs`. */
export function sprintAt(
  zxy: FbZxy,
  tMs: number,
  lingerMs = 2000,
): FbSprint | null {
  let best: FbSprint | null = null;
  for (const s of zxy.sprints) {
    if (s.startMs > tMs) break;
    if (tMs <= s.endMs + lingerMs && (!best || s.topKmh > best.topKmh))
      best = s;
  }
  return best;
}

export function emptyTelemetry(): FbTelemetry {
  return { meta: null, zxy: null, ball: null, zones: null };
}
