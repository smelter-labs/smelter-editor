#!/usr/bin/env node
/**
 * Hand-keyed ball track → ball.json, for footage without the dataset's ball
 * track (Alfheim 2013-11-07). The follow camera and the replay crop only
 * need "where the action is", so a keyframe every ~0.5–2 s is enough.
 *
 *   node scripts/fb-ball-keyframes.mjs --clip fb-demo/pano-anzhi-goal/pano.mp4 \
 *        --keyframes scripts/fb-zones/pano-2013-11-07.ball-keyframes.json [--max-gap-s 3]
 *
 * Keyframes file: { "keyframes": [[tMs, px, py], …] } — clip media ms and
 * panorama pixels; click them in scripts/fb-ball-keyframes.html. Consecutive
 * keyframes are interpolated linearly at the clip's fps; a pair further apart
 * than --max-gap-s stays a gap (the director drifts to the wide view there).
 * Writes `ball.json` next to the clip in the schema alfheim-telemetry.mjs
 * produces, metres via the folder's zones.json camera.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadZones,
  readAlfheimSidecar,
  unprojectPitch,
} from './lib/alfheim.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MP4S = path.join(here, '..', 'data', 'mp4s');

const argv = process.argv.slice(2);
const opt = (name, def = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : def;
};
const clipRel = opt('clip');
const keyframesFile = opt('keyframes');
if (!clipRel || !keyframesFile) {
  console.error(
    'usage: fb-ball-keyframes.mjs --clip <mp4 under data/mp4s> --keyframes <json> [--max-gap-s 3]',
  );
  process.exit(2);
}
const maxGapMs = Number(opt('max-gap-s', '3')) * 1000;
const clipPath = path.join(MP4S, clipRel);
const dir = path.dirname(clipPath);
const sidecar = readAlfheimSidecar(clipPath);
if (!sidecar) {
  console.error(`no .alfheim.json next to ${clipPath}`);
  process.exit(1);
}
const zonesFile = path.join(dir, 'zones.json');
const zones = fs.existsSync(zonesFile) ? loadZones(zonesFile) : null;
if (!zones?.camera) {
  console.error(`${zonesFile}: no camera model — copy the fb-zones file first`);
  process.exit(1);
}

const keyframes = JSON.parse(fs.readFileSync(keyframesFile, 'utf8'))
  .keyframes.filter((k) => Array.isArray(k) && k.length >= 3)
  .sort((a, b) => a[0] - b[0]);
const fps = sidecar.fps ?? 25;
const stepMs = 1000 / fps;
const r1 = (v) => Math.round(v * 10) / 10;
const samples = [];
const push = (tMs, px, py) => {
  const [X, Y] = unprojectPitch(zones.camera, px, py);
  samples.push([Math.round(tMs), Math.round(px), Math.round(py), r1(X), r1(Y)]);
};
let gaps = 0;
for (let k = 0; k < keyframes.length; k++) {
  const [t0, x0, y0] = keyframes[k];
  const next = keyframes[k + 1];
  if (!next || next[0] - t0 > maxGapMs) {
    push(t0, x0, y0);
    if (next) gaps++;
    continue;
  }
  const [t1, x1, y1] = next;
  for (let t = t0; t < t1; t += stepMs) {
    const f = (t - t0) / (t1 - t0);
    push(t, x0 + (x1 - x0) * f, y0 + (y1 - y0) * f);
  }
}
const out = {
  t0Utc: sidecar.t0Utc,
  fps,
  w: zones.pano.w,
  h: zones.pano.h,
  frame: 'px+pano-metres',
  source: 'hand-keyed',
  samples,
};
fs.writeFileSync(path.join(dir, 'ball.json'), JSON.stringify(out));
console.log(
  `ball: ${keyframes.length} keyframes → ${samples.length} samples, ${gaps} gaps → ${path.join(dir, 'ball.json')}`,
);
