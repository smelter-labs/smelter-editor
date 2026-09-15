#!/usr/bin/env node
// Cut one or more media windows out of synchronized Touchline clips (data/mp4s)
// into a demo folder that plays from 0: `<out>/<name>.mp4` per clip
// (re-encoded, frame-accurate; several windows are concatenated in order with
// the same cut points on every clip, so the clips stay in sync), plus the
// telemetry remapped onto the montage timeline: `events.json` (+ a copy per
// clip as `<name>.events.json`, which is what the AI EVENTS lookup finds
// first), `zxy.json`, `ball.json`, `zones.json` and `<name>.alfheim.json`.
//
//   node scripts/fb-clip-window.mjs --clips fb/pano-2013-11-28/pano.mp4 \
//        --from-s 176 --to-s 236 --out fb-demo/pano-chance-184s [--bitrate 12M]
//   node scripts/fb-clip-window.mjs --clips fb/tricam-2013-11-03/cam0.mp4,fb/tricam-2013-11-03/cam1.mp4,fb/tricam-2013-11-03/cam2.mp4 \
//        --windows 300-360,900-960 --out fb-demo/tricam-2x60s
//
// Sibling of scripts/bb-clip-window.mjs (basketball).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const MP4S = path.join(here, '..', 'data', 'mp4s');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : def;
};
const clips = opt('clips', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const out = opt('out', null);
const bitrate = opt('bitrate', '12M');
const vf = opt('vf', null);

let windows = [];
if (opt('windows', null)) {
  windows = opt('windows', '')
    .split(',')
    .map((w) => w.split('-').map(Number))
    .filter((w) => w.length === 2);
} else {
  windows = [[Number(opt('from-s', NaN)), Number(opt('to-s', NaN))]];
}
if (
  !clips.length ||
  !out ||
  !windows.length ||
  windows.some(
    ([a, b]) => !Number.isFinite(a) || !Number.isFinite(b) || !(b > a),
  )
) {
  console.error(
    'usage: fb-clip-window.mjs --clips a.mp4,b.mp4 (--from-s N --to-s M | --windows N-M,N-M,…) --out <folder under data/mp4s> [--bitrate 12M]',
  );
  process.exit(2);
}
const outDir = path.join(MP4S, out);
fs.mkdirSync(outDir, { recursive: true });
const encoders = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], {
  encoding: 'utf8',
});
const enc = /h264_videotoolbox/.test(encoders)
  ? [
      '-c:v',
      'h264_videotoolbox',
      '-b:v',
      bitrate,
      '-allow_sw',
      '1',
      '-profile:v',
      'high',
    ]
  : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20'];

// Montage timeline.
const segments = [];
let cursorMs = 0;
for (const [fromS, toS] of windows) {
  const fromMs = Math.round(fromS * 1000);
  const toMs = Math.round(toS * 1000);
  segments.push({ fromMs, toMs, startMs: cursorMs });
  cursorMs += toMs - fromMs;
}
const totalMs = cursorMs;
const remapMs = (ms) => {
  for (const seg of segments) {
    if (ms >= seg.fromMs && ms <= seg.toMs)
      return ms - seg.fromMs + seg.startMs;
  }
  return null;
};

const srcDir = path.dirname(path.join(MP4S, clips[0]));
const readJson = (f) =>
  fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;

// events.json
const gt = readJson(path.join(srcDir, 'events.json'));
let events = null;
if (gt) {
  const remapped = [];
  for (const seg of segments) {
    const shift = seg.startMs - seg.fromMs;
    for (const e of gt.events) {
      if (e.tMs < seg.fromMs || e.tMs > seg.toMs) continue;
      remapped.push({
        ...e,
        tMs: e.tMs + shift,
        ...(e.startMs != null ? { startMs: e.startMs + shift } : {}),
        ...(e.endMs != null ? { endMs: e.endMs + shift } : {}),
        sourceTMs: e.tMs,
      });
    }
  }
  remapped.sort((a, b) => a.tMs - b.tMs);
  events = {
    ...gt,
    source: `${gt.source ?? 'events'} · ${segments.length} window(s)`,
    t0Utc:
      segments.length === 1 && gt.t0Utc != null
        ? gt.t0Utc + segments[0].fromMs / 1000
        : null,
    durationMs: totalMs,
    kickoffMs: gt.kickoffMs != null ? remapMs(gt.kickoffMs) : null,
    montage: {
      sourceEvents: path.join(path.dirname(clips[0]), 'events.json'),
      totalMs,
      segments,
    },
    events: remapped,
  };
  fs.writeFileSync(
    path.join(outDir, 'events.json'),
    JSON.stringify(events, null, 2) + '\n',
  );
  const counts = {};
  for (const e of remapped) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  console.log(
    `events.json: ${remapped.length} events over ${(totalMs / 1000).toFixed(1)} s`,
    counts,
  );
}

