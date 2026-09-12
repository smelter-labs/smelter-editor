#!/usr/bin/env node
// Renders the static chrome of the basketball-game ("Blacktop") broadcast HUD
// (BbHud.tsx) into PNGs under server/imgs/bb/, using system Chrome in headless
// mode — same pipeline as kbt-render-assets.mjs. The PNGs are committed;
// production never runs this.
//
// Look (docs/design/blacktop/Blacktop HUD.dc.html, section 1b): asphalt
// plates rgba(20,20,22,.94) / rgba(30,30,34,.94) with one cut top-right
// corner and NO hairline, chalk #F4EFE6 text, one electric #33E1FF accent,
// gold only on WINNER, Big Shoulders Display (900/800/700) + IBM Plex Mono.
// Team colours are NEVER baked — BbHud.tsx paints them at runtime as View
// backgrounds (16 px stripes, 4 px rules), so every plate here is neutral
// and leaves those slots transparent. Dynamic values (scores, clock, names,
// QR images, stats) are drawn by BbHud.tsx at the coordinates listed in the
// design's position table; when you move something here, update BbHud.tsx.
//
// Usage: node scripts/bb-render-assets.mjs [assetName ...]

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '../imgs/bb');
const FONTS_DIR = path.join(__dirname, '../fonts');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const CHALK = '#F4EFE6';
const ELECTRIC = '#33E1FF';
const ASPHALT = '#141416';
const PLATE = 'rgba(20,20,22,.94)';
const PLATE2 = 'rgba(30,30,34,.94)';
const DIM = 'rgba(244,239,230,.7)';
const DIM2 = 'rgba(244,239,230,.5)';
const RULE = 'rgba(244,239,230,.12)';
const GOOD = '#2EE06A';
const BAD = '#FF2E3D';
const BALL = '#E8632A';
const GOLD = 'linear-gradient(135deg,#E8B33A,#F5D77A 45%,#C8901F)';
const CHAIN = (alpha, pitch) =>
  `repeating-linear-gradient(45deg,rgba(244,239,230,${alpha}) 0 1px,transparent 1px ${pitch}px),repeating-linear-gradient(-45deg,rgba(244,239,230,${alpha}) 0 1px,transparent 1px ${pitch}px)`;

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

/** BLACK | TOP wordmark, bar = 0.13 × size, height 0.72 × size. */
const wordmark = (size) => `
  <div class="bs" style="display:flex;align-items:center;font-weight:900;font-size:${size}px;line-height:.9;white-space:nowrap">
    <span>BLACK</span>
    <span style="display:inline-block;width:${Math.round(size * 0.13)}px;height:${Math.round(size * 0.72)}px;background:${ELECTRIC};transform:skewX(-18deg);margin:0 ${Math.round(size * 0.065)}px 0 ${Math.round(size * 0.09)}px"></span>
    <span style="color:${ELECTRIC}">TOP</span>
  </div>`;

/** Stencil bridges (6 px @ 38% / 66%) in the plate colour. */
const stencil = (text, size, extra = '') => `
  <span style="position:relative;display:inline-block;font-weight:900;font-size:${size}px;line-height:.85;${extra}">
    <span>${text}</span>
    <span style="position:absolute;left:-10px;right:-10px;top:38%;height:${Math.max(3, Math.round(size * 0.04))}px;background:${PLATE}"></span>
    <span style="position:absolute;left:-10px;right:-10px;top:66%;height:${Math.max(3, Math.round(size * 0.04))}px;background:${PLATE}"></span>
  </span>`;

/** A 496×320 PiP / still frame with a chip; the 480×270 window at (8, 42). */
const pipFrame = (chipBg, chipFg, label, windowHtml = '') => `
  <div style="position:absolute;inset:0;background:${PLATE};${cut(16)}">
    <div style="position:absolute;left:8px;top:42px;width:480px;height:270px;background:transparent">${windowHtml}</div>
    <div class="tag" style="position:absolute;left:8px;top:8px;background:${chipBg};color:${chipFg}">${label}</div>
  </div>`;

const lostWindow = (role) => `
  <div style="position:absolute;inset:0;background:#0e0e10;background-image:repeating-linear-gradient(0deg,transparent 0 3px,rgba(244,239,230,.04) 3px 4px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px">
    <span class="mono" style="font-size:18px;letter-spacing:.24em;color:${BAD};font-weight:600">SIGNAL LOST</span>
    <span class="mono" style="font-size:12px;letter-spacing:.2em;color:${DIM2}">RECONNECTING · ${role} CAM</span>
  </div>`;

