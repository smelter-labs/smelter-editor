#!/usr/bin/env node
// Alfheim ZXY player positions (+ the Tottenham panorama's ball track) →
// compact sidecars in CLIP MEDIA TIME next to a prepared clip:
//
//   zxy.json   { t0Utc, hz, team, pitch, frame, tags:[{id, x[], y[], v[], d[]}], sprints:[…] }
//              sample i of every tag ↔ media ms i·1000/hz (null = no fix); x/y in the
//              PANORAMA's pitch frame (X 0..105 left→right goal line as seen in the
//              panorama, Y 0..68 far→near touchline) when a zones file gives the
//              ZXY orientation, else the raw sensor frame.
//   ball.json  { t0Utc, fps, w, h, samples:[[tMs, px, py, Xm, Ym], …] }  (panorama px + metres)
//
//   node scripts/alfheim-telemetry.mjs --clip fb/pano-2013-11-28/pano.mp4 [--archive <dir>] \
//        [--zones scripts/fb-zones/pano-2013-11-28.json] [--hz 10] [--out <dir>] \
//        [--sprint-ms 7.0] [--sprint-end-ms 5.5] [--sprint-min-s 1]
//
// --clip is relative to server/data/mp4s; its `<clip>.alfheim.json` sidecar
// (written by alfheim-prep.mjs) gives t0Utc, the session and the duration.
// The zones file carries the ZXY clock lead over the video clock (`zxy.offsetMs`,
// +4.0 s on 2013-11-28) and the axis flips. Only the home team (Tromsø) wears
// tags. Dataset: Alfheim (Simula) — non-commercial research use only.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PITCH,
  sessionOfSidecar,
  forEachZxyRow,
  loadZones,
  onPitch,
  parseSegmentName,
  readAlfheimSidecar,
  unprojectPitch,
  zxyToPitch,
} from './lib/alfheim.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MP4S = path.join(here, '..', 'data', 'mp4s');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : def;
};
const DEFAULT_ARCHIVE = path.join(
  os.homedir(),
  'workspace/streaming/workshops/workshop_5/pzpn/alfheim',
);
const clipRel = opt('clip', null);
const archive = opt('archive', process.env.ALFHEIM_DIR ?? DEFAULT_ARCHIVE);
const hz = Number(opt('hz', '10'));
const sprintMs = Number(opt('sprint-ms', '7.0')); // m/s ≈ 25.2 km/h
const sprintEndMs = Number(opt('sprint-end-ms', '5.5'));
const sprintMinS = Number(opt('sprint-min-s', '1'));
if (!clipRel || !(hz > 0) || 20 % hz !== 0) {
  console.error(
    'usage: alfheim-telemetry.mjs --clip <mp4 under data/mp4s> [--archive <dir>] [--zones <json>] [--hz 10|20|5] [--out <dir>]',
  );
  process.exit(2);
}
const clipPath = path.join(MP4S, clipRel);
const sidecar = readAlfheimSidecar(clipPath);
if (!sidecar) {
  console.error(
    `no .alfheim.json next to ${clipPath} — run alfheim-prep.mjs first`,
  );
  process.exit(1);
}
const session = sessionOfSidecar(sidecar);
const zonesFile = opt(
  'zones',
  session.session === 'pano'
    ? path.join(here, 'fb-zones', `pano-${session.match}.json`)
    : null,
);
const zones =
  zonesFile && fs.existsSync(zonesFile) ? loadZones(zonesFile) : null;
const zxyOffsetMs = zones?.zxy?.offsetMs ?? 0;
const outDir = opt('out', path.dirname(clipPath));
const t0Ms = sidecar.t0Utc * 1000;
const durationMs = Math.round(
  (sidecar.output?.durationS ?? sidecar.t1Utc - sidecar.t0Utc) * 1000,
);
const t1Ms = t0Ms + durationMs;
const step = 1000 / hz;
const n = Math.ceil(durationMs / step) + 1;
const r2 = (v) => Math.round(v * 100) / 100;
const r1 = (v) => Math.round(v * 10) / 10;
console.log(
  `clip ${clipRel}: ${(durationMs / 1000).toFixed(1)} s from ${sidecar.t0Iso}; zones ${zones ? zonesFile : 'none'}; zxy offset ${zxyOffsetMs} ms`,
);

