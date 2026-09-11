#!/usr/bin/env node
// Cut one or more media windows out of synchronized clips (data/mp4s) into a
// demo folder that plays from 0: `<out>/<name>.mp4` per clip (re-encoded,
// frame-accurate; several windows are concatenated in order with the same
// cut points on every clip, so the clips stay in sync), `<out>/events.json`
// with the ground truth remapped onto the montage timeline (+ a copy per clip
// as `<name>.events.json` so the panel's GROUND TRUTH picker finds it next to
// the clip), and `<name>.rim.json` with the calibrated rim from the source
// clip's `.apidis.json` sidecar (the hoop file cam applies it on USE FILE).
//
//   node scripts/bb-clip-window.mjs --clips apidis/q2/cam7.mp4,apidis/q2/cam1.mp4 \
//        --from-s 411.65 --to-s 471.65 --events apidis/q2/events.json --out demo/left-make-420s
//   node scripts/bb-clip-window.mjs --clips apidis/q2/cam7.mp4,apidis/q2/cam1.mp4 \
//        --windows 204.35-232.35,411.65-439.65,561.3-589.3 --events apidis/q2/events.json --out demo/left-3-makes
//
// The engine cannot seek a clip beyond the pipeline's age, so "the first make
// 9 s in" has to be a file that starts there; leave ≥ 8 s before a make (the
// hoop clip runs its 3 s side-channel delay ahead after a sync and the worker
// needs a moment to re-subscribe).

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
const eventsFile = opt('events', null);
const out = opt('out', null);

// Windows in source media seconds, in montage order.
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
    'usage: bb-clip-window.mjs --clips a.mp4,b.mp4 (--from-s N --to-s M | --windows N-M,N-M,…) [--events events.json] --out <folder under data/mp4s>',
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
      '6M',
      '-allow_sw',
      '1',
      '-profile:v',
      'high',
    ]
  : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20'];

// Montage timeline: window k starts at the sum of the previous windows' lengths.
const segments = [];
let cursorMs = 0;
for (const [fromS, toS] of windows) {
  const fromMs = Math.round(fromS * 1000);
  const toMs = Math.round(toS * 1000);
  segments.push({ fromMs, toMs, startMs: cursorMs });
  cursorMs += toMs - fromMs;
}
const totalMs = cursorMs;

let events = null;
if (eventsFile) {
  const gt = JSON.parse(fs.readFileSync(path.join(MP4S, eventsFile), 'utf8'));
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
    source: `${gt.source ?? eventsFile} · ${segments.length} window(s)`,
    t0Utc:
      segments.length === 1 && gt.t0Utc != null
        ? gt.t0Utc + segments[0].fromMs / 1000
        : null,
    montage: { sourceEvents: eventsFile, totalMs, segments },
    events: remapped,
  };
  fs.writeFileSync(
    path.join(outDir, 'events.json'),
    JSON.stringify(events, null, 2) + '\n',
  );
  const throws = remapped.filter((e) => e.kind === 'throw');
  console.log(
    `events.json: ${throws.length} throws over ${(totalMs / 1000).toFixed(1)} s, made at ${
      throws
        .filter((e) => e.made)
        .map(
          (e) =>
            `${(e.tMs / 1000).toFixed(1)}s ${e.basket ?? ''} ${e.team ?? ''}`,
        )
        .join(', ') || '—'
    }`,
  );
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-clip-'));
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
        '-an',
        ...enc,
        '-pix_fmt',
        'yuv420p',
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
    // Same encoder settings on every part → lossless concat, timestamps regenerated.
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
  const sidecar = path.join(MP4S, clip.replace(/\.mp4$/i, '.apidis.json'));
  if (fs.existsSync(sidecar)) {
    const rim = JSON.parse(fs.readFileSync(sidecar, 'utf8')).rim;
    if (rim) {
      fs.writeFileSync(
        path.join(outDir, `${base}.rim.json`),
        JSON.stringify(
          { cx: rim.cx, cy: rim.cy, rx: rim.rx, ry: rim.ry, source: clip },
          null,
          2,
        ) + '\n',
      );
    }
  }
  if (events) {
    fs.writeFileSync(
      path.join(outDir, `${base}.events.json`),
      JSON.stringify(events, null, 2) + '\n',
    );
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`done: ${outDir} (${(totalMs / 1000).toFixed(1)} s)`);
