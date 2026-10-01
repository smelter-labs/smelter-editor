#!/usr/bin/env node
// OB Van demo — render Remotion stand-in takes ("full video, just not the
// real one yet"): a stylised close take per persona, one wide with everyone
// at the desk, and a fake highlights reel for the tape cam. Audio is the
// conductor's on-air WAVs (clap + TTS of each persona's own lines), so the
// results go through ob-prep-takes / ob-tape-reel EXACTLY like real footage.
//
//   node scripts/ob-fake-takes.mjs --timing data/ob-demo-raw/nba/nba.timing.json [--half] [--skip-tape]
//
// Writes:
//   <raw>/fake/<persona>.mov      raw fake take (video + on-air audio, clap at @clap)
//   <raw>/fake/wide.mov           raw fake wide (audio = everyone, softer)
//   <raw>/tape-src/fake-reel.mp4  stand-in highlights (muted; input for ob-tape-reel.mjs)
//
// Then: ob-prep-takes.mjs --timing … --in fake/….mov=<persona> … ; ob-tape-reel.mjs …
// Requires `pnpm install` at the repo root once (packages/ob-fake-takes).
// The first Remotion render downloads a headless browser.

import { spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  FONTS_DIR,
  SERVER_DIR,
  ffmpeg,
  fmtTime,
  resolveCli,
} from './lib/ob-media.mjs';

const PKG_DIR = path.resolve(SERVER_DIR, '..', 'packages', 'ob-fake-takes');
const FONT_FILES = [
  ['big-shoulders', 'BigShouldersDisplay-Black.ttf'],
  ['big-shoulders', 'BigShouldersDisplay-Bold.ttf'],
  ['ibm-plex-mono', 'IBMPlexMono-Regular.ttf'],
  ['ibm-plex-mono', 'IBMPlexMono-SemiBold.ttf'],
];

const { values: opt } = parseArgs({
  options: {
    timing: { type: 'string' },
    half: { type: 'boolean', default: false },
    'skip-tape': { type: 'boolean', default: false },
    concurrency: { type: 'string' },
  },
});

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function runRender(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'remotion', ...args], {
      cwd: PKG_DIR,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`remotion exited ${code}`)),
    );
  });
}

async function render(compId, props, out, workDir, extra = []) {
  const propsFile = path.join(workDir, `${compId}-${path.basename(out)}.json`);
  writeFileSync(propsFile, JSON.stringify(props));
  await runRender([
    'render',
    'src/index.ts',
    compId,
    out,
    `--props=${propsFile}`,
    '--codec=h264',
    ...(opt.half ? ['--scale=0.6666667'] : []),
    ...(opt.concurrency ? [`--concurrency=${opt.concurrency}`] : []),
    ...extra,
  ]);
}

async function main() {
  if (!opt.timing) fail('usage: ob-fake-takes.mjs --timing <name>.timing.json');
  const timingPath = resolveCli(opt.timing);
  const timing = JSON.parse(readFileSync(timingPath, 'utf8'));
  const rawDir = path.dirname(timingPath);
  if (!timing.onairFiles)
    fail(
      'timing.json has no onairFiles — re-run ob-conductor.mjs (it now writes the on-air WAVs)',
    );
  if (!existsSync(path.join(PKG_DIR, 'node_modules')))
    fail(`packages/ob-fake-takes has no node_modules — run pnpm install first`);

  // Remotion serves static assets from the package's public/ dir.
  mkdirSync(path.join(PKG_DIR, 'public', 'fonts'), { recursive: true });
  for (const [dir, file] of FONT_FILES)
    copyFileSync(
      path.join(FONTS_DIR, dir, file),
      path.join(PKG_DIR, 'public', 'fonts', file),
    );

  const showStartS = timing.showStartTrackS;
  const trackS = timing.trackDurationS;
  const clapAtS = timing.clapTrackS;
  const personaProps = timing.personas.map((p, i) => ({
    key: p.key,
    talent: p.talent ?? null,
    subtitle: p.subtitle ?? null,
    color: p.color ?? ['#F2B134', '#38BDF8', '#F472B6', '#4ADE80'][i % 4],
    lines: timing.events
      .filter((e) => e.kind === 'line' && e.who === p.key)
      .map((e) => ({
        startS: showStartS + e.startS,
        endS: showStartS + (e.endS ?? e.startS + 2),
      })),
  }));

  const fakeDir = path.join(rawDir, 'fake');
  mkdirSync(fakeDir, { recursive: true });
  const work = mkdtempSync(path.join(os.tmpdir(), 'ob-fake-'));
  const outputs = [];
  try {
    const jobs = [
      ...personaProps.map((persona) => ({
        comp: 'CloseTake',
        props: { persona, clapAtS, showStartS, trackS },
        wav: timing.onairFiles[persona.key],
        out: path.join(fakeDir, `${persona.key.toLowerCase()}.mov`),
      })),
      {
        comp: 'WideTake',
        props: {
          title: timing.title,
          personas: personaProps,
          clapAtS,
          showStartS,
          trackS,
        },
        wav: timing.onairFiles.WIDE,
        out: path.join(fakeDir, 'wide.mov'),
      },
    ];
    for (const job of jobs) {
      const silent = path.join(work, `${path.basename(job.out)}.silent.mp4`);
      console.log(`\nrendering ${job.comp} → ${path.basename(job.out)}`);
      await render(job.comp, job.props, silent, work);
      const wav = path.join(rawDir, job.wav);
      if (!existsSync(wav)) fail(`missing on-air audio ${wav}`);
      // Mux the on-air soundtrack; keep it a lightly-compressed "raw take" —
      // ob-prep-takes does the real encode (clap detect, trim, loudnorm).
      await ffmpeg([
        '-v',
        'error',
        '-i',
        silent,
        '-i',
        wav,
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-shortest',
        '-y',
        job.out,
      ]);
      outputs.push(job.out);
      console.log(`fake ${path.relative(process.cwd(), job.out)}`);
    }

    if (!opt['skip-tape']) {
      const tapeSrc = path.join(rawDir, 'tape-src');
      mkdirSync(tapeSrc, { recursive: true });
      const tapeOut = path.join(tapeSrc, 'fake-reel.mp4');
      console.log(`\nrendering TapeReel → ${path.basename(tapeOut)}`);
      await render(
        'TapeReel',
        { title: timing.title, durationS: timing.durationS },
        tapeOut,
        work,
        ['--muted'],
      );
      outputs.push(tapeOut);
      console.log(`fake ${path.relative(process.cwd(), tapeOut)}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  console.log(
    `\n${outputs.length} fakes for "${timing.title}" (track ${fmtTime(trackS)}, clap at ${fmtTime(clapAtS)})`,
  );
  console.log('next:');
  const rel = (p) => path.relative(SERVER_DIR, p);
  console.log(
    `  node scripts/ob-prep-takes.mjs --timing ${rel(timingPath)} \\\n    ${timing.personas
      .map(
        (p) =>
          `--in ${rel(path.join(fakeDir, `${p.key.toLowerCase()}.mov`))}=${p.key.toLowerCase()}`,
      )
      .join(
        ' ',
      )} \\\n    --in ${rel(path.join(fakeDir, 'wide.mov'))}=wide --outdir data/mp4s/ob-demo/${timing.name}`,
  );
  console.log(
    `  node scripts/ob-tape-reel.mjs --timing ${rel(timingPath)} --out data/mp4s/ob-demo/${timing.name}/tape.mp4`,
  );
  console.log(JSON.stringify({ outputs, trackS, clapAtS }));
}

main().catch((err) => fail(err instanceof Error ? err.stack : String(err)));
