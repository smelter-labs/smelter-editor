#!/usr/bin/env node
// OB Van demo footage — turn raw phone recordings into synced file cams.
//
// Finds the hand clap in each recording (the loudest transient near the
// start), trims every clip to start at clap + offset, cuts them all to one
// length and transcodes to what file cams want: H.264 + AAC, exactly one
// video and one audio track (a second track = INVALID_MP4_SOURCE), 30 fps
// CFR, 2 s GOP, loudness-normalised. All file cams restart together when any
// of them wraps, so equal length is a hard requirement.
//
//   # multi-take panel, timeline from ob-conductor.mjs
//   node scripts/ob-prep-takes.mjs --timing data/ob-demo-raw/panel/panel.timing.json \
//     --in ~/takes/IMG_0412.MOV=host --in ~/takes/IMG_0415.MOV=skeptic --in ~/takes/IMG_0419.MOV=nerd \
//     --outdir data/mp4s/ob-demo/panel
//
//   # gig: three phones, one performance, one clap
//   node scripts/ob-prep-takes.mjs --in a.mov=wide --in b.mov=stage-left --in c.mov=stage-right \
//     --start 1 --outdir data/mp4s/ob-demo/gig
//
// Flags:
//   --in <file>[=name]    raw recording; output <outdir>/<name>.mp4 (repeatable)
//   --outdir <dir>        where the clips go (data/mp4s/… — max one folder level below
//                         the library's first, e.g. ob-demo/panel/host.mp4)
//   --timing <json>       conductor timeline: clip start = clap + @start, length = the show;
//                         also copies the slides clip + timing.json and writes cams.json
//   --start <s>           clip start relative to the clap (default 2; without --timing)
//   --duration <s>        output length (default: timing, else the shortest common length)
//   --offset name=<s>     manual clap time in the raw file (skips detection)
//   --search <s>          seconds scanned for the clap (default 40)
//   --skip <s>            ignore the first seconds — record-button thud (default 1)
//   --gate                noise gate: silences room tone / earbud bleed between lines
//   --no-loudnorm         keep levels as recorded
//   --height 1080 --crf 20 --fast (x264 veryfast)   --dry-run (detect + report only)
//
// With --timing, each take whose name is a persona gets a sync report: how
// much of its voice lands inside that persona's slots (low = late clap,
// wrong file, or a fluffed take). The last stdout line is a JSON summary.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  MP4_DIR,
  SR,
  decodePcm,
  ffmpeg,
  fmtTime,
  probe,
  resolveCli,
} from './lib/ob-media.mjs';

const FPS = 30;
const HDR_TRANSFERS = new Set(['arib-std-b67', 'smpte2084']);
const FIXED_ROLES = [
  'wide',
  'speaker',
  'guest',
  'audience',
  'slides',
  'tape',
  'stage-left',
  'stage-right',
  'goal-left',
  'goal-right',
];

const { values: opt } = parseArgs({
  options: {
    in: { type: 'string', multiple: true, default: [] },
    outdir: { type: 'string' },
    timing: { type: 'string' },
    start: { type: 'string' },
    duration: { type: 'string' },
    offset: { type: 'string', multiple: true, default: [] },
    search: { type: 'string', default: '40' },
    skip: { type: 'string', default: '1' },
    gate: { type: 'boolean', default: false },
    'no-loudnorm': { type: 'boolean', default: false },
    height: { type: 'string', default: '1080' },
    crf: { type: 'string', default: '20' },
    fast: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
});

function fail(msg) {
  console.error(`ob-prep-takes: ${msg}`);
  process.exit(1);
}

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '') || 'take';

/**
 * Clap = the loudest 1 ms peak in [skip, search], moved back to where the
 * transient starts. Returns the time plus the runner-up peaks for a sanity check.
 */
