#!/usr/bin/env node
// Turn the Alfheim dataset's 3-second H.264 segments into one true-time,
// constant-fps MP4 per camera that Touchline's file cameras can play.
//
// Segment names carry the wall-clock start of each 3 s chunk; the cadence is
// 3.000 s on average but jitters by tens of ms, so instead of trusting the
// nominal frame rate end to end the pipeline anchors every segment on its
// own timestamp (same tools as scripts/apidis-prep.mjs):
//
//   1. byte-concatenate the raw Annex-B segments   → cam.h264
//   2. per-frame timestamps v2 from segment names   → cam.ts.txt (frame i of segment k = start_k + i/fps)
//   3. mkvmerge --timestamps                        → cam.mkv   (lossless, true timestamps)
//   4. ffmpeg -ss/-t -fps_mode cfr [-vf scale]      → cam.mp4   (frame 0 = t0, constant fps)
//
// Media time of every output = wall clock − t0 (t0 = --from or the first
// segment), identical across cameras of a session; the `<name>.alfheim.json`
// sidecar records it for alfheim-telemetry.mjs / alfheim-events.mjs.
//
//   node scripts/alfheim-prep.mjs --set pano --archive ~/…/pzpn/alfheim \
//        --out data/mp4s/fb/pano-2013-11-28 [--scale 0.5 --name pano-half] \
//        [--from 19:05:00 --to 19:15:00] [--bitrate 12M] [--encoder videotoolbox|libx264] \
//        [--stills --still-at 30] [--limit-segments N] [--keep-intermediate] [--dry-run]
//   node scripts/alfheim-prep.mjs --set tricam --cams 0,1,2 --archive … --out data/mp4s/fb/tricam-2013-11-03
//
// Needs ffmpeg/ffprobe and mkvmerge (brew install mkvtoolnix).
// Dataset: Alfheim (Simula) — non-commercial research use only.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { SESSIONS, listLocalSegments, parseWhen } from './lib/alfheim.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);

const DEFAULT_ARCHIVE = path.join(
  os.homedir(),
  'workspace/streaming/workshops/workshop_5/pzpn/alfheim',
);
const setName = opt('set', null);
const archive = opt('archive', process.env.ALFHEIM_DIR ?? DEFAULT_ARCHIVE);
const outDir = opt('out', null);
const session = SESSIONS[setName];
if (!session || !outDir) {
  console.error(
    'usage: alfheim-prep.mjs --set pano|tricam --out <dir> [--archive <dir>] [--cams pano|0,1,2] [--from HH:MM:SS] [--to HH:MM:SS] [--scale 0.5] [--name <base>] [--fps N] [--bitrate 12M] [--encoder videotoolbox|libx264] [--stills] [--still-at 30] [--limit-segments N] [--keep-intermediate] [--dry-run]',
  );
  process.exit(2);
}
const camKeys = opt('cams', Object.keys(session.cams).join(','))
  .split(',')
  .map((s) => s.trim())
  .filter((k) => session.cams[k]);
const scale = Number(opt('scale', '1'));
const nameOverride = opt('name', null);
const fps = Number(opt('fps', String(session.fps)));
const encoder = opt('encoder', 'auto');
const bitrate = opt('bitrate', '12M');
const stillAt = Number(opt('still-at', '30'));
const limitSegments = opt('limit-segments', null)
  ? Number(opt('limit-segments'))
  : null;
const dryRun = flag('dry-run');
const keep = flag('keep-intermediate');
const stills = flag('stills');
const fromMs = parseWhen(opt('from', null), session.match);
const toMs = parseWhen(opt('to', null), session.match);
if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
  console.error('bad --from/--to (HH:MM:SS local, ISO, or epoch seconds)');
  process.exit(2);
}

// ── helpers ──────────────────────────────────────────────────────────────

