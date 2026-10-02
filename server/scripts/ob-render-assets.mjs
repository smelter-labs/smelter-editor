#!/usr/bin/env node
// Renders the static chrome of the OB Van broadcast HUD (ObHud.tsx) into PNGs
// under server/imgs/ob/, using system Chrome in headless mode — same pipeline
// as fb-render-assets.mjs. The PNGs are committed; production never runs this.
//
// Look: a dark broadcast control room — near-black plates rgba(10,12,16,.94)
// with a hairline top rule, chalk #F2F4F8 text, a red tally accent #FF2D2D
// (ON AIR), green #22C55E for preview / live, sky #38BDF8 for AI.
// Big Shoulders Display (900/800/700) + IBM Plex Mono. Dynamic values (event
// name, segment, names, QR, roster, stats) are drawn by ObHud.tsx at the
// coordinates noted here; when you move something, update ObHud.tsx.
//
// Usage: node scripts/ob-render-assets.mjs [assetName ...]

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '../imgs/ob');
const FONTS_DIR = path.join(__dirname, '../fonts');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const CHALK = '#F2F4F8';
const RED = '#FF2D2D';
const GREEN = '#22C55E';
const SKY = '#38BDF8';
const INK = '#0A0C10';
const PLATE = 'rgba(10,12,16,.94)';
const PLATE2 = 'rgba(20,24,31,.96)';
const DIM = 'rgba(242,244,248,.7)';
const DIM2 = 'rgba(242,244,248,.45)';
const RULE = 'rgba(242,244,248,.14)';
const GRID = (alpha, pitch) =>
  `repeating-linear-gradient(0deg,rgba(242,244,248,${alpha}) 0 1px,transparent 1px ${pitch}px),repeating-linear-gradient(90deg,rgba(242,244,248,${alpha}) 0 1px,transparent 1px ${pitch}px)`;

const blackTtf = path.join(
  FONTS_DIR,
  'big-shoulders/BigShouldersDisplay-Black.ttf',
);
const head = `<meta charset="utf-8"><style>
@font-face{font-family:'Big Shoulders Display';font-weight:500;src:url('file://${FONTS_DIR}/big-shoulders/BigShouldersDisplay-Medium.ttf')}
@font-face{font-family:'Big Shoulders Display';font-weight:700;src:url('file://${FONTS_DIR}/big-shoulders/BigShouldersDisplay-Bold.ttf')}
@font-face{font-family:'Big Shoulders Display';font-weight:800;src:url('file://${FONTS_DIR}/big-shoulders/BigShouldersDisplay-ExtraBold.ttf')}
${existsSync(blackTtf) ? `@font-face{font-family:'Big Shoulders Display';font-weight:900;src:url('file://${blackTtf}')}` : ''}
@font-face{font-family:'IBM Plex Mono';font-weight:400;src:url('file://${FONTS_DIR}/ibm-plex-mono/IBMPlexMono-Regular.ttf')}
@font-face{font-family:'IBM Plex Mono';font-weight:500;src:url('file://${FONTS_DIR}/ibm-plex-mono/IBMPlexMono-Medium.ttf')}
@font-face{font-family:'IBM Plex Mono';font-weight:600;src:url('file://${FONTS_DIR}/ibm-plex-mono/IBMPlexMono-SemiBold.ttf')}
html,body{margin:0;padding:0;background:transparent;overflow:hidden}
*{box-sizing:border-box}
.bs{font-family:'Big Shoulders Display',sans-serif;color:${CHALK}}
.mono{font-family:'IBM Plex Mono',monospace;color:${CHALK}}
.tag{font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:12px;letter-spacing:.22em;height:26px;padding:0 12px;display:flex;align-items:center}
</style>`;

/** Red tally lamp. */
const lamp = (size) =>
  `<span style="display:inline-block;width:${size}px;height:${size}px;border-radius:50%;background:${RED};box-shadow:0 0 0 ${Math.round(size / 3)}px rgba(255,45,45,.22)"></span>`;

/** OB·VAN wordmark: a red tally bar between the halves. */
const wordmark = (size) => `
  <div class="bs" style="display:flex;align-items:center;font-weight:900;font-size:${size}px;line-height:.9;white-space:nowrap">
    <span>OB</span>
    <span style="display:inline-block;width:${Math.round(size * 0.12)}px;height:${Math.round(size * 0.7)}px;background:${RED};margin:0 ${Math.round(size * 0.1)}px"></span>
    <span>VAN</span>
  </div>`;