// ── ZXY ──────────────────────────────────────────────────────────────────
const zxyFile = path.join(archive, session.zxy);
if (!fs.existsSync(zxyFile)) {
  console.error(`missing ${zxyFile}`);
  process.exit(1);
}
const tags = new Map();
let rows = 0;
let kept = 0;
await forEachZxyRow(zxyFile, (row) => {
  rows++;
  // The sensor clock leads the video clock by offsetMs.
  const wallMs = row.wallMs - zxyOffsetMs;
  if (wallMs < t0Ms - 1000 || wallMs > t1Ms + 1000) return;
  kept++;
  let t = tags.get(row.tag);
  if (!t) {
    t = {
      x: new Float64Array(n).fill(NaN),
      y: new Float64Array(n).fill(NaN),
      v: new Float64Array(n).fill(NaN),
      d: new Float64Array(n).fill(NaN),
      raw: [],
      first: Infinity,
      last: -Infinity,
    };
    tags.set(row.tag, t);
  }
  const rel = wallMs - t0Ms;
  const [X, Y] = zones ? zxyToPitch(zones, row.x, row.y) : [row.x, row.y];
  t.raw.push({ t: rel, v: row.speed, x: X, y: Y });
  t.first = Math.min(t.first, rel);
  t.last = Math.max(t.last, rel);
  const i = Math.round(rel / step);
  if (i < 0 || i >= n) return;
  if (Math.abs(rel - i * step) <= step / 2) {
    t.x[i] = X;
    t.y[i] = Y;
    t.v[i] = row.speed;
    t.d[i] = row.totalDistance;
  }
});
console.log(`zxy: ${rows} rows, ${kept} in the clip window, ${tags.size} tags`);

// Sprints from the 20 Hz speed column.
const sprints = [];
const tagSummary = [];
for (const [id, t] of [...tags.entries()].sort((a, b) => a[0] - b[0])) {
  t.raw.sort((a, b) => a.t - b.t);
  let run = null;
  let lastEnd = -Infinity;
  let onPitchSamples = 0;
  let topV = 0;
  for (let i = 0; i < t.raw.length; i++) {
    const s = t.raw[i];
    if (onPitch(s.x, s.y)) onPitchSamples++;
    topV = Math.max(topV, s.v);
    const dt = i > 0 ? (s.t - t.raw[i - 1].t) / 1000 : 0.05;
    if (!run) {
      if (
        s.v >= sprintMs &&
        onPitch(s.x, s.y) &&
        s.t - lastEnd >= 5000 &&
        s.t >= 0
      ) {
        run = { start: s.t, top: s.v, meters: 0, below: 0, sx: s.x, sy: s.y };
      }
      continue;
    }
    run.meters += s.v * dt;
    run.top = Math.max(run.top, s.v);
    if (s.v < sprintEndMs) {
      run.below += dt;
      if (run.below >= 0.5) {
        const end = s.t - run.below * 1000;
        if (end - run.start >= sprintMinS * 1000) {
          sprints.push({
            tag: id,
            startMs: Math.round(run.start),
            endMs: Math.round(end),
            tMs: Math.round(run.start),
            topKmh: r1(run.top * 3.6),
            meters: r1(run.meters),
            fromX: r1(run.sx),
            fromY: r1(run.sy),
          });
          lastEnd = end;
        }
        run = null;
      }
    } else {
      run.below = 0;
    }
  }
  tagSummary.push({
    id,
    samples: t.raw.length,
    onPitchPct: t.raw.length
      ? Math.round((100 * onPitchSamples) / t.raw.length)
      : 0,
    topKmh: r1(topV * 3.6),
    sprints: sprints.filter((s) => s.tag === id).length,
  });
}
sprints.sort((a, b) => a.tMs - b.tMs);

