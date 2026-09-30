#!/usr/bin/env node
// OB Van demo — build the "tape" file cam: one muted highlights reel with the
// exact show duration (every OB file cam must be the same length, or the
// shared loop restarts mid-show). Sources are ordinary downloaded clips; the
// same command later swaps the Remotion stand-in for real footage.
//
//   node scripts/ob-tape-reel.mjs --timing data/ob-demo-raw/nba/nba.timing.json \
//     [--srcdir data/ob-demo-raw/nba/tape-src] [--in clip.mp4 …] \
//     [--out data/mp4s/ob-demo/nba/tape.mp4] [--duration <s>] [--height 1080] [--crf 20]
//
// Clips are normalised (fill-crop 16:9, 30 fps CFR, HDR tonemapped, audio
// dropped), concatenated in name order, looped when too short and trimmed to
// the target. The output carries a silent AAC track — the mp4 file-cam path
// requires exactly 1 video + 1 audio stream. The last stdout line is JSON.

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { SR, ffmpeg, fmtTime, probe, resolveCli } from './lib/ob-media.mjs';

const FPS = 30;
const HDR_TRANSFERS = new Set(['arib-std-b67', 'smpte2084']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv']);

const { values: opt } = parseArgs({
  options: {
    timing: { type: 'string' },
    srcdir: { type: 'string' },
    in: { type: 'string', multiple: true, default: [] },
    out: { type: 'string' },
    duration: { type: 'string' },
    height: { type: 'string', default: '1080' },
    crf: { type: 'string', default: '20' },
    fast: { type: 'boolean', default: false },
  },
});

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const quant = (s) => Math.floor(s * FPS + 1e-6) / FPS;

async function main() {
  if (!opt.timing && !opt.duration)
    fail('pass --timing <name>.timing.json (or an explicit --duration <s>)');
  const timing = opt.timing
    ? JSON.parse(readFileSync(resolveCli(opt.timing), 'utf8'))
    : null;
  const targetS = quant(Number(opt.duration ?? timing.durationS));
  if (!Number.isFinite(targetS) || targetS <= 0) fail('bad target duration');

  const srcdir = opt.srcdir
    ? resolveCli(opt.srcdir)
    : opt.timing
      ? path.join(path.dirname(resolveCli(opt.timing)), 'tape-src')
      : null;
  const sources = opt.in.length
    ? opt.in.map(resolveCli)
    : srcdir
      ? readdirSync(srcdir)
          .filter((f) => VIDEO_EXT.has(path.extname(f).toLowerCase()))
          .sort()
          .map((f) => path.join(srcdir, f))
      : [];
  if (!sources.length)
    fail(`no source clips (looked in ${srcdir ?? '--in'}) — drop mp4s there`);

  const out = resolveCli(
    opt.out ??
      path.join('data', 'mp4s', 'ob-demo', timing?.name ?? 'tape', 'tape.mp4'),
  );
  mkdirSync(path.dirname(out), { recursive: true });

  const height = Number(opt.height);
  const width = Math.round((height * 16) / 9 / 2) * 2;
  const work = mkdtempSync(path.join(os.tmpdir(), 'ob-tape-'));
  try {
    // Normalise every clip so the concat demuxer sees one format.
    const parts = [];
    for (const [i, src] of sources.entries()) {
      const info = await probe(src);
      const video = info.streams.find((s) => s.codec_type === 'video');
      if (!video) fail(`${src}: no video stream`);
      const vf = [
        ...(HDR_TRANSFERS.has(video.color_transfer)
          ? [
              'zscale=t=linear:npl=100',
              'format=gbrpf32le',
              'zscale=p=bt709',
              'tonemap=hable:desat=0',
              'zscale=t=bt709:m=bt709:r=tv',
            ]
          : []),
        `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos`,
        `crop=${width}:${height}`,
        'setsar=1',
        'format=yuv420p',
      ];
      const part = path.join(work, `part-${String(i).padStart(2, '0')}.mp4`);
      await ffmpeg([
        '-v',
        'error',
        '-i',
        src,
        '-map',
        '0:v:0',
        '-an',
        '-sn',
        '-dn',
        '-map_metadata',
        '-1',
        '-map_chapters',
        '-1',
        '-fps_mode',
        'cfr',
        '-r',
        String(FPS),
        '-vf',
        vf.join(','),
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        String(Number(opt.crf) + 2),
        '-pix_fmt',
        'yuv420p',
        part,
      ]);
      const dur = Number((await probe(part)).format.duration);
      parts.push({ file: part, durS: dur, src });
      console.log(
        `clip ${path.basename(src)} → ${dur.toFixed(2)} s${HDR_TRANSFERS.has(video.color_transfer) ? ' (tonemapped)' : ''}`,
      );
    }

    // Loop the list until it covers the show, then trim to the frame.
    const oneLoopS = parts.reduce((a, p) => a + p.durS, 0);
    if (oneLoopS <= 0) fail('sources have zero duration');
    const listEntries = [];
    for (let total = 0; total < targetS + 1; ) {
      for (const p of parts) {
        listEntries.push(`file '${p.file.replace(/'/g, "'\\''")}'`);
        total += p.durS;
      }
    }
    const list = path.join(work, 'reel.ffconcat');
    writeFileSync(list, `ffconcat version 1.0\n${listEntries.join('\n')}\n`);

    await ffmpeg([
      '-v',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      list,
      '-f',
      'lavfi',
      '-i',
      `anullsrc=r=${SR}:cl=stereo`,
      '-map',
      '0:v:0',
      '-map',
      '1:a',
      '-fps_mode',
      'cfr',
      '-r',
      String(FPS),
      '-c:v',
      'libx264',
      '-preset',
      opt.fast ? 'veryfast' : 'medium',
      '-crf',
      opt.crf,
      '-profile:v',
      'high',
      '-g',
      String(FPS * 2),
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
      targetS.toFixed(3),
      '-movflags',
      '+faststart',
      '-video_track_timescale',
      '90000',
      '-y',
      out,
    ]);

    const check = await probe(out);
    const v = check.streams.filter((s) => s.codec_type === 'video');
    const a = check.streams.filter((s) => s.codec_type === 'audio');
    const outDurS = Number(check.format.duration);
    if (v.length !== 1 || a.length !== 1)
      fail(`${out}: expected 1 video + 1 audio, got ${v.length}v/${a.length}a`);
    if (Math.abs(outDurS - targetS) > 1.5 / FPS)
      fail(
        `${out}: duration ${outDurS.toFixed(3)} s ≠ target ${targetS.toFixed(3)} s`,
      );
    console.log(
      `reel ${fmtTime(outDurS)} (${listEntries.length} segments, ${sources.length} clips) → ${path.relative(process.cwd(), out)}`,
    );
    console.log(
      JSON.stringify({
        out,
        durationS: outDurS,
        targetS,
        clips: sources.length,
        segments: listEntries.length,
      }),
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