function findClap(pcm, { skipS, blockMs = 1 }) {
  const bs = Math.max(1, Math.round((SR * blockMs) / 1000));
  const env = new Float32Array(Math.floor(pcm.length / bs));
  for (let b = 0; b < env.length; b++) {
    let p = 0;
    for (let i = b * bs; i < (b + 1) * bs; i++)
      p = Math.max(p, Math.abs(pcm[i]));
    env[b] = p;
  }
  const from = Math.round((skipS * 1000) / blockMs);
  let best = -1;
  for (let b = from; b < env.length; b++)
    if (best < 0 || env[b] > env[best]) best = b;
  if (best < 0 || env[best] <= 0) return null;
  let onset = best;
  const floor = env[best] * 0.2;
  const minB = Math.max(from, best - Math.round(30 / blockMs));
  while (onset > minB && env[onset - 1] >= floor) onset--;
  // Runner-ups: best peak per 0.5 s away from the winner.
  const cand = [];
  const win = Math.round(500 / blockMs);
  for (let s = from; s < env.length; s += win) {
    let m = s;
    for (let b = s; b < Math.min(env.length, s + win); b++)
      if (env[b] > env[m]) m = b;
    if (Math.abs(m - best) > win)
      cand.push({ tS: (m * blockMs) / 1000, peakDb: db(env[m]) });
  }
  cand.sort((a, b) => b.peakDb - a.peakDb);
  return {
    tS: (onset * blockMs) / 1000,
    peakDb: db(env[best]),
    runnersUp: cand.slice(0, 2),
  };
}

const db = (v) => (v > 0 ? 20 * Math.log10(v) : -120);

/** How much of the voice in `pcm` (show time 0 = sample 0) lands in `slots`. */
function syncReport(pcm, slots) {
  const hop = Math.round(SR * 0.1);
  const frames = [];
  for (let i = 0; i + hop <= pcm.length; i += hop) {
    let e = 0;
    for (let j = i; j < i + hop; j++) e += pcm[j] * pcm[j];
    frames.push(db(Math.sqrt(e / hop)));
  }
  const sorted = [...frames].sort((a, b) => a - b);
  const noise = sorted[Math.floor(sorted.length * 0.1)] ?? -90;
  const thr = Math.max(noise + 12, -50);
  const inSlot = (t) => slots.some(([a, b]) => t >= a - 0.3 && t <= b + 0.3);
  let inside = 0;
  let outside = 0;
  const strays = [];
  let run = null;
  frames.forEach((f, k) => {
    const t = k * 0.1;
    const active = f > thr;
    if (active && inSlot(t)) inside++;
    else if (active) {
      outside++;
      if (run && t - run.end <= 0.2) run.end = t;
      else {
        if (run && run.end - run.start >= 0.4) strays.push(run);
        run = { start: t, end: t };
      }
    }
  });
  if (run && run.end - run.start >= 0.4) strays.push(run);
  const total = inside + outside;
  return {
    voicedS: total / 10,
    insidePct: total ? Math.round((100 * inside) / total) : null,
    strays: strays
      .sort((a, b) => b.end - b.start - (a.end - a.start))
      .slice(0, 3)
      .map((r) => `${fmtTime(r.start)}–${fmtTime(r.end + 0.1)}`),
  };
}

/**
 * TALK's "lower third on a new voice" needs 1.5 s of speech OFF program, but
 * the auto pilot cuts to a new speaker before their first syllable — so for
 * the demo: a name on every fresh cut to someone speaking during the first
 * segment. (Rules look a side-channel delay ahead while the segment changes
 * on air, so the script keeps a new face out of the first ~8 s after it.)
 */
function introLowerThirds(timing) {
  const first = timing.rundown?.[0]?.title;
  if (!first) return { 'lt-new-voice': { cooldownMs: 10000 } };
  return {
    'lt-new-voice': {
      name: `Lower thirds during "${first}"`,
      cooldownMs: 4000,
      when: {
        all: [
          { signal: 'segment', op: '==', value: first },
          { signal: 'speech', cam: 'program', forMs: 1200 },
          { signal: 'hold', op: '<', value: 3000 },
        ],
      },
      then: { lowerThird: { cam: 'trigger', mode: 'talent', holdMs: 5000 } },
    },
  };
}