// ── Smelterionaire quiz plates (ObQuizHud.tsx) ─────────────────────────────
// Millionaire look: deep navy hexagonal lozenges with gold hairlines.
const QGOLD = '#FFD166';
const QNAVY = 'rgba(7,11,24,.95)';
const QNAVY2 = 'rgba(14,21,44,.96)';

/** Classic Millionaire hexagon via clip-path; `c` = chamfer px. */
const hex = (c) =>
  `polygon(${c}px 0, calc(100% - ${c}px) 0, 100% 50%, calc(100% - ${c}px) 100%, ${c}px 100%, 0 50%)`;

/** Bordered hexagon: a gold hexagon with an inset fill hexagon on top. */
const hexPlate = (w, h, c, fill, border = QGOLD, bw = 2) => `
    <div style="position:absolute;inset:0;background:${border};clip-path:${hex(c)}"></div>
    <div style="position:absolute;left:${bw}px;top:${bw}px;right:${bw}px;bottom:${bw}px;background:${fill};clip-path:${hex(Math.max(2, c - bw))}"></div>`;

const smelterionaire = (size) => `
  <div class="bs" style="display:flex;align-items:center;gap:${Math.round(size * 0.22)}px;font-weight:900;font-size:${size}px;line-height:.9;white-space:nowrap">
    <span style="display:inline-block;width:${Math.round(size * 0.42)}px;height:${Math.round(size * 0.42)}px;background:${QGOLD};transform:rotate(45deg);box-shadow:0 0 ${Math.round(size * 0.5)}px rgba(255,209,102,.55)"></span>
    <span style="background:linear-gradient(180deg,#FFE9B0 0%,${QGOLD} 45%,#B8860B 100%);-webkit-background-clip:text;background-clip:text;color:transparent">SMELTERIONAIRE</span>
  </div>`;

