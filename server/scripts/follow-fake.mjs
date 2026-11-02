#!/usr/bin/env node
// FOLLOW demo — offline FAKE of the "AI finds the guy in the golden cap"
// proof segment for workshop episode 6.
//
// Renders placeholder camera slates (packages/smelterionaire-fake, the
// Follow* comps) plus a transparent director-HUD overlay, and emits a
// Premiere project where V1 = slates the presenter replaces with real
// footage of himself sprinting between three cameras, and V2 = the HUD
// (tally chip, WHY log, mini-multiviewer) that stays on top. Emits:
//   server/data/follow-fake/clips/NN-name.mp4   — placeholder slates (V1)
//   server/data/follow-fake/clips/follow-hud.mov — alpha overlay (V2)
//   server/data/follow-fake/follow.xml          — Premiere (FCP7 XML)
//   server/data/follow-fake/preview.mp4         — watch without Premiere
//
// Usage: node scripts/follow-fake.mjs [--only 02-cam1] [--skip-render]
//        [--skip-desktop]
import { spawn } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { FONTS_DIR, SERVER_DIR, ffmpeg, probe } from './lib/ob-media.mjs';

const PKG_DIR = path.resolve(SERVER_DIR, '..', 'packages', 'smelterionaire-fake');
const OUT_DIR = path.join(SERVER_DIR, 'data', 'follow-fake');
const CLIPS_DIR = path.join(OUT_DIR, 'clips');
const PROPS_DIR = path.join(OUT_DIR, 'props');

const FPS = 30;
const CAM_COUNT = 3;
const TARGET = 'the guy in the golden cap';

const { values: opt } = parseArgs({
  options: {
    only: { type: 'string' },
    'skip-render': { type: 'boolean', default: false },
    'skip-desktop': { type: 'boolean', default: false },
  },
});

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

// ── Choreography ──────────────────────────────────────────────────────────
// One run across the room and back: 1 → 2 → 3 → 2 → 1. Each entry is a V1
// placeholder clip; `detect` is what the WHY log prints just before the cut.

const SEGMENTS = [
  {
    name: '01-setup',
    comp: 'FollowSetup',
    durS: 5.0,
    props: { camCount: CAM_COUNT },
  },
  {
    name: '02-cam1',
    comp: 'FollowCamSlate',
    durS: 6.0,
    cam: 1,
    action: 'Stoisz przy kamerze 1, machasz do widza. Pod koniec wybiegasz z kadru w prawo.',
    detect: ['vision: golden cap on CAM 1 · conf 0.93'],
  },
  {
    name: '03-cam2',
    comp: 'FollowCamSlate',
    durS: 5.0,
    cam: 2,
    action: 'Wbiegasz z lewej, krotki przystanek, czapka do kamery.',
    detect: ['host lost on CAM 1 · scanning', 'vision: golden cap on CAM 2 · conf 0.91'],
  },
  {
    name: '04-cam3',
    comp: 'FollowCamSlate',
    durS: 5.0,
    cam: 3,
    action: 'Dobiegasz do kamery 3, hamujesz, patrzysz w obiektyw.',
    detect: ['motion spike CAM 3', 'vision: golden cap on CAM 3 · conf 0.89'],
  },
  {
    name: '05-cam2',
    comp: 'FollowCamSlate',
    durS: 4.0,
    cam: 2,
    action: 'Przebiegasz z powrotem przez kadr kamery 2.',
    detect: ['vision: golden cap on CAM 2 · conf 0.95'],
  },
  {
    name: '06-cam1',
    comp: 'FollowCamSlate',
    durS: 5.0,
    cam: 1,
    action: 'Final: wracasz do kamery 1, zdyszany, poprawiasz zlota czapke.',
    detect: ['host back on CAM 1 · conf 0.97 · out of breath'],
  },
];

function placeSegments() {
  let cursorS = 0;
  const placed = [];
  const cuts = [];
  for (const seg of SEGMENTS) {
    const startS = cursorS;
    if (seg.comp === 'FollowCamSlate') cuts.push({ atS: startS, cam: seg.cam, detect: seg.detect });
    placed.push({ ...seg, startS });
    cursorS += seg.durS;
  }
  return { placed, cuts, totalS: cursorS };
}

// ── Remotion renders ──────────────────────────────────────────────────────

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