async function loudnormMeasure(file, startAt, durS, pre) {
  const { stderr } = await ffmpeg([
    '-ss',
    startAt.toFixed(3),
    '-i',
    file,
    '-t',
    durS.toFixed(3),
    '-map',
    '0:a:0',
    '-af',
    [...pre, 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json'].join(','),
    '-f',
    'null',
    '-',
  ]);
  const json = stderr.slice(
    stderr.lastIndexOf('{'),
    stderr.lastIndexOf('}') + 1,
  );
  const m = JSON.parse(json);
  if (!Number.isFinite(Number(m.input_i))) return null; // pure silence
  return m;
}

async function main() {
  if (!opt.in.length || !opt.outdir)
    fail(
      'need --in <file>[=name] (repeatable) and --outdir <dir> (see the header)',
    );
  const outDir = resolveCli(opt.outdir);
  const libRel = path.relative(MP4_DIR, outDir);
  const inLibrary = !libRel.startsWith('..') && !path.isAbsolute(libRel);
  if (inLibrary && libRel.split(path.sep).filter(Boolean).length > 2)
    fail(
      `--outdir ${libRel} is too deep: mp4-cam accepts at most two folders under data/mp4s (e.g. ob-demo/panel)`,
    );
  if (!inLibrary)
    console.warn(
      `note: ${outDir} is outside data/mp4s — file cams will not find these clips there`,
    );

  const timing = opt.timing
    ? JSON.parse(readFileSync(resolveCli(opt.timing), 'utf8'))
    : null;
  const startOffset = timing ? timing.startOffsetS : Number(opt.start ?? 2);
  const offsets = new Map(
    opt.offset.map((o) => {
      const [k, v] = o.split('=');
      return [slug(k), Number(v)];
    }),
  );

  const takes = [];
  for (const spec of opt.in) {
    const eq = spec.lastIndexOf('=');
    const file = resolveCli(eq > 0 ? spec.slice(0, eq) : spec);
    const name = slug(eq > 0 ? spec.slice(eq + 1) : path.basename(file));
    if (!existsSync(file)) fail(`no such file: ${file}`);
    if (takes.some((t) => t.name === name)) fail(`two takes named ${name}`);
    const info = await probe(file);
    const video = info.streams.find(
      (s) => s.codec_type === 'video' && !s.disposition?.attached_pic,
    );
    const audios = info.streams.filter((s) => s.codec_type === 'audio');
    if (!video) fail(`${file}: no video stream`);
    takes.push({
      file,
      name,
      info,
      video,
      hasAudio: audios.length > 0,
      extraTracks: info.streams.length - 1 - Math.min(1, audios.length),
      durS: Number(info.format.duration),
    });
  }

  // Clap detection.
  for (const t of takes) {
    const manual =
      offsets.get(t.name) ?? offsets.get(slug(path.basename(t.file)));
    if (manual != null && Number.isFinite(manual)) {
      t.clap = { tS: manual, manual: true };
    } else {
      if (!t.hasAudio)
        fail(
          `${t.name}: no audio to find the clap in — pass --offset ${t.name}=<seconds>`,
        );
      const pcm = await decodePcm(t.file, {
        durS: Math.min(Number(opt.search), t.durS),
      });
      const c = findClap(pcm, { skipS: Number(opt.skip) });
      if (!c || c.peakDb < -30)
        fail(
          `${t.name}: no clap found in the first ${opt.search} s (loudest ${c ? c.peakDb.toFixed(0) : '-inf'} dBFS) — pass --offset ${t.name}=<seconds>`,
        );
      t.clap = c;
    }
    t.startAt = t.clap.tS + startOffset;
    t.availS = t.durS - t.startAt;
    if (t.startAt < 0)
      fail(
        `${t.name}: clip would start before the recording (clap at ${t.clap.tS.toFixed(2)} s, start offset ${startOffset} s)`,
      );
  }

  const frames = (s) => Math.floor(s * FPS + 1e-6);
  const wanted = opt.duration
    ? Number(opt.duration)
    : timing
      ? timing.durationS
      : Math.min(...takes.map((t) => t.availS));
  const durS = frames(wanted) / FPS;
  const short = takes.filter((t) => t.availS + 1e-3 < durS);
  if (short.length)
    fail(
      `recording too short for a ${durS.toFixed(2)} s clip: ${short
        .map(
          (t) => `${t.name} (${t.availS.toFixed(2)} s after the start point)`,
        )
        .join(', ')} — pass a shorter --duration or re-shoot`,
    );

  console.log(
    `clip length ${fmtTime(durS)} (${frames(wanted)} frames), start = clap + ${startOffset} s\n`,
  );
  console.log('take          clap      peak    start     raw len   notes');
  for (const t of takes) {
    const notes = [];
    if (t.clap.manual) notes.push('manual offset');
    else if (
      t.clap.runnersUp?.[0] &&
      t.clap.runnersUp[0].peakDb > t.clap.peakDb - 3
    )
      notes.push(
        `close runner-up at ${t.clap.runnersUp[0].tS.toFixed(2)} s — check`,
      );
    if (HDR_TRANSFERS.has(t.video.color_transfer))
      notes.push('HDR → tone-mapped');
    if (t.extraTracks > 0)
      notes.push(`${t.extraTracks} extra track(s) dropped`);
    if (!t.hasAudio) notes.push('no audio → silent track');
    const rot = t.video.side_data_list?.find(
      (d) => d.rotation != null,
    )?.rotation;
    if (rot) notes.push(`rotated ${rot}°`);
    t.notes = notes;
    console.log(
      `${t.name.padEnd(12)}  ${t.clap.tS.toFixed(3).padStart(7)}s  ${t.clap.peakDb != null ? `${t.clap.peakDb.toFixed(0)}dB`.padStart(5) : '   - '}  ${t.startAt.toFixed(2).padStart(7)}s  ${t.durS.toFixed(1).padStart(7)}s   ${notes.join('; ')}`,
    );
  }
  if (opt['dry-run']) {
    console.log(
      JSON.stringify({
        dryRun: true,
        durS,
        takes: takes.map(({ name, file, clap, startAt }) => ({
          name,
          file,
          clap,
          startAt,
        })),
      }),
    );
    return;
  }

  mkdirSync(outDir, { recursive: true });
  const height = Number(opt.height);
  for (const t of takes) {
    const out = path.join(outDir, `${t.name}.mp4`);
    const pre = opt.gate
      ? ['agate=threshold=0.015:ratio=6:attack=5:release=300:range=0.05']
      : [];
    const af = ['aresample=48000', ...pre];
    if (t.hasAudio && !opt['no-loudnorm']) {
      const m = await loudnormMeasure(t.file, t.startAt, durS, pre);
      if (m)
        af.push(
          `loudnorm=I=-16:TP=-1.5:LRA=11:linear=true:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}`,
          'aresample=48000',
        );
    }
    const vf = [
      ...(HDR_TRANSFERS.has(t.video.color_transfer)
        ? [
            'zscale=t=linear:npl=100',
            'format=gbrpf32le',
            'zscale=p=bt709',
            'tonemap=hable:desat=0',
            'zscale=t=bt709:m=bt709:r=tv',
          ]
        : []),
      `scale=-2:${height}:flags=lanczos`,
      'setsar=1',
      'format=yuv420p',
    ];
    const args = [
      '-v',
      'error',
      '-ss',
      t.startAt.toFixed(3),
      '-i',
      t.file,
      ...(t.hasAudio
        ? []
        : ['-f', 'lavfi', '-i', `anullsrc=r=${SR}:cl=stereo`]),
      '-map',
      '0:v:0',
      '-map',
      t.hasAudio ? '0:a:0' : '1:a',
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
      ...(t.hasAudio ? ['-af', af.join(',')] : []),
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
      durS.toFixed(3),
      '-movflags',
      '+faststart',
      '-video_track_timescale',
      '90000',
      out,
    ];
    console.log(`\nencoding ${t.name} → ${path.relative(process.cwd(), out)}`);
    await ffmpeg(args);
    const check = await probe(out);
    const v = check.streams.filter((s) => s.codec_type === 'video');
    const a = check.streams.filter((s) => s.codec_type === 'audio');
    t.out = out;
    t.outDurS = Number(check.format.duration);
    t.outStreams = `${v.length}×${v[0]?.codec_name} ${v[0]?.width}x${v[0]?.height} + ${a.length}×${a[0]?.codec_name}`;
    if (v.length !== 1 || a.length !== 1)
      fail(`${out}: expected 1 video + 1 audio, got ${t.outStreams}`);
  }

  // Sync report against the conductor's slots.
  if (timing) {
    for (const t of takes) {
      const persona = timing.personas.find((p) => slug(p.key) === t.name);
      if (!persona || !t.hasAudio) continue;
      const slots = timing.events
        .filter(
          (e) =>
            (e.kind === 'line' && e.who === persona.key) || e.kind === 'all',
        )
        .map((e) => [e.startS, e.endS]);
      t.sync = syncReport(await decodePcm(t.out), slots);
    }
  }

  // Slides + timing + a cams.json template next to the clips.
  let slides = null;
  if (inLibrary && timing?.slidesFile) {
    const src = path.join(
      path.dirname(resolveCli(opt.timing)),
      timing.slidesFile,
    );
    if (existsSync(src)) {
      slides = path.join(outDir, 'slides.mp4');
      // Re-encoded to the takes' exact length: file cams loop natively (and
      // stay in sync) only while their lengths match.
      await ffmpeg([
        '-v',
        'error',
        '-i',
        src,
        '-t',
        durS.toFixed(3),
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '18',
        '-tune',
        'stillimage',
        '-g',
        String(FPS * 2),
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-ar',
        String(SR),
        '-ac',
        '2',
        '-movflags',
        '+faststart',
        '-video_track_timescale',
        '90000',
        slides,
      ]);
    }
  }
  if (inLibrary && timing)
    writeFileSync(
      path.join(outDir, 'timing.json'),
      `${JSON.stringify(timing, null, 2)}\n`,
    );
  const camsPath = path.join(outDir, 'cams.json');
  let wroteCams = false;
  if (inLibrary && !existsSync(camsPath)) {
    const cams = takes.map((t) => {
      const p = timing?.personas.find((q) => slug(q.key) === t.name);
      const role = p?.role ?? (FIXED_ROLES.includes(t.name) ? t.name : 'guest');
      return {
        file: `${t.name}.mp4`,
        role,
        name: t.name.toUpperCase().slice(0, 24),
        talent: p?.talent ?? null,
        subtitle: p?.subtitle ?? null,
      };
    });
    if (slides)
      cams.push({
        file: 'slides.mp4',
        role: 'slides',
        name: 'SLIDES',
        talent: null,
      });
    if (timing && !cams.some((c) => c.role === 'wide'))
      cams.push({
        file: 'wide.mp4',
        role: 'wide',
        name: 'WIDE',
        talent: null,
        optional: true,
      });
    if (timing && !cams.some((c) => c.role === 'tape'))
      // ob-tape-reel.mjs writes it; ob-demo-run skips missing optional files.
      cams.push({
        file: 'tape.mp4',
        role: 'tape',
        name: 'THE TAPE',
        talent: null,
        optional: true,
      });
    const manifest = {
      eventName: timing?.title ?? path.basename(outDir).toUpperCase(),
      presetId: timing ? 'talk' : 'gig',
      captions: Boolean(timing),
      audio: timing
        ? { mode: 'mix' }
        : { mode: 'master', cam: cams[0]?.role ?? 'wide' },
      brief: '',
      firstShot: timing ? (slides ? 'slides' : 'wide') : cams[0]?.role,
      ruleOverrides: timing ? introLowerThirds(timing) : {},
      // Transcripts drive the keyword rules; on the tiles they would cover the
      // lower thirds and show a whole segment before it is spoken.
      config: timing ? { subtitles: false } : {},
      // Extra --check beats (harmless when the optional cam is missing).
      ...(timing ? { checks: { soloRoles: ['tape'] } } : {}),
      cams,
    };
    writeFileSync(camsPath, `${JSON.stringify(manifest, null, 2)}\n`);
    wroteCams = true;
  }

  console.log(
    '\ntake          out len    streams                          voice in own slots',
  );
  for (const t of takes) {
    const sync = t.sync
      ? `${t.sync.insidePct ?? '-'}% of ${t.sync.voicedS.toFixed(0)} s${t.sync.strays.length ? ` · stray voice ${t.sync.strays.join(', ')}` : ''}`
      : '';
    console.log(
      `${t.name.padEnd(12)}  ${t.outDurS.toFixed(3).padStart(8)}s  ${t.outStreams.padEnd(32)} ${sync}`,
    );
  }
  const lens = takes.map((t) => t.outDurS);
  if (Math.max(...lens) - Math.min(...lens) > 1.5 / FPS)
    console.warn('WARNING: output lengths differ by more than a frame');
  if (slides)
    console.log(`slides      → ${path.relative(process.cwd(), slides)}`);
  if (inLibrary)
    console.log(
      `cams.json   ${wroteCams ? 'written (edit roles / talent)' : 'kept (already there)'} → ${path.relative(process.cwd(), camsPath)}`,
    );
  console.log(
    JSON.stringify({
      outDir,
      durS,
      takes: takes.map((t) => ({
        name: t.name,
        clapS: t.clap.tS,
        startAt: t.startAt,
        out: t.out,
        outDurS: t.outDurS,
        sync: t.sync ?? null,
        notes: t.notes,
      })),
      slides,
      cams: inLibrary ? camsPath : null,
    }),
  );
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