const sh = (cmd, cmdArgs, { quiet } = {}) => {
  const line = [cmd, ...cmdArgs]
    .map((a) => (/[\s'"]/.test(a) ? JSON.stringify(a) : a))
    .join(' ');
  console.log(`$ ${line}`);
  if (dryRun) return { status: 0 };
  const res = spawnSync(cmd, cmdArgs, {
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  return res;
};
const have = (cmd) =>
  spawnSync('which', [cmd], { stdio: 'ignore' }).status === 0;
const countPackets = (file) =>
  Number(
    execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-count_packets',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=nb_read_packets',
        '-of',
        'csv=p=0',
        file,
      ],
      { encoding: 'utf8' },
    ).trim(),
  );

function pickEncoder() {
  if (encoder !== 'auto') return encoder;
  const list = dryRun
    ? ''
    : execFileSync('ffmpeg', ['-hide_banner', '-encoders'], {
        encoding: 'utf8',
      });
  return /h264_videotoolbox/.test(list) ? 'videotoolbox' : 'libx264';
}
const encArgs = (enc) =>
  enc === 'videotoolbox'
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

/** Byte-concatenate raw Annex-B files (what the dataset page suggests). */
function catFiles(files, dest) {
  const fd = fs.openSync(dest, 'w');
  try {
    for (const f of files) fs.writeSync(fd, fs.readFileSync(f));
  } finally {
    fs.closeSync(fd);
  }
}

// ── per camera ───────────────────────────────────────────────────────────

const enc = pickEncoder();
if (!dryRun && !have('mkvmerge')) {
  console.error('mkvmerge not found — brew install mkvtoolnix');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
const work = path.join(outDir, '.work');
fs.mkdirSync(work, { recursive: true });

for (const camKey of camKeys) {
  const cam = session.cams[camKey];
  const dir = path.join(archive, cam.dir);
  let segments = listLocalSegments(dir);
  if (limitSegments != null) segments = segments.slice(0, limitSegments);
  if (segments.length === 0) {
    console.error(`${camKey}: no segments under ${dir}`);
    process.exitCode = 1;
    continue;
  }
  // Contiguity check: the fetch may still be running / have holes.
  const holes = [];
  for (let i = 1; i < segments.length; i++) {
    if (segments[i].index !== segments[i - 1].index + 1)
      holes.push(segments[i - 1].index + 1);
  }
  if (holes.length) {
    console.warn(
      `${camKey}: ${holes.length} missing segment(s) (first: ${holes.slice(0, 5).join(', ')}) — output timing will bridge them with held frames`,
    );
  }
  const segStartMs = segments.map((s) => s.wallMs);
  const tFirstMs = segStartMs[0];
  const nominalEndMs =
    segStartMs[segStartMs.length - 1] +
    (session.framesPerSegment / session.fps) * 1000;
  const t0Ms = fromMs ?? tFirstMs;
  const t1Ms = toMs ?? nominalEndMs;
  if (!(t1Ms > t0Ms)) {
    console.error(`${camKey}: empty window`);
    process.exitCode = 1;
    continue;
  }
  const inWindow = segments.filter(
    (s) =>
      s.wallMs + (session.framesPerSegment / session.fps) * 1000 >= t0Ms &&
      s.wallMs <= t1Ms,
  );
  if (inWindow.length === 0) {
    console.error(`${camKey}: no segments overlap the window`);
    process.exitCode = 1;
    continue;
  }
  const winFirstMs = inWindow[0].wallMs;
  const baseName =
    nameOverride ?? (camKey === 'pano' ? 'pano' : `cam${camKey}`);
  const base = path.join(outDir, baseName);
  const h264 = path.join(work, `${baseName}.h264`);
  const tsFile = path.join(work, `${baseName}.ts.txt`);
  const mkv = path.join(work, `${baseName}.mkv`);
  const mp4 = `${base}.mp4`;
  console.log(
    `\n=== ${camKey} (${cam.role}): ${inWindow.length} segments ${inWindow[0].name.slice(0, 4)}…${inWindow[inWindow.length - 1].name.slice(0, 4)}, ` +
      `t0 ${new Date(t0Ms).toISOString()} → ${new Date(t1Ms).toISOString()} (${((t1Ms - t0Ms) / 1000).toFixed(1)} s)`,
  );

  // 1. lossless join
  console.log(`$ cat ${inWindow.length} segments > ${h264}`);
  if (!dryRun)
    catFiles(
      inWindow.map((s) => s.file),
      h264,
    );

  // 2. timestamps v2: frame i of segment k at start_k + i/fps (ms, relative to the
  //    first joined frame, strictly increasing). If the joined packet count does
  //    not match the nominal frames-per-segment, count every segment.
  let perSegment = inWindow.map(() => session.framesPerSegment);
  if (!dryRun) {
    const n = countPackets(h264);
    const nominal = inWindow.length * session.framesPerSegment;
    if (n !== nominal) {
      console.warn(
        `${camKey}: joined stream has ${n} frames, nominal ${nominal} — counting per segment`,
      );
      perSegment = inWindow.map((s) => countPackets(s.file));
      const sum = perSegment.reduce((a, b) => a + b, 0);
      if (sum !== n)
        console.warn(
          `${camKey}: WARNING per-segment sum ${sum} != joined ${n}`,
        );
    } else {
      console.log(
        `${camKey}: ${n} frames == ${inWindow.length} × ${session.framesPerSegment} ✓`,
      );
    }
  }
  const lines = ['# timestamp format v2'];
  let prev = -1;
  let frames = 0;
  for (let k = 0; k < inWindow.length; k++) {
    const start = inWindow[k].wallMs - winFirstMs;
    for (let i = 0; i < perSegment[k]; i++) {
      let v = Math.round(start + (i * 1000) / fps);
      if (v <= prev) v = prev + 1;
      prev = v;
      lines.push(String(v));
      frames++;
    }
  }
  if (!dryRun) fs.writeFileSync(tsFile, lines.join('\n') + '\n');

  // 3. true timestamps, lossless
  const mm = sh('mkvmerge', ['-o', mkv, '--timestamps', `0:${tsFile}`, h264], {
    quiet: true,
  });
  if (mm.status === 2) {
    console.error(`${camKey}: mkvmerge failed\n${mm.stderr?.toString() ?? ''}`);
    process.exitCode = 1;
    continue;
  }

  // 4. frame 0 = t0, constant fps (+ optional downscale)
  const vf = [];
  if (scale !== 1)
    vf.push(`scale=trunc(iw*${scale}/2)*2:trunc(ih*${scale}/2)*2`);
  sh('ffmpeg', [
    '-y',
    '-loglevel',
    'warning',
    '-stats',
    '-ss',
    ((t0Ms - winFirstMs) / 1000).toFixed(3),
    '-i',
    mkv,
    '-t',
    ((t1Ms - t0Ms) / 1000).toFixed(3),
    '-fps_mode',
    'cfr',
    '-r',
    String(fps),
    ...(vf.length ? ['-vf', vf.join(',')] : []),
    ...encArgs(enc),
    '-g',
    String(fps * 2),
    '-pix_fmt',
    'yuv420p',
    '-an',
    '-movflags',
    '+faststart',
    mp4,
  ]);

  // Verify + sidecar
  let outInfo = null;
  if (!dryRun && fs.existsSync(mp4)) {
    const s = JSON.parse(
      execFileSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-select_streams',
          'v:0',
          '-show_entries',
          'stream=width,height,avg_frame_rate,nb_frames,duration',
          '-of',
          'json',
          mp4,
        ],
        { encoding: 'utf8' },
      ),
    ).streams[0];
    outInfo = {
      width: s.width,
      height: s.height,
      avgFrameRate: s.avg_frame_rate,
      frames: Number(s.nb_frames),
      durationS: Number(s.duration),
    };
    console.log(
      `${camKey}: ${mp4} → ${s.width}x${s.height} ${s.avg_frame_rate} fps, ${s.nb_frames} frames, ${Number(s.duration).toFixed(2)} s (expected ${((t1Ms - t0Ms) / 1000).toFixed(2)} s)`,
    );
  }
  const srcW = camKey === 'pano' ? session.pano.w : 1280;
  const srcH = camKey === 'pano' ? session.pano.h : 960;
  const sidecar = {
    dataset: 'alfheim',
    session: session.session,
    sessionId: setName,
    period: session.period ?? 1,
    match: session.title,
    cam: camKey === 'pano' ? 'pano' : Number(camKey),
    role: cam.role,
    t0Utc: t0Ms / 1000,
    t0Iso: new Date(t0Ms).toISOString(),
    t1Utc: t1Ms / 1000,
    fps,
    width: outInfo?.width ?? Math.round(srcW * scale),
    height: outInfo?.height ?? Math.round(srcH * scale),
    scale,
    ...(session.pano
      ? { panoWidth: session.pano.w, panoHeight: session.pano.h }
      : {}),
    timing: 'cfr',
    encoder: enc,
    bitrate: enc === 'videotoolbox' ? bitrate : null,
    homeTeam: session.home,
    awayTeam: session.away,
    // Filled in by alfheim-events.mjs (--attacks-left) once the side is known.
    attacksLeftInPano: null,
    output: outInfo,
    source: {
      segments: inWindow.length,
      firstSegment: inWindow[0].name,
      lastSegment: inWindow[inWindow.length - 1].name,
      firstSegmentUtc: winFirstMs / 1000,
      frames,
      holes,
    },
  };
  if (!dryRun)
    fs.writeFileSync(
      `${base}.alfheim.json`,
      JSON.stringify(sidecar, null, 2) + '\n',
    );

  if (stills && !dryRun && fs.existsSync(mp4)) {
    sh(
      'ffmpeg',
      [
        '-y',
        '-loglevel',
        'error',
        '-ss',
        String(stillAt),
        '-i',
        mp4,
        '-frames:v',
        '1',
        '-update',
        '1',
        `${base}.jpg`,
      ],
      { quiet: true },
    );
  }
  if (!keep && !dryRun) {
    for (const f of [h264, tsFile, mkv]) fs.rmSync(f, { force: true });
  }
}
if (!keep && !dryRun) fs.rmSync(work, { recursive: true, force: true });
