#!/usr/bin/env node
/**
 * Build the Smelterionaire QUICK DEMO dataset — live puppets, no Remotion.
 *
 *   node scripts/ob-quiz-demo.mjs [--skip-tts]
 *
 * 1. Runs the conductor on scripts/ob-demo/quiz.conductor.txt (macOS `say`
 *    TTS per persona) → data/ob-demo-raw/quiz/ (--skip-tts reuses it).
 * 2. For every speaking persona, cuts its on-air WAV to the show window,
 *    gates the synthetic room tone, and:
 *      - muxes it with a black 1920×1080 track into a tiny carrier mp4
 *        (the puppet renderer paints the picture live; the mp4 is only the
 *        voice + the clip clock), all clips exactly the same length so the
 *        OB file cams loop together;
 *      - computes the 50 Hz mouth-amplitude track the puppets lip-sync to.
 * 3. Writes data/mp4s/ob-demo/quiz/: <puppet>.mp4, wide.mp4 (silent studio
 *    cam), mouth.json, cams.json (presetId quiz + puppet per cam) — which is
 *    all the /ob-van QUICK DEMOS button needs.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  MP4_DIR,
  RAW_DIR,
  SERVER_DIR,
  decodePcm,
  ffmpeg,
  SR,
} from './lib/ob-media.mjs';

const SKIP_TTS = process.argv.includes('--skip-tts');
const SCRIPT = path.join(SERVER_DIR, 'scripts', 'ob-demo', 'quiz.conductor.txt');
const RAW = path.join(RAW_DIR, 'quiz');
const OUT = path.join(MP4_DIR, 'ob-demo', 'quiz');
const WORK = path.join(RAW, '.work-demo');

const MOUTH_RATE_HZ = 50;
/** Persona KEY → puppet character id + manifest extras. */
const PUPPETS = {
  HOST: { puppet: 'host', role: 'speaker', name: 'HOST' },
  NOVA: { puppet: 'nova', role: 'guest', name: 'NOVA' },
  BIT: { puppet: 'bit', role: 'guest', name: 'BIT' },
  PROF: { puppet: 'prof', role: 'guest', name: 'PROF' },
  LUX: { puppet: 'lux', role: 'guest', name: 'LUX' },
};

// ── 1. conductor (TTS → on-air WAVs + timing) ──────────────────────────────
if (!SKIP_TTS || !existsSync(path.join(RAW, 'quiz.timing.json'))) {
  const r = spawnSync(
    process.execPath,
    [path.join(SERVER_DIR, 'scripts', 'ob-conductor.mjs'), SCRIPT, '--out', RAW],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) {
    console.error('conductor failed');
    process.exit(1);
  }
}

const timing = JSON.parse(
  readFileSync(path.join(RAW, 'quiz.timing.json'), 'utf8'),
);
const showStartS = timing.clapTrackS + timing.startOffsetS;
const durS = timing.durationS;
console.log(`show window: ${showStartS.toFixed(2)}s + ${durS.toFixed(2)}s`);

mkdirSync(OUT, { recursive: true });
mkdirSync(WORK, { recursive: true });

/**
 * 50 Hz RMS envelope of mono PCM. Normalised by the p95 of the VOICED
 * windows only — a persona with one line is silence for 98% of the clip, so
 * a whole-clip percentile would be ~0 and blow every sample to 1.
 */
function mouthTrack(pcm) {
  const win = Math.round(SR / MOUTH_RATE_HZ);
  const n = Math.floor(pcm.length / win);
  const rms = new Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = i * win; j < (i + 1) * win; j++) sum += pcm[j] * pcm[j];
    rms[i] = Math.sqrt(sum / win);
  }
  const max = Math.max(...rms);
  if (max < 1e-3) return rms.map(() => 0);
  const voiced = rms.filter((v) => v > max * 0.1).sort((a, b) => a - b);
  const norm = voiced[Math.floor(voiced.length * 0.95)] || max;
  return rms.map((v) => Math.round(Math.min(1, v / norm) * 1000) / 1000);
}

const VIDEO = [
  '-f', 'lavfi', '-i', `color=c=#05070f:s=1920x1080:r=10:d=${durS.toFixed(3)}`,
];
const ENCODE = [
  '-map', '0:v:0', '-map', '1:a:0',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30',
  '-pix_fmt', 'yuv420p', '-g', '60',
  '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
  '-t', durS.toFixed(3),
  '-movflags', '+faststart', '-video_track_timescale', '90000',
];

const mouth = {};
const manifestCams = [];
for (const p of timing.personas) {
  const spec = PUPPETS[p.key];
  if (!spec) continue;
  const onair = path.join(RAW, timing.onairFiles[p.key]);
  // Gate the conductor's synthetic room tone (−48 dB noise) so five carrier
  // cams in `mix` do not stack it; speech is untouched and timing preserved.
  const cut = path.join(WORK, `${spec.puppet}.wav`);
  await ffmpeg([
    '-ss', showStartS.toFixed(3), '-t', durS.toFixed(3), '-i', onair,
    '-af', 'agate=threshold=-38dB:ratio=9:attack=4:release=180',
    '-ar', String(SR), '-ac', '1', '-y', cut,
  ]);
  mouth[spec.puppet] = { rateHz: MOUTH_RATE_HZ, v: mouthTrack(await decodePcm(cut)) };
  await ffmpeg([
    ...VIDEO, '-i', cut, ...ENCODE, '-y',
    path.join(OUT, `${spec.puppet}.mp4`),
  ]);
  manifestCams.push({
    file: `${spec.puppet}.mp4`,
    role: spec.role,
    name: spec.name,
    talent: p.talent ?? null,
    subtitle: p.subtitle ?? null,
    puppet: spec.puppet,
  });
  console.log(`built ${spec.puppet}.mp4 (${p.key}, voice ${p.voice})`);
}

// Silent studio wide: digital silence so `mix` audio cannot double anything.
await ffmpeg([
  ...VIDEO,
  '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo:d=${durS.toFixed(3)}`,
  ...ENCODE, '-y', path.join(OUT, 'wide.mp4'),
]);
manifestCams.push({
  file: 'wide.mp4',
  role: 'wide',
  name: 'STUDIO',
  talent: null,
  subtitle: 'the studio',
  puppet: 'studio',
});

writeFileSync(
  path.join(OUT, 'mouth.json'),
  JSON.stringify(mouth),
);
writeFileSync(
  path.join(OUT, 'cams.json'),
  JSON.stringify(
    {
      eventName: 'SMELTERIONAIRE',
      presetId: 'quiz',
      captions: false,
      audio: { mode: 'mix' },
      brief: '',
      // The whole point of the demo is the AI director: arm it on load.
      config: { subtitles: false, autoPilot: true },
      rundown: timing.rundown ?? [],
      cams: manifestCams,
    },
    null,
    2,
  ),
);
rmSync(WORK, { recursive: true, force: true });
console.log(`done → ${OUT} (${manifestCams.length} cams, ${durS.toFixed(1)}s loop)`);
