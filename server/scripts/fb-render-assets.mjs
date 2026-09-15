#!/usr/bin/env node
// Renders the static chrome of the football-game ("Touchline") broadcast HUD
// (FbHud.tsx) into PNGs under server/imgs/fb/, using system Chrome in headless
// mode — same pipeline as bb-render-assets.mjs. The PNGs are committed;
// production never runs this.
//
// Look: night-navy plates rgba(11,18,32,.94) / rgba(18,27,44,.94) with one cut
// top-right corner and no hairline, chalk #F4F1E8 text, one grass #2FBF71
// accent, amber #FFB020 for the referee's calls, gold only on the winner,
// Big Shoulders Display (900/800/700) + IBM Plex Mono. Team colours are NEVER
// baked — FbHud.tsx paints them at runtime as View backgrounds (16 px stripes,
// 4 px rules), so every plate here is neutral and leaves those slots
// transparent. Dynamic values (scores, clock, names, QR, stats) are drawn by
// FbHud.tsx at the coordinates listed here; when you move something, update
// FbHud.tsx.
//
// Usage: node scripts/fb-render-assets.mjs [assetName ...]

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '../imgs/fb');
const FONTS_DIR = path.join(__dirname, '../fonts');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const CHALK = '#F4F1E8';
const GRASS = '#2FBF71';
const NAVY = '#0B1220';
const PLATE = 'rgba(11,18,32,.94)';
const PLATE2 = 'rgba(18,27,44,.94)';
const DIM = 'rgba(244,241,232,.7)';
const DIM2 = 'rgba(244,241,232,.5)';
const AMBER = '#FFB020';
const GOLD = 'linear-gradient(135deg,#E8B33A,#F5D77A 45%,#C8901F)';
const PITCH = (alpha, pitch) =>
  `repeating-linear-gradient(0deg,rgba(244,241,232,${alpha}) 0 1px,transparent 1px ${pitch}px),repeating-linear-gradient(90deg,rgba(244,241,232,${alpha}) 0 1px,transparent 1px ${pitch}px)`;

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

const cut = (px) =>
  `clip-path:polygon(0 0,calc(100% - ${px}px) 0,100% ${px}px,100% 100%,0 100%)`;

/** TOUCH | LINE wordmark: a chalk touchline bar between the halves. */
const wordmark = (size) => `
  <div class="bs" style="display:flex;align-items:center;font-weight:900;font-size:${size}px;line-height:.9;white-space:nowrap">
    <span>TOUCH</span>
    <span style="display:inline-block;width:${Math.round(size * 0.1)}px;height:${Math.round(size * 0.72)}px;background:${GRASS};margin:0 ${Math.round(size * 0.07)}px 0 ${Math.round(size * 0.09)}px"></span>
    <span style="color:${GRASS}">LINE</span>
  </div>`;

const stencil = (text, size, extra = '') => `
  <span style="position:relative;display:inline-block;font-weight:900;font-size:${size}px;line-height:.85;${extra}">
    <span>${text}</span>
    <span style="position:absolute;left:-10px;right:-10px;top:38%;height:${Math.max(3, Math.round(size * 0.04))}px;background:${PLATE}"></span>
    <span style="position:absolute;left:-10px;right:-10px;top:66%;height:${Math.max(3, Math.round(size * 0.04))}px;background:${PLATE}"></span>
  </span>`;

