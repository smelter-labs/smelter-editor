#!/usr/bin/env node
// OB Van demo footage — a wide shot of a panel that was shot one person at a
// time. The wide phone stays on its tripod for every take; each persona sits
// in their own seat. This crops each take's seat column and lays it over the
// base take, so the wide shows the whole panel at once.
//
// Only works when the tripod never moved and exposure / focus / white balance
// were locked; keep seats apart and hands inside the columns. Inputs are the
// PREPPED wide takes (ob-prep-takes.mjs with the same --timing → same length,
// same resolution) — keep them outside data/mp4s, only the result is a cam.
//
//   # 1. frames with a 100 px grid, to read the seat columns off
//   node scripts/ob-wide-composite.mjs --grid data/ob-demo-raw/panel/wide/*.mp4
//   # 2. the composite
//   node scripts/ob-wide-composite.mjs --base data/ob-demo-raw/panel/wide/host.mp4 \
//     --layer data/ob-demo-raw/panel/wide/skeptic.mp4:x=700:w=440 \
//     --layer data/ob-demo-raw/panel/wide/nerd.mp4:x=1300:w=460 \
//     --out data/mp4s/ob-demo/panel/wide.mp4 [--feather 24] [--audio silent|base|mix]
//
// Audio defaults to silent: the panel runs with audio `mix`, where every cam is
// audible, so a wide carrying the voices would double them — and its voice
// activity would make the wide compete with the speakers for cuts.
// The last stdout line is a JSON summary.

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { SR, ffmpeg, probe, resolveCli } from './lib/ob-media.mjs';

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    grid: { type: 'boolean', default: false },
    at: { type: 'string', default: '30' },
    base: { type: 'string' },
    layer: { type: 'string', multiple: true, default: [] },
    out: { type: 'string' },
    feather: { type: 'string', default: '0' },
    audio: { type: 'string', default: 'silent' },
    crf: { type: 'string', default: '20' },
  },
});

function fail(msg) {
  console.error(`ob-wide-composite: ${msg}`);
  process.exit(1);
}

async function grid(files) {
  for (const f of files.map(resolveCli)) {
    const out = f.replace(/\.[^.]+$/, '.grid.png');
    await ffmpeg([
      '-v',
      'error',
      '-ss',
      opt.at,
      '-i',
      f,
      '-frames:v',
      '1',
      '-vf',
      'drawgrid=w=100:h=100:t=1:c=red@0.6,drawgrid=w=500:h=1080:t=3:c=yellow@0.8',
      out,
    ]);
    console.log(
      `${path.relative(process.cwd(), out)}  (red every 100 px, yellow every 500 px)`,
    );
  }
}

function parseLayer(spec) {
  const m = /^(.*):x=(\d+):w=(\d+)$/.exec(spec);
  if (!m) fail(`--layer ${spec}: expected <file>:x=<px>:w=<px>`);
  return { file: resolveCli(m[1]), x: Number(m[2]), w: Number(m[3]) };
}

