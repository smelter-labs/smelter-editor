#!/usr/bin/env node
// Turn the APIDIS dataset's per-minute H.264 AVIs into one true-time,
// constant-fps MP4 per camera that Blacktop's file cameras can play.
//
// The AVIs claim 25 fps but the capture dropped frames (17–23 fps in
// practice), so a plain `-c copy` remux plays 1.08–1.45× too fast and the
// cameras drift apart by minutes. The real UTC of every frame is in the
// `.avi.idx` sidecars, so the pipeline is (all off-the-shelf tools):
//
//   1. ffmpeg concat (-c copy)          → cam.h264   lossless join of the minute files
//   2. .idx → mkvmerge "timestamp v2"   → cam.ts.txt one ms per frame, relative to the first frame
//   3. mkvmerge --timestamps            → cam.mkv    lossless, true (VFR) timestamps
//   4. ffmpeg -ss/-t -fps_mode cfr      → cam.mp4    frame 0 = --from, constant --fps
//
// Media time of every output = UTC − t0 (t0 = --from), identical across cams,
// which is what apidis-events.mjs writes into events.json.
//
//   node scripts/apidis-prep.mjs --archive ~/…/pzpn/archive --cams 7,5,3,1,6 \
//        --from 2008-04-09T16:46:00Z --to 2008-04-09T17:04:30Z \
//        --out data/mp4s/apidis/q2 [--fps 25] [--scale 1600:1200] \
//        [--encoder videotoolbox|libx264] [--mode cfr|naive] [--stills] \
//        [--keep-intermediate] [--dry-run]
//
// --mode naive = concat -c copy straight into an mp4 (nominal timing; only
// for "does the game accept this clip" smoke tests; the sidecar says so).
//
// Needs ffmpeg/ffprobe and mkvmerge (brew install mkvtoolnix).
// Dataset: APIDIS (UCLouvain, 2008) — non-commercial research use only.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);

const archive = opt('archive', process.env.APIDIS_DIR);
const day = opt('day', '20080409');
const cams = opt('cams', '7')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => n >= 1 && n <= 7);
const fromIso = opt('from', null);
const toIso = opt('to', null);
const outDir = opt('out', null);
const fps = Number(opt('fps', '25'));
const scale = opt('scale', null); // e.g. 1280:960
const encoder = opt('encoder', 'auto'); // videotoolbox | libx264 | auto
const mode = opt('mode', 'cfr'); // cfr | naive
const bitrate = opt('bitrate', '6M');
const stillAt = Number(opt('still-at', '30'));
const dryRun = flag('dry-run');
const keep = flag('keep-intermediate');
const stills = flag('stills');

if (!archive || !fromIso || !toIso || !outDir || cams.length === 0) {
  console.error(
    'usage: apidis-prep.mjs --archive <dir> --cams 7,5 --from <ISO> --to <ISO> --out <dir> [--fps 25] [--scale W:H] [--encoder videotoolbox|libx264] [--mode cfr|naive] [--stills] [--keep-intermediate] [--dry-run]',
  );
  process.exit(2);
}
const t0 = Date.parse(fromIso) / 1000;
const t1 = Date.parse(toIso) / 1000;
if (!(t1 > t0)) {
  console.error('bad --from/--to');
  process.exit(2);
}

// ── helpers ──────────────────────────────────────────────────────────────