const FONT_FILES = [
  ['big-shoulders', 'BigShouldersDisplay-Black.ttf'],
  ['big-shoulders', 'BigShouldersDisplay-ExtraBold.ttf'],
  ['big-shoulders', 'BigShouldersDisplay-Bold.ttf'],
  ['ibm-plex-mono', 'IBMPlexMono-Regular.ttf'],
  ['ibm-plex-mono', 'IBMPlexMono-Medium.ttf'],
  ['ibm-plex-mono', 'IBMPlexMono-SemiBold.ttf'],
];

function prepAssets() {
  mkdirSync(path.join(PKG_DIR, 'public', 'fonts'), { recursive: true });
  for (const [dir, file] of FONT_FILES)
    copyFileSync(path.join(FONTS_DIR, dir, file), path.join(PKG_DIR, 'public', 'fonts', file));
}

async function renderSlate(seg) {
  const propsFile = path.join(PROPS_DIR, `${seg.name}.props.json`);
  const props =
    seg.comp === 'FollowSetup'
      ? { durationS: seg.durS, ...seg.props }
      : {
          durationS: seg.durS,
          cam: seg.cam,
          action: seg.action,
          note: `${seg.name.toUpperCase()} · ${seg.durS.toFixed(1)} s`,
        };
  writeFileSync(propsFile, JSON.stringify(props));
  const out = path.join(CLIPS_DIR, `${seg.name}.mp4`);
  await runRender(['render', 'src/index.ts', seg.comp, out, `--props=${propsFile}`, '--codec=h264', '--muted']);
  return out;
}

async function renderHud(cuts, totalS) {
  const propsFile = path.join(PROPS_DIR, 'follow-hud.props.json');
  writeFileSync(
    propsFile,
    JSON.stringify({ durationS: totalS, camCount: CAM_COUNT, target: TARGET, cuts }),
  );
  const out = path.join(CLIPS_DIR, 'follow-hud.mov');
  await runRender([
    'render', 'src/index.ts', 'FollowHud', out,
    `--props=${propsFile}`,
    '--codec=prores', '--prores-profile=4444', '--image-format=png',
    '--pixel-format=yuva444p10le', '--muted',
  ]);
  return out;
}

// ── Premiere project (FCP7 XML / xmeml v4) ────────────────────────────────

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pathUrl = (p) => `file://localhost${encodeURI(p).replace(/#/g, '%23')}`;
const RATE = `<rate><timebase>${FPS}</timebase><ntsc>FALSE</ntsc></rate>`;
const toF = (s) => Math.round(s * FPS);

function videoClipXml({ id, name, filePath, start, frames }) {
  return `<clipitem id="${id}">
  <name>${esc(name)}</name>
  <enabled>TRUE</enabled>
  <duration>${frames}</duration>
  ${RATE}
  <start>${start}</start>
  <end>${start + frames}</end>
  <in>0</in>
  <out>${frames}</out>
  <file id="${id}-file">
    <name>${esc(path.basename(filePath))}</name>
    <pathurl>${esc(pathUrl(filePath))}</pathurl>
    ${RATE}
    <duration>${frames}</duration>
    <media>
      <video><samplecharacteristics>${RATE}<width>1920</width><height>1080</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></video>
    </media>
  </file>
  <sourcetrack><mediatype>video</mediatype><trackindex>1</trackindex></sourcetrack>
</clipitem>`;
}