async function main() {
  if (opt.grid) return grid(positionals);
  if (!opt.base || !opt.layer.length || !opt.out)
    fail('need --base, at least one --layer and --out (or --grid <files>)');
  if (!['silent', 'base', 'mix'].includes(opt.audio))
    fail('--audio is silent | base | mix');
  const base = resolveCli(opt.base);
  const layers = opt.layer.map(parseLayer);
  const out = resolveCli(opt.out);
  const feather = Number(opt.feather);

  const infos = await Promise.all(
    [base, ...layers.map((l) => l.file)].map(probe),
  );
  const vOf = (i) => i.streams.find((s) => s.codec_type === 'video');
  const { width, height } = vOf(infos[0]);
  const durS = Number(infos[0].format.duration);
  infos.forEach((info, k) => {
    const v = vOf(info);
    const name = k === 0 ? base : layers[k - 1].file;
    if (v.width !== width || v.height !== height)
      fail(
        `${name} is ${v.width}x${v.height}, the base is ${width}x${height} — prep them the same way`,
      );
    if (Math.abs(Number(info.format.duration) - durS) > 0.1)
      fail(
        `${name} lasts ${Number(info.format.duration).toFixed(2)} s, the base ${durS.toFixed(2)} s — prep them with the same --timing / --duration`,
      );
  });
  layers.forEach((l) => {
    if (l.x + l.w > width)
      fail(
        `layer ${path.basename(l.file)}: x+w = ${l.x + l.w} > width ${width}`,
      );
    if (feather * 2 >= l.w)
      fail(`--feather ${feather} is too wide for a ${l.w} px column`);
  });
  for (let a = 0; a < layers.length; a++)
    for (let b = a + 1; b < layers.length; b++)
      if (
        layers[a].x < layers[b].x + layers[b].w &&
        layers[b].x < layers[a].x + layers[a].w
      )
        console.warn(
          `warning: columns of ${path.basename(layers[a].file)} and ${path.basename(layers[b].file)} overlap — the later one wins`,
        );

  const tmp = mkdtempSync(path.join(os.tmpdir(), 'ob-wide-'));
  try {
    const inputs = ['-i', base, ...layers.flatMap((l) => ['-i', l.file])];
    const graph = [];
    let prev = '0:v';
    let nextInput = layers.length + 1;
    for (const [k, l] of layers.entries()) {
      const i = k + 1;
      graph.push(`[${i}:v]crop=${l.w}:${height}:${l.x}:0[c${i}]`);
      let top = `c${i}`;
      if (feather > 0) {
        const mask = path.join(tmp, `mask-${i}.png`);
        await ffmpeg([
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          `color=c=white:s=${l.w}x${height}:d=0.04`,
          '-vf',
          `format=gray,geq=lum='255*min(1\\,min(X\\,W-1-X)/${feather})'`,
          '-frames:v',
          '1',
          mask,
        ]);
        inputs.push('-loop', '1', '-framerate', '30', '-i', mask);
        graph.push(
          `[${nextInput}:v]format=gray[m${i}]`,
          `[c${i}][m${i}]alphamerge[a${i}]`,
        );
        top = `a${i}`;
        nextInput++;
      }
      graph.push(
        `[${prev}][${top}]overlay=x=${l.x}:y=0:eval=init:shortest=1[o${i}]`,
      );
      prev = `o${i}`;
    }
    graph.push(`[${prev}]format=yuv420p[v]`);
    let audioMap;
    if (opt.audio === 'base') audioMap = '0:a:0';
    else if (opt.audio === 'mix') {
      const ins = [0, ...layers.map((_, k) => k + 1)]
        .map((i) => `[${i}:a:0]`)
        .join('');
      graph.push(
        `${ins}amix=inputs=${layers.length + 1}:normalize=0:duration=first,alimiter=limit=0.95[a]`,
      );
      audioMap = '[a]';
    } else {
      inputs.push('-f', 'lavfi', '-i', `anullsrc=r=${SR}:cl=stereo`);
      audioMap = `${nextInput}:a`;
    }
    mkdirSync(path.dirname(out), { recursive: true });
    await ffmpeg([
      '-v',
      'error',
      ...inputs,
      '-filter_complex',
      graph.join(';'),
      '-map',
      '[v]',
      '-map',
      audioMap,
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      opt.crf,
      '-g',
      '60',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-ar',
      String(SR),
      '-ac',
      '2',
      '-t',
      durS.toFixed(3),
      '-movflags',
      '+faststart',
      '-video_track_timescale',
      '90000',
      out,
    ]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const check = await probe(out);
  const streams = check.streams.map((s) => s.codec_name).join('+');
  console.log(
    `${path.relative(process.cwd(), out)}: ${width}x${height}, ${Number(check.format.duration).toFixed(2)} s, ${streams}, audio ${opt.audio}`,
  );
  console.log(
    JSON.stringify({
      out,
      durS: Number(check.format.duration),
      streams,
      layers: layers.map(({ x, w, file }) => ({ file, x, w })),
      feather,
      audio: opt.audio,
    }),
  );
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