const sh = (cmd, cmdArgs, { quiet } = {}) => {
  const line = [cmd, ...cmdArgs].map((a) => (/[\s'"]/.test(a) ? JSON.stringify(a) : a)).join(' ');
  console.log(`$ ${line}`);
  if (dryRun) return { status: 0 };
  const res = spawnSync(cmd, cmdArgs, {
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  return res;
};
const probe = (file, entries, stream = 'v:0') =>
  dryRun
    ? ''
    : execFileSync(
        'ffprobe',
        ['-v', 'error', '-select_streams', stream, '-show_entries', entries, '-of', 'default=nw=1:nk=1', file],
        { encoding: 'utf8' },
      ).trim();
const have = (cmd) =>
  spawnSync('which', [cmd], { stdio: 'ignore' }).status === 0;

/** Parse an APIDIS .idx: 12-byte header, then 24-byte LE records. */
function readIdx(file) {
  const buf = fs.readFileSync(file);
  const n = Math.floor((buf.length - 12) / 24);
  const times = new Array(n);
  for (let i = 0; i < n; i++) {
    const off = 12 + 24 * i;
    const sec = buf.readUInt32LE(off);
    const usec = buf.readUInt32LE(off + 4);
    times[i] = sec + usec / 1e6;
  }
  return times;
}

function pickEncoder() {
  if (encoder !== 'auto') return encoder;
  const list = dryRun
    ? ''
    : execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  return /h264_videotoolbox/.test(list) ? 'videotoolbox' : 'libx264';
}
const encArgs = (enc) =>
  enc === 'videotoolbox'
    ? ['-c:v', 'h264_videotoolbox', '-b:v', bitrate, '-allow_sw', '1', '-profile:v', 'high']
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20'];

/** Rim suggestion from the one annotated minute (basket bbox is constant per cam). */
function rimSuggestion(cam) {
  const dir = path.join(archive, `camera${cam}`);
  if (!fs.existsSync(dir)) return null;
  const objects = fs.readdirSync(dir).find((f) => f.endsWith('.objects.xml'));
  if (!objects) return null;
  const xml = fs.readFileSync(path.join(dir, objects), 'utf8');
  const W = Number(/<width>(\d+)<\/width>/.exec(xml)?.[1] ?? 1600);
  const H = Number(/<height>(\d+)<\/height>/.exec(xml)?.[1] ?? 1200);
  const boxes = new Map();
  for (const m of xml.matchAll(
    /<track type="basket">\s*<position>\s*<x>(\d+)<\/x>\s*<y>(\d+)<\/y>\s*<w>(\d+)<\/w>\s*<h>(\d+)<\/h>/g,
  )) {
    const key = m.slice(1, 5).join(',');
    boxes.set(key, (boxes.get(key) ?? 0) + 1);
    if (boxes.size > 8) break;
  }
  if (boxes.size === 0) return null;
  // cam2 sees both baskets; take the biggest box (the near one).
  const [x, y, w, h] = [...boxes.keys()]
    .map((k) => k.split(',').map(Number))
    .sort((a, b) => b[2] * b[3] - a[2] * a[3])[0];
  const rx = (w / 2 / W) * 0.6;
  return {
    basketBox: { x, y, w, h, frameW: W, frameH: H },
    rim: {
      cx: +((x + w / 2) / W).toFixed(4),
      cy: +((y + h * (5 / 6)) / H).toFixed(4),
      rx: +rx.toFixed(4),
      ry: +(rx * 0.35).toFixed(4),
    },
  };
}

// ── per camera ───────────────────────────────────────────────────────────

const enc = pickEncoder();
if (mode === 'cfr' && !dryRun && !have('mkvmerge')) {
  console.error('mkvmerge not found — brew install mkvtoolnix (or use --mode naive)');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
const work = path.join(outDir, '.work');
fs.mkdirSync(work, { recursive: true });

for (const cam of cams) {
  const camDir = path.join(archive, 'h264', `CAMERA${cam}`, day);
  const idxFiles = fs
    .readdirSync(camDir)
    .filter((f) => f.endsWith('.avi.idx'))
    .map((f) => path.join(camDir, f));
  const files = idxFiles
    .map((idx) => {
      const times = readIdx(idx);
      return { avi: idx.replace(/\.idx$/, ''), idx, times, first: times[0], last: times[times.length - 1] };
    })
    .filter((f) => f.times.length > 0 && f.last >= t0 && f.first <= t1)
    .sort((a, b) => a.first - b.first);
  if (files.length === 0) {
    console.error(`cam${cam}: no minute files overlap ${fromIso}..${toIso}`);
    continue;
  }
  const times = files.flatMap((f) => f.times);
  const tFirst = times[0];
  const inRange = times.filter((t) => t >= t0 && t <= t1);
  const gaps = [];
  for (let i = 1; i < inRange.length; i++) {
    const d = inRange[i] - inRange[i - 1];
    if (d > 1) gaps.push({ atS: +(inRange[i - 1] - t0).toFixed(2), gapS: +d.toFixed(2) });
  }
  const srcFps = inRange.length / (t1 - t0);
  console.log(
    `\n=== cam${cam}: ${files.length} minute files, ${times.length} frames (${inRange.length} in range, ${srcFps.toFixed(2)} fps real), first frame ${new Date(tFirst * 1000).toISOString()}, gaps>1s: ${gaps.length}`,
  );

  const base = path.join(outDir, `cam${cam}`);
  const listFile = path.join(work, `cam${cam}.list.txt`);
  const h264 = path.join(work, `cam${cam}.h264`);
  const tsFile = path.join(work, `cam${cam}.ts.txt`);
  const mkv = path.join(work, `cam${cam}.mkv`);
  const mp4 = `${base}.mp4`;
  if (!dryRun) {
    fs.writeFileSync(
      listFile,
      files.map((f) => `file '${f.avi.replace(/'/g, "'\\''")}'`).join('\n') + '\n',
    );
  }

  if (mode === 'naive') {
    sh('ffmpeg', ['-y', '-loglevel', 'warning', '-stats', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:v', 'copy', '-an', '-movflags', '+faststart', mp4]);
  } else {
    // 1. lossless join
    sh('ffmpeg', ['-y', '-loglevel', 'warning', '-stats', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:v', 'copy', '-an', '-bsf:v', 'h264_mp4toannexb', h264]);
    // 2. timestamps v2 (ms, relative to the first joined frame, strictly increasing)
    let prev = -1;
    const lines = ['# timestamp format v2'];
    for (const t of times) {
      let v = Math.round((t - tFirst) * 1000);
      if (v <= prev) v = prev + 1;
      prev = v;
      lines.push(String(v));
    }
    if (!dryRun) fs.writeFileSync(tsFile, lines.join('\n') + '\n');
    if (!dryRun) {
      const n = Number(execFileSync('ffprobe', ['-v', 'error', '-count_packets', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', h264], { encoding: 'utf8' }).trim());
      if (n !== times.length) {
        console.warn(`cam${cam}: WARNING joined stream has ${n} frames but .idx lists ${times.length} — timestamps may drift`);
      } else {
        console.log(`cam${cam}: ${n} frames == ${times.length} idx records ✓`);
      }
    }
    // 3. true timestamps, lossless
    const mm = sh('mkvmerge', ['-o', mkv, '--timestamps', `0:${tsFile}`, h264]);
    if (mm.status === 2) {
      console.error(`cam${cam}: mkvmerge failed`);
      process.exitCode = 1;
      continue;
    }
    // 4. frame 0 = t0, constant fps
    const vf = ['-fps_mode', 'cfr', '-r', String(fps), ...(scale ? ['-vf', `scale=${scale}`] : [])];
    sh('ffmpeg', [
      '-y', '-loglevel', 'warning', '-stats',
      '-ss', (t0 - tFirst).toFixed(3), '-i', mkv, '-t', (t1 - t0).toFixed(3),
      ...vf, ...encArgs(enc), '-g', String(fps * 2), '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', mp4,
    ]);
  }

  // Verify + sidecar
  let outInfo = null;
  if (!dryRun && fs.existsSync(mp4)) {
    const s = JSON.parse(
      execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,avg_frame_rate,nb_frames,duration', '-of', 'json', mp4], { encoding: 'utf8' }),
    ).streams[0];
    outInfo = { width: s.width, height: s.height, avgFrameRate: s.avg_frame_rate, frames: Number(s.nb_frames), durationS: Number(s.duration) };
    console.log(`cam${cam}: ${mp4} → ${s.width}x${s.height} ${s.avg_frame_rate} fps, ${s.nb_frames} frames, ${Number(s.duration).toFixed(2)} s (expected ${(t1 - t0).toFixed(2)} s)`);
  }
  const rim = rimSuggestion(cam);
  const sidecar = {
    dataset: 'APIDIS',
    cam,
    day,
    t0Utc: t0,
    t0Iso: new Date(t0 * 1000).toISOString(),
    t1Utc: t1,
    timing: mode === 'naive' ? 'nominal' : 'cfr',
    fps,
    encoder: mode === 'naive' ? 'copy' : enc,
    scale,
    output: outInfo,
    source: {
      files: files.map((f) => path.basename(f.avi)),
      frames: times.length,
      framesInRange: inRange.length,
      realFps: +srcFps.toFixed(3),
      firstFrameUtc: tFirst,
      firstFrameOffsetS: +(inRange[0] - t0).toFixed(3),
      gaps,
    },
    ...(rim ?? {}),
  };
  if (!dryRun) fs.writeFileSync(`${base}.apidis.json`, JSON.stringify(sidecar, null, 2) + '\n');

  if (stills && !dryRun && fs.existsSync(mp4)) {
    sh('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(stillAt), '-i', mp4, '-frames:v', '1', '-update', '1', `${base}.jpg`], { quiet: true });
    if (rim) {
      const { rim: r, basketBox: b } = rim;
      const W = outInfo?.width ?? 1600;
      const H = outInfo?.height ?? 1200;
      const sx = W / b.frameW;
      const sy = H / b.frameH;
      const draw = [
        `drawbox=x=${Math.round(b.x * sx)}:y=${Math.round(b.y * sy)}:w=${Math.round(b.w * sx)}:h=${Math.round(b.h * sy)}:color=yellow@0.8:t=3`,
        `drawbox=x=${Math.round((r.cx - r.rx) * W)}:y=${Math.round((r.cy - r.ry) * H)}:w=${Math.round(2 * r.rx * W)}:h=${Math.round(2 * r.ry * H)}:color=red@0.9:t=3`,
      ].join(',');
      sh('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(stillAt), '-i', mp4, '-frames:v', '1', '-update', '1', '-vf', draw, `${base}-rim.jpg`], { quiet: true });
    }
  }

  if (!keep && !dryRun) {
    for (const f of [listFile, h264, tsFile, mkv]) fs.rmSync(f, { force: true });
  }
}
if (!keep && !dryRun) fs.rmSync(work, { recursive: true, force: true });