const ASSETS = {
  // Title bug 640×64 at (56,44): ON AIR chip 0–104; event text from x=120,
  // segment right-aligned in 380–616.
  'title-bug-plate': [
    640,
    64,
    `
    <div style="position:absolute;inset:0;background:${PLATE};border-top:2px solid ${RULE}">
      <div style="position:absolute;left:0;top:0;width:104px;height:64px;background:${RED};display:flex;align-items:center;justify-content:center;gap:8px">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${CHALK}"></span>
        <span class="bs" style="font-weight:900;font-size:26px;letter-spacing:.06em">LIVE</span>
      </div>
      <div style="position:absolute;left:370px;top:18px;width:1px;height:28px;background:${RULE}"></div>
    </div>`,
  ],
  // Lower third 980×150 at (96,832): red bar 0–14; name at (48,18) 62 px;
  // subtitle at (50,104) mono 22 px.
  'lower-third-plate': [
    980,
    150,
    `
    <div style="position:absolute;left:0;top:0;width:14px;height:150px;background:${RED}"></div>
    <div style="position:absolute;left:14px;top:0;width:966px;height:96px;background:${PLATE}"></div>
    <div style="position:absolute;left:14px;top:96px;width:760px;height:46px;background:${PLATE2};border-top:1px solid ${RULE}"></div>`,
  ],
  'setup-scrim': [
    1920,
    1080,
    `<div style="position:absolute;inset:0;background:rgba(10,12,16,.9);background-image:${GRID(0.035, 48)}"></div>
     <div style="position:absolute;left:0;right:0;top:0;height:6px;background:${RED}"></div>`,
  ],
  'setup-title': [
    900,
    190,
    `
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;gap:10px">
      ${wordmark(120)}
      <div class="mono" style="font-weight:600;font-size:20px;letter-spacing:.3em;color:${SKY}">AI DIRECTOR · SMELTER</div>
    </div>`,
  ],
  // Setup panel 1728×680 at (96,300): QR well 260×260 at (58,130) on a chalk
  // square (48,120)–(328,400); roster rows from (440,130), 62 px apart.
  'setup-panel': [
    1728,
    680,
    `
    <div style="position:absolute;inset:0;background:${PLATE};border-top:2px solid ${RULE}">
      <div style="position:absolute;left:48px;top:40px;display:flex;align-items:center;gap:14px">
        ${lamp(12)}<span class="bs" style="font-weight:800;font-size:36px;line-height:1">BE A CAMERA</span>
      </div>
      <div style="position:absolute;left:48px;top:120px;width:280px;height:280px;background:${CHALK}"></div>
      <div class="mono" style="position:absolute;left:48px;top:420px;width:300px;font-size:15px;line-height:1.5;letter-spacing:.08em;color:${DIM}">Scan with a phone,<br>pick a role, go live.</div>
      <div style="position:absolute;left:392px;top:40px;width:1px;height:600px;background:${RULE}"></div>
      <div style="position:absolute;left:440px;top:40px;right:48px;display:flex;justify-content:space-between;align-items:baseline">
        <span class="bs" style="font-weight:800;font-size:36px;line-height:1">CAMERAS</span>
        <span class="mono" style="font-size:14px;letter-spacing:.22em;color:${DIM2}">BUS · NAME · ROLE · SIGNAL</span>
      </div>
      <div style="position:absolute;left:440px;right:48px;top:100px;height:1px;background:${RULE}"></div>
      <div class="mono" style="position:absolute;left:440px;bottom:26px;font-size:13px;letter-spacing:.22em;color:${DIM2}">STANDBY · THE SHOW STARTS WHEN THE DIRECTOR GOES LIVE</div>
    </div>`,
  ],
  'replay-frame': [
    1296,
    764,
    `
    <div style="position:absolute;left:0;top:0;width:1296px;height:42px;background:${PLATE}">
      <div class="tag" style="position:absolute;left:8px;top:8px;background:${RED};color:${CHALK};gap:10px">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${CHALK}"></span>REPLAY
      </div>
      <div class="mono" style="position:absolute;left:150px;top:8px;height:26px;display:flex;align-items:center;font-size:12px;letter-spacing:.22em;color:${DIM2}">SLOW MOTION · OB VAN</div>
    </div>
    <div style="position:absolute;left:0;top:42px;width:8px;height:722px;background:${PLATE}"></div>
    <div style="position:absolute;left:1288px;top:42px;width:8px;height:722px;background:${PLATE}"></div>
    <div style="position:absolute;left:0;top:762px;width:1296px;height:2px;background:${PLATE}"></div>`,
  ],
  // ── Smelterionaire quiz (ObQuizHud.tsx) ──────────────────────────────
  // Title splash 760×200, centered at (580,340).
  'quiz-logo': [
    760,
    200,
    `
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px">
      <div class="mono" style="font-weight:600;font-size:18px;letter-spacing:.42em;color:${DIM}">WHO WANTS TO BE A</div>
      ${smelterionaire(72)}
      <div class="mono" style="font-weight:600;font-size:13px;letter-spacing:.34em;color:${SKY}">DIRECTED BY AI · SMELTER</div>
    </div>`,
  ],
  // Compact chip 380×64 at (1484,44), above the money rail.
  'quiz-logo-chip': [
    380,
    64,
    `
    ${hexPlate(380, 64, 18, QNAVY)}
    <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
      ${smelterionaire(27)}
    </div>`,
  ],
  // Question lozenge 1504×132 at (208,690); the question text is drawn by
  // ObQuizHud centered in the plate.
  'quiz-question-plate': [
    1504,
    132,
    `${hexPlate(1504, 132, 40, QNAVY)}
     <div style="position:absolute;left:44px;top:4px;right:44px;height:1px;background:rgba(255,209,102,.25)"></div>`,
  ],
  // Answer lozenges 740×96 at (208/972, 846/956): idle navy, locked orange,
  // correct green, wrong red. Letter + text drawn by ObQuizHud.
  'quiz-answer-idle': [740, 96, hexPlate(740, 96, 30, QNAVY2)],
  'quiz-answer-locked': [
    740,
    96,
    hexPlate(
      740,
      96,
      30,
      'linear-gradient(180deg,#FFB347 0%,#FF8A00 60%,#D96D00 100%)',
      '#FFE9B0',
    ),
  ],
  'quiz-answer-correct': [
    740,
    96,
    hexPlate(
      740,
      96,
      30,
      'linear-gradient(180deg,#34D399 0%,#16A34A 60%,#0E7A37 100%)',
      '#B9F5D0',
    ),
  ],
  'quiz-answer-wrong': [
    740,
    96,
    hexPlate(
      740,
      96,
      30,
      'linear-gradient(180deg,#FF5A5A 0%,#E11D1D 60%,#A31212 100%)',
      '#FFC2C2',
    ),
  ],
  // Money rail chips 380×64 at (1484, 120 + i*76): name left, amount right.
  'quiz-money-chip': [
    380,
    64,
    `${hexPlate(380, 64, 18, QNAVY, 'rgba(255,209,102,.4)', 1)}`,
  ],
  'quiz-money-chip-active': [
    380,
    64,
    `<div style="position:absolute;inset:0;filter:drop-shadow(0 0 10px rgba(255,209,102,.45))">${hexPlate(380, 64, 18, QNAVY2)}</div>`,
  ],
  // Ask-the-AI plate 980×150 at (56,132): sky bar + baked lifeline tag;
  // headline at (48,16), quip at (48,58) drawn by ObQuizHud.
  'quiz-hint-plate': [
    980,
    150,
    `
    <div style="position:absolute;left:0;top:0;width:14px;height:150px;background:${SKY}"></div>
    <div style="position:absolute;left:14px;top:0;right:0;height:150px;background:${PLATE};border-top:2px solid ${RULE}"></div>
    <div class="tag" style="position:absolute;right:10px;top:10px;background:rgba(56,189,248,.16);color:${SKY}">LIFELINE · ASK THE AI</div>`,
  ],
  // Full-frame reveal flashes (rendered at 960×540, rescaled to the output):
  // transparent middle, coloured edge glow; opacity is driven by a shader.
  'quiz-flash-win': [
    960,
    540,
    `<div style="position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 52%,rgba(255,209,102,.5) 82%,rgba(255,209,102,.95) 100%)"></div>`,
  ],
  'quiz-flash-lose': [
    960,
    540,
    `<div style="position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 52%,rgba(255,45,45,.5) 82%,rgba(255,45,45,.95) 100%)"></div>`,
  ],
  // Wrap panel 1200×780 at (360,150): heading baked; event at (56,150);
  // stat values from (56,226) in 370 px columns; shares from (60,490).
  'wrap-panel': [
    1200,
    780,
    `
    <div style="position:absolute;inset:0;background:${PLATE};border-top:6px solid ${RED}">
      <div style="position:absolute;left:56px;top:46px;display:flex;align-items:center;gap:18px">
        ${lamp(14)}<span class="bs" style="font-weight:900;font-size:84px;line-height:1;letter-spacing:.02em">THAT'S A WRAP</span>
      </div>
      <div class="mono" style="position:absolute;right:56px;top:74px;font-size:14px;letter-spacing:.22em;color:${DIM}">OB VAN · DIRECTOR'S REPORT</div>
      <div style="position:absolute;left:56px;right:56px;top:214px;height:1px;background:${RULE}"></div>
      <div style="position:absolute;left:406px;top:236px;width:1px;height:160px;background:${RULE}"></div>
      <div style="position:absolute;left:776px;top:236px;width:1px;height:160px;background:${RULE}"></div>
      <div style="position:absolute;left:56px;right:56px;top:470px;height:1px;background:${RULE}"></div>
    </div>`,
  ],
};

