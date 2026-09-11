#!/usr/bin/env node
// Cut a media window out of synchronized clips (data/mp4s) into a demo folder
// that plays from 0: `<out>/<name>.mp4` per clip (re-encoded, frame-accurate),
// `<out>/events.json` with the ground truth shifted onto the window (+ a copy
// per clip as `<name>.events.json` so the panel's GROUND TRUTH picker finds
// it next to the clip), and `<name>.rim.json` with the calibrated rim from
// the source clip's `.apidis.json` sidecar (the hoop file cam applies it).
//
//   node scripts/bb-clip-window.mjs --clips apidis/q2/cam7.mp4,apidis/q2/cam1.mp4 \
//        --from-s 414 --to-s 474 --events apidis/q2/events.json --out demo/cam7-make-420
//
// The engine cannot seek a clip beyond the pipeline's age, so "the first make
// 6 s in" has to be a file that starts there.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
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
const fromS = Number(opt('from-s', NaN));
const toS = Number(opt('to-s', NaN));
const eventsFile = opt('events', null);
const out = opt('out', null);
if (
  !clips.length ||
  !Number.isFinite(fromS) ||
  !Number.isFinite(toS) ||
  !(toS > fromS) ||
  !out
) {
  console.error(
    'usage: bb-clip-window.mjs --clips a.mp4,b.mp4 --from-s N --to-s M [--events events.json] --out <folder under data/mp4s>',
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
const fromMs = Math.round(fromS * 1000);

let events = null;
if (eventsFile) {
  const gt = JSON.parse(fs.readFileSync(path.join(MP4S, eventsFile), 'utf8'));
  const inWindow = gt.events
    .filter((e) => e.tMs >= fromMs && e.tMs <= toS * 1000)
    .map((e) => ({
      ...e,
      tMs: e.tMs - fromMs,
      ...(e.startMs != null ? { startMs: e.startMs - fromMs } : {}),
      ...(e.endMs != null ? { endMs: e.endMs - fromMs } : {}),
    }));
  events = {
    ...gt,
    source: `${gt.source ?? eventsFile} · window ${fromS}–${toS} s`,
    t0Utc: gt.t0Utc != null ? gt.t0Utc + fromS : null,
    window: { sourceEvents: eventsFile, fromMs, toMs: Math.round(toS * 1000) },
    events: inWindow,
  };
  fs.writeFileSync(
    path.join(outDir, 'events.json'),
    JSON.stringify(events, null, 2) + '\n',
  );
  const throws = inWindow.filter((e) => e.kind === 'throw');
  console.log(
    `events.json: ${throws.length} throws, made at ${
      throws
        .filter((e) => e.made)
        .map(
          (e) =>
            (e.tMs / 1000).toFixed(1) +
            's ' +
            (e.basket ?? '') +
            ' ' +
            (e.team ?? ''),
        )
        .join(', ') || '—'
    }`,
  );
}

for (const clip of clips) {
  const base = path.basename(clip).replace(/\.mp4$/i, '');
  const dst = path.join(outDir, `${base}.mp4`);
  console.log(`cutting ${clip} ${fromS}–${toS} s → ${out}/${base}.mp4`);
  execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-ss',
      String(fromS),
      '-to',
      String(toS),
      '-i',
      path.join(MP4S, clip),
      '-an',
      ...enc,
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      dst,
    ],
    { stdio: 'inherit' },
  );
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
console.log(`done: ${outDir}`);