const ASSETS = {
  'lobby-scrim': [
    1920,
    1080,
    `<div style="position:absolute;inset:0;background:rgba(11,18,32,.78);background-image:${PITCH(0.05, 40)}"></div>`,
  ],
  'lobby-title': [
    760,
    150,
    `
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;gap:6px">
      ${wordmark(110)}
      <div class="bs" style="font-weight:700;font-size:26px;letter-spacing:.28em">SMELTER FOOTBALL · <span style="opacity:.6">PRE-MATCH</span></div>
    </div>`,
  ],
  'lobby-tag': [
    700,
    220,
    `
    <div class="bs" style="position:absolute;left:30px;top:40px;font-weight:900;font-size:120px;line-height:.9;letter-spacing:.02em;transform:rotate(-5deg);-webkit-text-stroke:2px rgba(244,241,232,.35);color:transparent">TOUCHLINE</div>`,
  ],
  // Lobby panel: QR well 150×150 at (32, 84) for the moderator panel; the
  // cameras list from x=480; team chips (32,344)/(440,344); rules right.
  'lobby-panel': [
    1180,
    400,
    `
    <div style="position:absolute;inset:0;background:${PLATE};${cut(22)}">
      <div style="position:absolute;left:32px;right:32px;top:22px;display:flex;justify-content:space-between;align-items:baseline">
        <span class="bs" style="font-weight:800;font-size:40px;line-height:1">MATCH PRODUCTION</span>
        <span class="mono" style="font-size:13px;letter-spacing:.22em;color:${DIM}">DATASET CAMERAS · MODERATOR PANEL</span>
      </div>
      <div style="position:absolute;left:32px;top:72px;width:400px;height:1px;background:rgba(244,241,232,.15)"></div>
      <div style="position:absolute;left:32px;top:84px;width:150px;height:150px;background:${CHALK}"></div>
      <div class="bs" style="position:absolute;left:202px;top:84px;font-weight:800;font-size:30px;line-height:1">MODERATOR</div>
      <div style="position:absolute;left:480px;top:72px;width:668px;height:1px;background:rgba(244,241,232,.15)"></div>
      <div class="mono" style="position:absolute;left:392px;top:350px;font-size:14px;letter-spacing:.18em;color:${DIM2}">VS</div>
    </div>`,
  ],
  'scorebug-plate': [
    820,
    92,
    `
    <div style="position:absolute;left:16px;top:0;width:788px;height:92px;background:${PLATE};${cut(18)}">
      <div style="position:absolute;left:368px;top:0;width:170px;height:92px;background:${PLATE2}"></div>
    </div>`,
  ],
  'replay-frame': [
    1296,
    764,
    `
    <div style="position:absolute;left:0;top:0;width:1296px;height:42px;background:${PLATE};${cut(28)}">
      <div class="tag" style="position:absolute;left:8px;top:8px;background:${GRASS};color:${NAVY};gap:10px">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${NAVY}"></span>REPLAY
      </div>
      <div class="mono" style="position:absolute;left:150px;top:8px;height:26px;display:flex;align-items:center;font-size:12px;letter-spacing:.22em;color:${DIM2}">SLOW MOTION · TOUCHLINE</div>
    </div>
    <div style="position:absolute;left:0;top:42px;width:8px;height:722px;background:${PLATE}"></div>
    <div style="position:absolute;left:1288px;top:42px;width:8px;height:722px;background:${PLATE}"></div>
    <div style="position:absolute;left:0;top:762px;width:1296px;height:2px;background:${PLATE}"></div>`,
  ],
  'pending-pill': [
    270,
    54,
    `
    <div style="position:absolute;inset:0;background:${PLATE2};clip-path:polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,0 100%)">
      <div style="position:absolute;left:18px;top:21px;width:12px;height:12px;border-radius:50%;background:${AMBER};box-shadow:0 0 0 4px rgba(255,176,32,.25)"></div>
      <div class="mono" style="position:absolute;left:42px;top:0;height:54px;display:flex;align-items:center;font-size:15px;letter-spacing:.2em;font-weight:600">AWAITING REF</div>
    </div>`,
  ],
  // Event banner: a neutral plate (the title is drawn at runtime: CHANCE /
  // SHOT / CORNER / GOAL). Stripe slot 0–16 transparent.
  'banner-event': [
    1000,
    290,
    `
    <div style="position:absolute;left:16px;top:0;width:984px;height:290px;background:${PLATE};${cut(28)};background-image:${PITCH(0.06, 36)}">
      <div style="position:absolute;inset:0;background:linear-gradient(90deg,${PLATE} 20%,rgba(11,18,32,.5) 70%,${PLATE})"></div>
      <div style="position:absolute;left:0;right:0;top:0;height:6px;background:${GRASS}"></div>
    </div>`,
  ],
  'banner-plate': [
    900,
    84,
    `
    <div style="position:absolute;left:0;top:0;width:900px;height:80px;background:${PLATE};${cut(18)}"></div>`,
  ],
  'winner-tag': [
    110,
    24,
    `
    <div class="mono" style="position:absolute;inset:0;background:${GOLD};color:${NAVY};font-weight:600;font-size:11px;letter-spacing:.24em;display:flex;align-items:center;justify-content:center">WINNER</div>`,
  ],
  'tag-outline': [
    60,
    16,
    `<div style="position:absolute;inset:0;border:1px solid rgba(244,241,232,.4)"></div>`,
  ],
  'ended-panel': [
    1200,
    720,
    `
    <div style="position:absolute;inset:0;background:${PLATE};${cut(26)};background-image:radial-gradient(circle at 20% 0,rgba(47,191,113,.16) 1.4px,transparent 1.8px);background-size:10px 10px">
      <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(11,18,32,.2),${PLATE} 45%)"></div>
      <div style="position:absolute;left:44px;top:30px" class="bs">${stencil('FULL TIME', 96, 'letter-spacing:.06em')}</div>
      <div class="mono" style="position:absolute;right:44px;top:56px;font-size:13px;letter-spacing:.22em;color:${DIM}">TOUCHLINE · SMELTER FOOTBALL</div>
      ${[0, 1, 2, 3]
        .map(
          (i) => `
      <div style="position:absolute;left:${86 + i * 120}px;top:552px;width:110px;height:1px;background:rgba(244,241,232,.2)"></div>
      <div style="position:absolute;left:${1114 - 110 - i * 120}px;top:552px;width:110px;height:1px;background:rgba(244,241,232,.2)"></div>`,
        )
        .join('')}
      <div style="position:absolute;left:44px;right:44px;top:646px;height:0;border-top:2px dashed rgba(244,241,232,.25)"></div>
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
    fs.mkdtemp(path.join(os.tmpdir(), 'fb-assets-')),
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