async function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    try {
      await execFileP(p, ['--version']);
      return p;
    } catch {
      /* try next */
    }
  }
  throw new Error('Chrome not found; set CHROME_PATH');
}

async function main() {
  const only = process.argv.slice(2);
  const chrome = await findChrome();
  await mkdir(OUT_DIR, { recursive: true });
  const tmp = await import('node:fs/promises').then((fs) =>
    fs.mkdtemp(path.join(os.tmpdir(), 'ob-assets-')),
  );
  for (const [name, [w, h, body]] of Object.entries(ASSETS)) {
    if (only.length && !only.includes(name)) continue;
    const htmlPath = path.join(tmp, `${name}.html`);
    await writeFile(
      htmlPath,
      `<!doctype html><html><head>${head}</head><body><div style="position:relative;width:${w}px;height:${h}px;overflow:hidden">${body}</div></body></html>`,
    );
    const out = path.join(OUT_DIR, `${name}.png`);
    await execFileP(chrome, [
      '--headless=new',
      '--disable-gpu',
      '--force-device-scale-factor=1',
      '--default-background-color=00000000',
      '--hide-scrollbars',
      `--window-size=${w},${h}`,
      `--screenshot=${out}`,
      `file://${htmlPath}`,
    ]);
    console.log(`rendered ${name}.png (${w}×${h})`);
  }
  await rm(tmp, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