const toArr = (a, rnd = r2) =>
  Array.from(a, (v) => (Number.isNaN(v) ? null : rnd(v)));
const zxyOut = {
  t0Utc: sidecar.t0Utc,
  hz,
  durationMs,
  team: session.home,
  pitch: { length: PITCH.length, width: PITCH.width },
  frame: zones ? 'pano' : 'sensor',
  zxyOffsetMs,
  tags: [...tags.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id, t]) => ({
      id,
      firstMs: Math.round(t.first),
      lastMs: Math.round(t.last),
      x: toArr(t.x),
      y: toArr(t.y),
      v: toArr(t.v),
      d: toArr(t.d, Math.round),
    })),
  sprints,
};
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'zxy.json'), JSON.stringify(zxyOut));
console.log(
  `wrote ${path.join(outDir, 'zxy.json')} (${(fs.statSync(path.join(outDir, 'zxy.json')).size / 1e6).toFixed(1)} MB)`,
);
console.table(tagSummary);
console.log(
  `sprints: ${sprints.length} (≥ ${sprintMs} m/s for ≥ ${sprintMinS} s)`,
);

// Where is Tromsø at the start? (own half → they attack the other end)
const firstWindow = Math.min(120000, durationMs);
let sx = 0;
let sn = 0;
for (const t of tags.values()) {
  for (const s of t.raw) {
    if (s.t < 0 || s.t > firstWindow || !onPitch(s.x, s.y)) continue;
    sx += s.x;
    sn++;
  }
}
if (sn > 0) {
  const meanX = sx / sn;
  console.log(
    `${session.home} mean X over the first ${(firstWindow / 1000).toFixed(0)} s: ${meanX.toFixed(1)} m (${zones ? 'panorama frame' : 'sensor frame'}) → own half is the ${meanX < 52.5 ? 'LEFT/low-X' : 'RIGHT/high-X'} end; they attack the ${meanX < 52.5 ? 'RIGHT' : 'LEFT'} goal`,
  );
}

// ── Ball (panorama sessions only) ───────────────────────────────────────
if (session.ballTracks) {
  const trackDir = path.join(archive, session.ballTracks);
  const files = fs.existsSync(trackDir)
    ? fs
        .readdirSync(trackDir)
        .filter((f) => f.endsWith('_track.txt'))
        .sort()
    : [];
  const samples = [];
  const fps = session.fps;
  for (const f of files) {
    const seg = parseSegmentName(f);
    if (!seg) continue;
    const segStart = seg.wallMs - t0Ms;
    if (segStart + 3000 < 0 || segStart > durationMs) continue;
    const lines = fs
      .readFileSync(path.join(trackDir, f), 'utf8')
      .trim()
      .split('\n');
    for (const line of lines) {
      const [frameNo, x, y] = line.trim().split(/\s+/).map(Number);
      if (
        !Number.isFinite(frameNo) ||
        !Number.isFinite(x) ||
        !Number.isFinite(y)
      )
        continue;
      const tMs = segStart + ((frameNo - 1) * 1000) / fps;
      if (tMs < 0 || tMs > durationMs) continue;
      const m = zones ? unprojectPitch(zones.camera, x, y) : null;
      samples.push(
        m
          ? [Math.round(tMs), x, y, r1(m[0]), r1(m[1])]
          : [Math.round(tMs), x, y],
      );
    }
  }
  samples.sort((a, b) => a[0] - b[0]);
  const ballOut = {
    t0Utc: sidecar.t0Utc,
    fps,
    w: session.pano.w,
    h: session.pano.h,
    frame: zones ? 'px+pano-metres' : 'px',
    samples,
  };
  fs.writeFileSync(path.join(outDir, 'ball.json'), JSON.stringify(ballOut));
  console.log(
    `ball: ${files.length} track files, ${samples.length} samples in the clip window → ${path.join(outDir, 'ball.json')}`,
  );
}