// zxy.json: re-slice the per-tag arrays
const zxy = readJson(path.join(srcDir, 'zxy.json'));
if (zxy) {
  const step = 1000 / zxy.hz;
  const n = Math.ceil(totalMs / step) + 1;
  const slice = (arr) => {
    const outArr = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      const ms = i * step;
      const seg = segments.find(
        (s) => ms >= s.startMs && ms <= s.startMs + (s.toMs - s.fromMs),
      );
      if (!seg) continue;
      const srcIdx = Math.round((ms - seg.startMs + seg.fromMs) / step);
      outArr[i] = arr[srcIdx] ?? null;
    }
    return outArr;
  };
  const sprints = zxy.sprints
    .map((s) => ({
      ...s,
      tMs: remapMs(s.tMs),
      startMs: remapMs(s.startMs),
      endMs: remapMs(s.endMs) ?? remapMs(s.startMs),
    }))
    .filter((s) => s.tMs != null);
  fs.writeFileSync(
    path.join(outDir, 'zxy.json'),
    JSON.stringify({
      ...zxy,
      t0Utc: events?.t0Utc ?? null,
      durationMs: totalMs,
      montage: { segments },
      tags: zxy.tags.map((t) => ({
        ...t,
        x: slice(t.x),
        y: slice(t.y),
        v: slice(t.v),
        d: slice(t.d),
      })),
      sprints,
    }),
  );
  console.log(`zxy.json: ${zxy.tags.length} tags, ${sprints.length} sprints`);
}

// ball.json
const ball = readJson(path.join(srcDir, 'ball.json'));
if (ball) {
  const samples = ball.samples
    .map((s) => {
      const t = remapMs(s[0]);
      return t == null ? null : [t, ...s.slice(1)];
    })
    .filter(Boolean)
    .sort((a, b) => a[0] - b[0]);
  fs.writeFileSync(
    path.join(outDir, 'ball.json'),
    JSON.stringify({
      ...ball,
      t0Utc: events?.t0Utc ?? null,
      montage: { segments },
      samples,
    }),
  );
  console.log(`ball.json: ${samples.length} samples`);
}

// zones.json (copied verbatim when present next to the source clips)
for (const name of ['zones.json']) {
  const src = path.join(srcDir, name);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(outDir, name));
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-clip-'));
for (const clip of clips) {
  const base = path.basename(clip).replace(/\.mp4$/i, '');
  const dst = path.join(outDir, `${base}.mp4`);
  const parts = [];
  segments.forEach((seg, k) => {
    const part = path.join(tmp, `${base}-${k}.mp4`);
    console.log(
      `cutting ${clip} ${(seg.fromMs / 1000).toFixed(2)}–${(seg.toMs / 1000).toFixed(2)} s → ${out}/${base}.mp4 @ ${(seg.startMs / 1000).toFixed(1)} s`,
    );
    execFileSync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-y',
        '-ss',
        String(seg.fromMs / 1000),
        '-to',
        String(seg.toMs / 1000),
        '-i',
        path.join(MP4S, clip),
        ...(vf ? ['-vf', vf] : []),
        '-an',
        ...enc,
        '-pix_fmt',
        'yuv420p',
        '-g',
        '50',
        '-video_track_timescale',
        '90000',
        part,
      ],
      { stdio: 'inherit' },
    );
    parts.push(part);
  });
  if (parts.length === 1) {
    fs.copyFileSync(parts[0], dst);
  } else {
    const list = path.join(tmp, `${base}-list.txt`);
    fs.writeFileSync(
      list,
      parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n',
    );
    execFileSync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        list,
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        dst,
      ],
      { stdio: 'inherit' },
    );
  }
  // per-clip sidecars
  const srcSidecar = path.join(MP4S, clip.replace(/\.mp4$/i, '.alfheim.json'));
  if (fs.existsSync(srcSidecar)) {
    const sc = JSON.parse(fs.readFileSync(srcSidecar, 'utf8'));
    fs.writeFileSync(
      path.join(outDir, `${base}.alfheim.json`),
      JSON.stringify(
        {
          ...sc,
          t0Utc:
            events?.t0Utc ??
            (segments.length === 1
              ? sc.t0Utc + segments[0].fromMs / 1000
              : null),
          montage: { sourceMp4: clip, totalMs, segments },
          output: {
            ...(sc.output ?? {}),
            durationS: totalMs / 1000,
            frames: null,
          },
        },
        null,
        2,
      ) + '\n',
    );
  }
  if (events)
    fs.writeFileSync(
      path.join(outDir, `${base}.events.json`),
      JSON.stringify(events, null, 2) + '\n',
    );
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`done: ${outDir} (${(totalMs / 1000).toFixed(1)} s)`);
