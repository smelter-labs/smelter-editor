#!/usr/bin/env node
// Renders the Smelterionaire quiz stingers into server/sfx/ as tiny mp4s
// (64×36 black video + synthesized audio) so the engine can play them like
// replay clips. The files are committed; production never runs this.
//
// Durations must match QUIZ_SFX_MS in ObVanController.ts:
//   intro 2.4 s · board 1.4 s · win 1.8 s · lose 1.8 s
//
// Usage: node scripts/quiz-render-sfx.mjs [name ...]

import { mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '../sfx');

/** A sine note: frequency, start (s), length (s), gain. */
const note = (i, freq, dur) => ({ i, f: `sine=frequency=${freq}:duration=${dur}` });

/**
 * Each sting: duration + a list of lavfi audio inputs + a filter that mixes
 * them. `[aN]` are the audio inputs in order; the filter must end in [a].
 */
const STINGS = {
  // Rising A-major fanfare: A4 → C#5 → E5 → A5, then the chord rings out.
  intro: {
    dur: 2.4,
    notes: [440, 554.37, 659.25, 880],
    filter: (d) =>
      [
        `[a0]afade=t=out:st=0:d=${d}[n0]`,
        `[a1]adelay=150|150,afade=t=out:st=0.15:d=${d - 0.15}[n1]`,
        `[a2]adelay=300|300,afade=t=out:st=0.3:d=${d - 0.3}[n2]`,
        `[a3]adelay=450|450,afade=t=out:st=0.45:d=${d - 0.45}[n3]`,
        `[n0][n1][n2][n3]amix=inputs=4:normalize=0,volume=0.45,afade=t=in:d=0.01,afade=t=out:st=${d - 0.4}:d=0.4[a]`,
      ].join(';'),
  },
  // Suspense swell when the board comes up: a low fifth, crescendo, cut.
  board: {
    dur: 1.4,
    notes: [110, 164.81, 220],
    filter: (d) =>
      [
        `[a0][a1][a2]amix=inputs=3:normalize=0[mix]`,
        `[mix]volume=0.6,afade=t=in:d=${d - 0.3},afade=t=out:st=${d - 0.25}:d=0.25,tremolo=f=6:d=0.4[a]`,
      ].join(';'),
  },
  // A-major hit with a delayed octave sparkle.
  win: {
    dur: 1.8,
    notes: [440, 554.37, 659.25, 1318.5],
    filter: (d) =>
      [
        `[a0]afade=t=out:st=0.2:d=${d - 0.2}[n0]`,
        `[a1]afade=t=out:st=0.2:d=${d - 0.2}[n1]`,
        `[a2]afade=t=out:st=0.2:d=${d - 0.2}[n2]`,
        `[a3]adelay=140|140,volume=0.5,afade=t=out:st=0.3:d=${d - 0.3}[n3]`,
        `[n0][n1][n2][n3]amix=inputs=4:normalize=0,volume=0.5,afade=t=in:d=0.005,afade=t=out:st=${d - 0.3}:d=0.3[a]`,
      ].join(';'),
  },
  // Falling minor line with a low thud — half a million melts away.
  lose: {
    dur: 1.8,
    notes: [329.63, 261.63, 220, 55],
    filter: (d) =>
      [
        `[a0]afade=t=out:st=0.05:d=0.5[n0]`,
        `[a1]adelay=250|250,afade=t=out:st=0.3:d=0.5[n1]`,
        `[a2]adelay=500|500,afade=t=out:st=0.55:d=${d - 0.55}[n2]`,
        `[a3]adelay=500|500,volume=1.4,afade=t=out:st=0.55:d=${d - 0.55}[n3]`,
        `[n0][n1][n2][n3]amix=inputs=4:normalize=0,volume=0.55,afade=t=in:d=0.005,afade=t=out:st=${d - 0.3}:d=0.3[a]`,
      ].join(';'),
  },
};

async function main() {
  const only = process.argv.slice(2);
  await mkdir(OUT_DIR, { recursive: true });
  for (const [name, s] of Object.entries(STINGS)) {
    if (only.length && !only.includes(name)) continue;
    const out = path.join(OUT_DIR, `quiz-sting-${name}.mp4`);
    const args = ['-y'];
    for (const freq of s.notes)
      args.push('-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${s.dur}`);
    args.push('-f', 'lavfi', '-i', `color=c=black:s=64x36:r=10:d=${s.dur}`);
    const renamed = s.notes.map((_, i) => `[${i}:a]anull[a${i}]`).join(';');
    args.push(
      '-filter_complex',
      `${renamed};${s.filter(s.dur)}`,
      '-map',
      `${s.notes.length}:v`,
      '-map',
      '[a]',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-shortest',
      out,
    );
    await execFileP('ffmpeg', args);
    console.log(`rendered quiz-sting-${name}.mp4 (${s.dur}s)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