function premiereXml(placed, cuts, hudClip, totalS) {
  const baseClips = placed.map((p, i) =>
    videoClipXml({
      id: `clipitem-v${i + 1}`,
      name: p.name,
      filePath: path.join(CLIPS_DIR, `${p.name}.mp4`),
      start: toF(p.startS),
      frames: toF(p.durS),
    }),
  );
  const hud = videoClipXml({
    id: 'clipitem-hud',
    name: 'follow-hud (AI director overlay)',
    filePath: hudClip,
    start: 0,
    frames: toF(totalS),
  });
  const markers = cuts.map(
    (c) =>
      `<marker><comment>${esc(c.detect.join(' | '))}</comment><name>CUT → CAM ${c.cam}</name><in>${toF(c.atS)}</in><out>-1</out></marker>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
<sequence id="sequence-1">
  <name>FOLLOW FAKE — golden cap demo</name>
  <duration>${toF(totalS)}</duration>
  ${RATE}
  <media>
    <video>
      <format><samplecharacteristics>${RATE}<width>1920</width><height>1080</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format>
      <track>
${baseClips.join('\n')}
        <enabled>TRUE</enabled>
        <locked>FALSE</locked>
      </track>
      <track>
${hud}
        <enabled>TRUE</enabled>
        <locked>FALSE</locked>
      </track>
    </video>
    <audio>
      <format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format>
      <track>
        <enabled>TRUE</enabled>
        <locked>FALSE</locked>
      </track>
    </audio>
  </media>
  <timecode>${RATE}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>
${markers.join('\n')}
</sequence>
</xmeml>
`;
}

// ── Preview (concat slates + HUD overlay) ─────────────────────────────────

async function renderPreview(placed, hudClip) {
  const listFile = path.join(PROPS_DIR, 'concat.txt');
  writeFileSync(
    listFile,
    placed.map((p) => `file '${path.join(CLIPS_DIR, `${p.name}.mp4`)}'`).join('\n'),
  );
  const base = path.join(PROPS_DIR, 'preview-base.mp4');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', base]);
  const out = path.join(OUT_DIR, 'preview.mp4');
  await ffmpeg([
    '-i', base, '-i', hudClip,
    '-filter_complex', '[0:v][1:v]overlay=0:0,format=yuv420p[v]',
    '-map', '[v]', '-an', '-c:v', 'libx264', '-crf', '18', '-movflags', '+faststart',
    out,
  ]);
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

async function main() {
  if (!existsSync(path.join(PKG_DIR, 'node_modules')))
    fail('packages/smelterionaire-fake has no node_modules — run `pnpm install --ignore-workspace` there first.');
  for (const dir of [OUT_DIR, CLIPS_DIR, PROPS_DIR]) mkdirSync(dir, { recursive: true });

  console.log('— assets');
  prepAssets();

  const { placed, cuts, totalS } = placeSegments();

  console.log('— segments');
  for (const seg of placed) {
    const clip = path.join(CLIPS_DIR, `${seg.name}.mp4`);
    const skip = opt['skip-render'] || (opt.only && seg.name !== opt.only && existsSync(clip));
    if (!skip) {
      console.log(`  render ${seg.name} (${seg.durS}s)`);
      await renderSlate(seg);
    }
    if (!existsSync(clip)) fail(`missing clip ${clip}`);
    // Sanity: Remotion must have produced exactly the planned duration —
    // the XML and the HUD cut times assume butt-joined clips.
    const info = await probe(clip);
    const durS = Number(info.format.duration);
    if (Math.abs(durS - seg.durS) > 0.2)
      console.warn(`  WARN ${seg.name}: clip is ${durS.toFixed(2)}s, planned ${seg.durS}s`);
  }

  const hudClip = path.join(CLIPS_DIR, 'follow-hud.mov');
  if (!opt['skip-render'] || !existsSync(hudClip)) {
    console.log(`  render follow-hud (${totalS}s, ProRes 4444 alpha)`);
    await renderHud(cuts, totalS);
  }

  console.log('— premiere xml');
  writeFileSync(path.join(OUT_DIR, 'follow.xml'), premiereXml(placed, cuts, hudClip, totalS));

  console.log('— preview');
  await renderPreview(placed, hudClip);

  writeFileSync(
    path.join(OUT_DIR, 'README.txt'),
    [
      'FOLLOW — fake demo "goscia w zlotej czapce" (workshop ep. 6)',
      '',
      'Premiere: File → Import → follow.xml (sekwencja 1080p30).',
      'V1 = slate\'y-placeholdery, kazdy opisuje co nagrac (biegasz miedzy',
      '3 kamerami w zlotej czapce); podmien je na wlasne nagrania, ciecia',
      'zostaw na granicach klipow (marker na kazdym cieciu = linia WHY).',
      'V2 = follow-hud.mov (ProRes 4444 z alfa) — nakladka rezysera: chip',
      'PROGRAM/tally, log WHY, mini-multiviewer. Zostaw na wierzchu.',
      'Jesli przesuniesz ciecia, przesun tez marker/overlay albo zrenderuj',
      'ponownie ze zmienionym SEGMENTS w scripts/follow-fake.mjs.',
      'Po przeniesieniu folderu Premiere zrobi relink do clips/.',
      '',
      `Total: ${Math.round(totalS)}s, ${placed.length} segmentow + overlay.`,
      ...placed.map((p) => `  ${fmt(p.startS)}  ${p.name} (${p.durS}s)${p.action ? `  - ${p.action}` : ''}`),
    ].join('\n'),
  );

  if (!opt['skip-desktop']) {
    const desktop = path.join(process.env.HOME ?? '~', 'Desktop', 'follow-fake');
    console.log(`— copying to ${desktop}`);
    cpSync(OUT_DIR, desktop, { recursive: true });
  }
  console.log(`DONE ${OUT_DIR} (total ${fmt(totalS)})`);
}

main().catch((err) => fail(err.stack ?? String(err)));