// Each asset: [width, height, bodyHtml]. Output positions are design px at
// 1080p (BbHud.tsx scales by resolution.height/1080).
const ASSETS = {
  // ── LOBBY scrim over the court cam, full frame ───────────────────────
  'lobby-scrim': [
    1920,
    1080,
    `<div style="position:absolute;inset:0;background:rgba(20,20,22,.78);background-image:${CHAIN(0.05, 28)}"></div>`,
  ],

  // ── LOBBY title, output pos: left 70, top 60 ─────────────────────────
  'lobby-title': [
    760,
    150,
    `
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;gap:6px">
      ${wordmark(110)}
      <div class="bs" style="font-weight:700;font-size:26px;letter-spacing:.28em">SMELTER STREETBALL · <span style="opacity:.6">COURT OPEN</span></div>
    </div>`,
  ],

  // ── LOBBY tag signature, output pos: x=1150, y=40 (backgrounds only) ──
  'lobby-tag': [
    700,
    220,
    `
    <div class="bs" style="position:absolute;left:30px;top:40px;font-weight:900;font-size:120px;line-height:.9;letter-spacing:.02em;transform:rotate(-5deg);-webkit-text-stroke:2px rgba(244,239,230,.35);color:transparent">BLACKTOP</div>`,
  ],

  // ── LOBBY join panel, output pos: x=370, y=620 ────────────────────────
  // Three columns at col = 32 + i·384: QR well 150×150 at (col, 84); role
  // title at (col+170, 84) burned; BbHud.tsx draws status (col+170, 120),
  // name (col+170, 146), rim (col+170, 222), join host (col+170, 248),
  // team chips (32,344)/(440,344), team names (76,340)/(470,340), rules
  // right-aligned ending x=1140 at y 348.
  'lobby-panel': [
    1180,
    400,
    `
    <div style="position:absolute;inset:0;background:${PLATE};${cut(22)}">
      <div style="position:absolute;left:32px;right:32px;top:22px;display:flex;justify-content:space-between;align-items:baseline">
        <span class="bs" style="font-weight:800;font-size:40px;line-height:1">JOIN THE PRODUCTION</span>
        <span class="mono" style="font-size:13px;letter-spacing:.22em;color:${DIM}">SCAN WITH A PHONE</span>
      </div>
      ${['HOOP CAM', 'COURT CAM', 'COMMENTATOR']
        .map(
          (l, i) => `
      <div style="position:absolute;left:${32 + i * 384}px;top:72px;width:352px;height:1px;background:rgba(244,239,230,.15)"></div>
      <div style="position:absolute;left:${32 + i * 384}px;top:84px;width:150px;height:150px;background:${CHALK}"></div>
      <div class="bs" style="position:absolute;left:${202 + i * 384}px;top:84px;font-weight:800;font-size:30px;line-height:1">${l}</div>`,
        )
        .join('')}
      <div class="mono" style="position:absolute;left:392px;top:350px;font-size:14px;letter-spacing:.18em;color:${DIM2}">VS</div>
    </div>`,
  ],

  // ── SCORE BUG, output pos: left 70, top 40 ───────────────────────────
  // Stripe slots 0–16 (A) and 804–820 (B) transparent (runtime Blocks).
  // Runtime text: Name A 38,26 250×40 · Score A 288,16 96×60 · Clock
  // 384,20 150×32 · Tag 384,58 150×16 · Score B 554,16 · Name B 650,26 R.
  'scorebug-plate': [
    820,
    92,
    `
    <div style="position:absolute;left:16px;top:0;width:788px;height:92px;background:${PLATE};${cut(18)}">
      <div style="position:absolute;left:368px;top:0;width:170px;height:92px;background:${PLATE2}"></div>
    </div>`,
  ],

  // ── PiP frame, output pos: pip rect − (8, 42) ────────────────────────
  'pip-frame-hoop': [496, 320, pipFrame(CHALK, ASPHALT, 'HOOP CAM')],
  'pip-frame-court': [496, 320, pipFrame(CHALK, ASPHALT, 'COURT CAM')],
  'pip-lost-hoop': [
    496,
    320,
    pipFrame(BAD, CHALK, 'HOOP CAM', lostWindow('HOOP')),
  ],
  'pip-lost-court': [
    496,
    320,
    pipFrame(BAD, CHALK, 'COURT CAM', lostWindow('COURT')),
  ],
  // The release still (moderator queue art; no longer drawn on air).
  'still-frame': [496, 320, pipFrame(ELECTRIC, ASPHALT, 'THE RELEASE')],

  // ── REPLAY window, output pos: (312, 162) ────────────────────────────
  // Frame around the 1280×720 clip at (8, 42) — transparent, the clip input
  // is drawn underneath. Header chip baked; stripe slot 8–24 × 42–762
  // transparent (runtime team colour). Runtime text: points 1050,8 90×30
  // BSD black 24 electric R · name 1145,8 140×30 BSD 800 24 R.
  'replay-frame': [
    1296,
    764,
    `
    <div style="position:absolute;left:0;top:0;width:1296px;height:42px;background:${PLATE};${cut(28)}">
      <div class="tag" style="position:absolute;left:8px;top:8px;background:${ELECTRIC};color:${ASPHALT};gap:10px">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${ASPHALT}"></span>REPLAY
      </div>
      <div class="mono" style="position:absolute;left:150px;top:8px;height:26px;display:flex;align-items:center;font-size:12px;letter-spacing:.22em;color:${DIM2}">SLOW MOTION · HOOP CAM</div>
    </div>
    <div style="position:absolute;left:0;top:42px;width:8px;height:722px;background:${PLATE}"></div>
    <div style="position:absolute;left:1288px;top:42px;width:8px;height:722px;background:${PLATE}"></div>
    <div style="position:absolute;left:0;top:762px;width:1296px;height:2px;background:${PLATE}"></div>`,
  ],

  // ── Shot toast, output pos: left 70, top 150 ─────────────────────────
  // Block 0–64 = team colour (runtime). Runtime text: points 84,12 70×40
  // BSD black 40 electric · name 168,15 200×36 BSD 800 34.
  'toast-plate': [
    460,
    64,
    `
    <div style="position:absolute;left:64px;top:0;width:396px;height:64px;background:${PLATE};clip-path:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,0 100%)">
      <div class="mono" style="position:absolute;right:18px;top:0;height:64px;display:flex;align-items:center;font-size:11px;letter-spacing:.22em;color:${DIM}">BLACKTOP</div>
    </div>`,
  ],
  // Ref-call variant: hazard block, "· REF CALL", "TEAM PENDING". Runtime: points only.
  'toast-refcall': [
    460,
    64,
    `
    <div style="position:absolute;left:0;top:0;width:64px;height:64px;background:repeating-linear-gradient(135deg,${ELECTRIC} 0 8px,${ASPHALT} 8px 16px)"></div>
    <div style="position:absolute;left:64px;top:0;width:396px;height:64px;background:${PLATE};clip-path:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,0 100%)">
      <div class="mono" style="position:absolute;left:104px;top:0;height:64px;display:flex;align-items:center;font-size:15px;letter-spacing:.2em;font-weight:600;color:${ELECTRIC}">· REF CALL</div>
      <div class="mono" style="position:absolute;right:18px;top:0;height:64px;display:flex;align-items:center;font-size:11px;letter-spacing:.22em;color:${DIM}">TEAM PENDING</div>
    </div>`,
  ],

  // ── Pending pill, output pos: left 70, top 150 / 230 ─────────────────
  // Runtime: count right-aligned in 214,12 40×32 BSD 800 30 electric.
  'pending-pill': [
    270,
    54,
    `
    <div style="position:absolute;inset:0;background:${PLATE2};clip-path:polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,0 100%)">
      <div style="position:absolute;left:18px;top:21px;width:12px;height:12px;border-radius:50%;background:${BALL};box-shadow:0 0 0 4px rgba(51,225,255,.25)"></div>
      <div class="mono" style="position:absolute;left:42px;top:0;height:54px;display:flex;align-items:center;font-size:15px;letter-spacing:.2em;font-weight:600">AWAITING REF</div>
    </div>`,
  ],

  // ── SCORE banner, output pos: (460, 320) ─────────────────────────────
  // Stripe slot 0–16 transparent (runtime team colour). Runtime text:
  // points 250,214 90×60 BSD black 54 R electric · name 360,214 500×60 BSD 800 54.
  'banner-score': [
    1000,
    290,
    `
    <div style="position:absolute;left:16px;top:0;width:984px;height:290px;background:${PLATE};${cut(28)};background-image:radial-gradient(circle,rgba(51,225,255,.55) 1.4px,transparent 1.8px);background-size:9px 9px">
      <div style="position:absolute;inset:0;background:linear-gradient(90deg,${PLATE} 30%,rgba(20,20,22,.4) 70%,${PLATE})"></div>
      <div class="bs" style="position:absolute;left:0;right:0;top:34px;display:flex;justify-content:center;letter-spacing:.04em;transform:rotate(-2deg);text-shadow:6px 6px 0 ${ELECTRIC}">
        ${stencil('SCORE!', 150)}
      </div>
    </div>`,
  ],

  // ── Lower banner, output pos: (510, 880) ──────────────────────────────
  // Bottom 4 px transparent (runtime rule). Runtime text: 40,16 820×48 BSD 700 44 C.
  'banner-plate': [
    900,
    84,
    `
    <div style="position:absolute;left:0;top:0;width:900px;height:80px;background:${PLATE};${cut(18)}"></div>`,
  ],

  // ── Caster chip + plate ───────────────────────────────────────────────
  'caster-onair': [
    130,
    36,
    `
    <div style="position:absolute;inset:0;background:${BAD};display:flex;align-items:center;justify-content:center;gap:10px">
      <div style="width:10px;height:10px;border-radius:50%;background:${CHALK}"></div>
      <div class="mono" style="font-weight:600;font-size:13px;letter-spacing:.22em">ON AIR</div>
    </div>`,
  ],
  // Runtime text: name 24,14 420×40 BSD 800 36.
  'caster-plate': [
    470,
    88,
    `
    <div style="position:absolute;inset:0;background:${PLATE};${cut(18)}">
      <div class="mono" style="position:absolute;left:24px;top:58px;font-size:12px;letter-spacing:.22em;color:${DIM}">COMMENTARY · BLACKTOP</div>
    </div>`,
  ],

  // ── WINNER tag (gold), placed by BbHud.tsx next to the winner's name ──
  'winner-tag': [
    110,
    24,
    `
    <div class="mono" style="position:absolute;inset:0;background:${GOLD};color:${ASPHALT};font-weight:600;font-size:11px;letter-spacing:.24em;display:flex;align-items:center;justify-content:center">WINNER</div>`,
  ],

  // ── WARM-UP clock tag outline (the only tag not drawn at runtime) ────
  'tag-outline': [
    60,
    16,
    `<div style="position:absolute;inset:0;border:1px solid rgba(244,239,230,.4)"></div>`,
  ],

  // ── ENDED panel, output pos: (360, 180) ──────────────────────────────
  // Stripe slots (44,150,16,470) and (1140,150,16,470) transparent. Runtime:
  // names 86,150 / 734,150 380×44 BSD 800 40 · scores 86,204 / 634,204
  // 480×180 BSD black 190 · stats 86+i·120, 580 (B mirrored) 120×40 BSD 800 36
  // · footer 44,662 1112×20 Plex 400 14 · winner-tag 482,158 / 608,158.
  'ended-panel': [
    1200,
    720,
    `
    <div style="position:absolute;inset:0;background:${PLATE};${cut(26)};background-image:radial-gradient(circle at 20% 0,rgba(232,179,58,.18) 1.4px,transparent 1.8px);background-size:10px 10px">
      <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(20,20,22,.2),${PLATE} 45%)"></div>
      <div style="position:absolute;left:44px;top:30px" class="bs">${stencil('FINAL', 96, 'letter-spacing:.06em')}</div>
      <div class="mono" style="position:absolute;right:44px;top:56px;font-size:13px;letter-spacing:.22em;color:${DIM}">BLACKTOP · SMELTER STREETBALL</div>
      ${['MAKES', 'ATTEMPTS', 'FG%', 'TWOS']
        .map(
          (l, i) => `
      <div style="position:absolute;left:${86 + i * 120}px;top:560px;width:110px;height:1px;background:rgba(244,239,230,.2)"></div>
      <div class="mono" style="position:absolute;left:${86 + i * 120}px;top:568px;font-size:12px;letter-spacing:.18em;color:${DIM2}">${l}</div>
      <div style="position:absolute;left:${1114 - 110 - i * 120}px;top:560px;width:110px;height:1px;background:rgba(244,239,230,.2)"></div>
      <div class="mono" style="position:absolute;left:${1114 - 110 - i * 120}px;top:568px;width:110px;text-align:right;font-size:12px;letter-spacing:.18em;color:${DIM2}">${l}</div>`,
        )
        .join('')}
      <div style="position:absolute;left:44px;right:44px;top:646px;height:0;border-top:2px dashed rgba(244,239,230,.25)"></div>
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
    fs.mkdtemp(path.join(os.tmpdir(), 'bb-assets-')),
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
