#!/usr/bin/env node
// Measure hoop-vs-court skew ON AIR for the basketball file cameras.
//
// Two synthetic clips with a burned-in timecode (same content) are attached
// as the hoop and court file cams, synced, the program output is recorded,
// and one frame per second is cut out of the recording so the timecode in
// the full picture (court) can be read against the one in the HOOP CAM PiP.
// A short clip (default 20 s) wraps twice inside a 50 s recording, which is
// where a side-channel input drifts (each loop restart re-anchors it).
//
//   node scripts/bb-sync-probe.mjs                 # API on :3001 (sidecars optional)
//   node scripts/bb-sync-probe.mjs --seconds 50 --clip-s 20 --every 1
//
// Output: data/mp4s/bb-probe/{hoop,court}.mp4, the recording under
// data/recordings, frames in <scratch>/bb-probe-frames/f_<t>.png and the
// state's clip clocks at the start and the end. Read the frames: skew =
// timecode(court) − timecode(hoop PiP).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, createRoom, deleteRoom, getState, parseArgs, sleep, waitFor } from './lib/bb-api.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(here, '..', 'data');
const { opt } = parseArgs(process.argv);
const seconds = Number(opt('seconds', '50'));
const clipS = Number(opt('clip-s', '20'));
const every = Number(opt('every', '1'));
const outDir = opt('out', path.join(os.tmpdir(), 'bb-probe-frames'));
const FONT = ['/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'].find((f) => fs.existsSync(f));

// ── 1. timecode clips ─────────────────────────────────────────────────────
const probeDir = path.join(DATA, 'mp4s', 'bb-probe');
fs.mkdirSync(probeDir, { recursive: true });
for (const [name, color] of [['hoop', 'red'], ['court', 'blue']]) {
  const file = path.join(probeDir, `${name}.mp4`);
  if (fs.existsSync(file)) continue;
  const draw = `drawtext=${FONT ? `fontfile='${FONT}':` : ''}text='${name.toUpperCase()} %{pts\\:hms}':fontsize=160:fontcolor=white:box=1:boxcolor=${color}@0.8:boxborderw=20:x=(w-text_w)/2:y=(h-text_h)/2`;
  execFileSync(
    'ffmpeg',
    ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=1600x1200:rate=25:duration=${clipS}`, '-vf', draw, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file],
    { stdio: 'inherit' },
  );
  console.log(`wrote ${file}`);
}

// ── 2. room with both file cams, sync, record ─────────────────────────────
const roomId = await createRoom();
console.log(`room ${roomId}`);
let recording = null;
try {
  await api('POST', `/room/${roomId}/basketball-game/config`, {
    teams: { A: { name: 'HOOP', color: '#ff2e3d' }, B: { name: 'COURT', color: '#1f7bff' } },
    detector: { ballDetector: 'hsv' },
    durationMs: 1_800_000,
  });
  await api('POST', `/room/${roomId}/basketball-game/mp4-cam`, { role: 'hoop', fileName: 'bb-probe/hoop.mp4' });
  await api('POST', `/room/${roomId}/basketball-game/mp4-cam`, { role: 'court', fileName: 'bb-probe/court.mp4' });
  await waitFor(async () => {
    const s = await getState(roomId);
    return s.cams.hoop.clip && s.cams.court.clip;
  }, { label: 'clip clocks', timeoutMs: 60_000 });
  const synced = await api('POST', `/room/${roomId}/basketball-game/mp4-cam/sync`, { playFromMs: 0 });
  console.log(`synced ${synced.inputIds.length} clips`);
  await api('POST', `/room/${roomId}/basketball-game/match`, { action: 'start' });
  const t0 = Date.now();
  recording = await api('POST', `/room/${roomId}/record/start`, {});
  const clocks = [];
  const snapClocks = async (label) => {
    const s = await getState(roomId);
    const h = s.cams.hoop.clip;
    const c = s.cams.court.clip;
    const row = {
      label,
      atS: +((Date.now() - t0) / 1000).toFixed(1),
      hoop: h,
      court: c,
      onAirSkewMs: h && c ? h.mediaMs - (h.delayMs ?? 0) - (c.mediaMs - (c.delayMs ?? 0)) : null,
    };
    clocks.push(row);
    console.log(`  clock ${label} @${row.atS}s: hoop media ${h?.mediaMs} (delay ${h?.delayMs}) · court media ${c?.mediaMs} · model skew ${row.onAirSkewMs} ms`);
  };
  await snapClocks('start');
  await sleep(seconds * 1000);
  await snapClocks('end');
  const stopped = await api('POST', `/room/${roomId}/record/stop`, {});
  recording = stopped.fileName ?? recording.fileName;
} finally {
  await deleteRoom(roomId);
}

// ── 3. frames out of the recording ────────────────────────────────────────
const recPath = path.join(DATA, 'recordings', recording);
fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));
const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', recPath], { encoding: 'utf8' }).trim());
for (let t = 0; t < dur; t += every) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', recPath, '-frames:v', '1', path.join(outDir, `f_${String(t).padStart(3, '0')}.png`)]);
}
console.log(`recording ${recPath} (${dur.toFixed(1)} s) → ${Math.ceil(dur / every)} frames in ${outDir}`);
console.log('read skew = timecode(court, full picture) − timecode(hoop, PiP) on frames before / after each clip wrap');
