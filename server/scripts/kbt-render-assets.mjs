#!/usr/bin/env node
// Renders the static chrome of the kettlebell-tournament broadcast HUD
// (KbtHud.tsx) into PNGs under server/imgs/kbt/, using system Chrome in
// headless mode — no npm deps, no browser download. The PNGs are committed;
// production never runs this.
//
// The fragments are a hand-port of the approved design in
// "Smelter Overlays.dc.html" (kb_design). The design canvas is 3840×2160;
// all sizes here are ×0.5 for the 1920×1080 tournament output. Dynamic
// values (reps, clock, names, RPM, QR) are NOT baked — KbtHud.tsx draws
// them as <Text>/<Image> at coordinates matching these fragments; when you
// move something here, update the matching constants in KbtHud.tsx.
//
// Usage: node scripts/kbt-render-assets.mjs [assetName ...]

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '../imgs/kbt');
const FONTS_DIR = path.join(__dirname, '../fonts');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

// Shared design tokens (design value halved where it is a length).
const ACCENT = '#ff5a1f';
const CREAM = '#e8e4da';
const BG = 'rgba(13,14,16,.94)';
const BG2 = 'rgba(24,26,30,.94)';
const BORDER = '1px solid rgba(255,255,255,.09)';
const DIM = 'rgba(232,228,218,.5)';

const head = `<meta charset="utf-8"><style>
@font-face{font-family:'Big Shoulders Display';font-weight:500;src:url('file://${FONTS_DIR}/big-shoulders/BigShouldersDisplay-Medium.ttf')}
@font-face{font-family:'Big Shoulders Display';font-weight:700;src:url('file://${FONTS_DIR}/big-shoulders/BigShouldersDisplay-Bold.ttf')}
@font-face{font-family:'Big Shoulders Display';font-weight:800;src:url('file://${FONTS_DIR}/big-shoulders/BigShouldersDisplay-ExtraBold.ttf')}
@font-face{font-family:'IBM Plex Mono';font-weight:400;src:url('file://${FONTS_DIR}/ibm-plex-mono/IBMPlexMono-Regular.ttf')}
@font-face{font-family:'IBM Plex Mono';font-weight:500;src:url('file://${FONTS_DIR}/ibm-plex-mono/IBMPlexMono-Medium.ttf')}
@font-face{font-family:'IBM Plex Mono';font-weight:600;src:url('file://${FONTS_DIR}/ibm-plex-mono/IBMPlexMono-SemiBold.ttf')}
html,body{margin:0;padding:0;background:transparent;overflow:hidden}
*{box-sizing:border-box}
.bs{font-family:'Big Shoulders Display',sans-serif}
.mono{font-family:'IBM Plex Mono',monospace}
</style>`;

// Each asset: [width, height, bodyHtml].
const ASSETS = {
  // ── LOBBY ────────────────────────────────────────────────────────────
  // Title block, output pos: left 70, top 60.
  'lobby-title': [720, 150, `
    <div style="position:absolute;inset:0;display:flex;align-items:center;gap:18px">
      <div style="width:10px;height:75px;background:${ACCENT};clip-path:polygon(0 0,100% 7px,100% 100%,0 calc(100% - 7px))"></div>
      <div>
        <div class="bs" style="font-weight:800;font-size:60px;line-height:.9;letter-spacing:2px;color:${CREAM};text-transform:uppercase">Smelter <span style="color:${ACCENT}">Kettlebell</span></div>
        <div class="mono" style="font-size:17px;letter-spacing:7px;color:rgba(232,228,218,.6);margin-top:7px">LIVE TOURNAMENT · CAST IRON DIVISION</div>
      </div>
    </div>`],

  // Join panel, output pos: right 70 (x=1400), vertically centered (y=230).
  // Dynamic slots (KbtHud.tsx LobbyScene): QR image 144×144 at (48,120);
  // join URL text at (218,150) w=190; athlete count right-aligned at
  // (~380,378); roster rows from y=420, row pitch 42, x 35..415.
  'lobby-panel': [450, 620, `
    <div style="position:absolute;inset:0;background:${BG};border:${BORDER};clip-path:polygon(0 0,calc(100% - 22px) 0,100% 22px,100% 100%,0 100%);padding:35px">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:8px;height:8px;background:${ACCENT}"></div>
        <div class="bs" style="font-weight:700;font-size:28px;letter-spacing:3px;color:${CREAM}">JOIN THE TOURNAMENT</div>
      </div>
      <div style="display:flex;gap:25px;align-items:flex-start;margin-top:22px">
        <div style="width:170px;height:170px;background:${CREAM};flex:none"></div>
        <div style="padding-top:14px">
          <div class="mono" style="font-size:15px;color:rgba(232,228,218,.55);letter-spacing:1.5px">SCAN OR VISIT</div>
        </div>
      </div>
      <div style="border-top:1px solid rgba(255,255,255,.1);margin-top:20px;padding-top:16px;display:flex;justify-content:space-between;align-items:baseline">
        <div class="mono" style="font-size:14px;letter-spacing:2.5px;color:rgba(232,228,218,.55)">ATHLETES CONNECTED</div>
      </div>
    </div>`],

  // ── CLOCK CHIP (solo + grid), output pos: top 30, centered (x=685) ───
  // Dynamic slots: heat label centered in x 42..340; clock centered in
  // x 350..550 (IBM semi-bold 32).
  'chip-frame': [550, 54, `
    <div style="position:absolute;inset:0;background:${BG};border:${BORDER};clip-path:polygon(14px 0,calc(100% - 14px) 0,100% 100%,0 100%)">
      <div style="position:absolute;left:25px;top:23px;width:8px;height:8px;background:${ACCENT}"></div>
      <div style="position:absolute;left:350px;top:0;bottom:0;width:1px;background:rgba(255,255,255,.1)"></div>
    </div>`],

  // ── SOLO hero plate, output pos: left 70, bottom 70 (y=690) ─────────
  // Dynamic slots: lift tag text at (20,8) w160; giant points at (30,120)
  // fs150 BS800; RPM value at (280,160) BS700 32; name bar: flag (30,272)
  // name (75,266) reps right.
  'hero-plate': [420, 320, `
    <div style="position:absolute;left:0;top:0;width:190px;height:42px;background:${ACCENT};clip-path:polygon(0 0,calc(100% - 15px) 0,100% 100%,0 100%)"></div>
    <div style="position:absolute;left:0;top:42px;width:420px;height:218px;background:${BG};border:${BORDER}">
      <div class="mono" style="position:absolute;left:30px;top:18px;font-size:14px;letter-spacing:3px;color:${DIM}">POINTS</div>
      <div class="mono" style="position:absolute;left:280px;top:60px;font-size:12px;letter-spacing:2px;color:${DIM}">PACE</div>
    </div>
    <div style="position:absolute;left:0;top:260px;width:420px;height:60px;background:${BG2};border:${BORDER};border-top:none"></div>`],

  // ── SOLO rep tracker, output pos: x=1570, y=720 ──────────────────────
  // Dynamic slots: counts right-aligned at x=255, rows y 60/122/184;
  // bar fills at (25, row+34) h5 max-w 230 (SNATCH #c084fc, CLEAN #00e5ff,
  // SWING #ffb800).
  'tracker-panel': [280, 290, `
    <div style="position:absolute;inset:0;background:${BG};border:${BORDER};clip-path:polygon(0 0,calc(100% - 18px) 0,100% 18px,100% 100%,0 100%);padding:25px">
      <div class="mono" style="font-size:13px;letter-spacing:3px;color:${DIM}">AI REP TRACKER</div>
      ${['SNATCH', 'CLEAN', 'SWING']
        .map(
          (l, i) => `
      <div class="bs" style="position:absolute;left:25px;top:${54 + i * 62}px;font-weight:700;font-size:20px;letter-spacing:2px;color:${CREAM}">${l}</div>
      <div style="position:absolute;left:25px;top:${88 + i * 62}px;width:230px;height:5px;background:rgba(255,255,255,.08)"></div>`,
        )
        .join('')}
    </div>`],

  // ── GRID plates, output pos: flush to bottom, centered per column ────
  // Dynamic slots: rank digit centered in (0,0,48,60); name at (64,10);
  // meta at (64,38); big PTS number right-aligned ending at (w-62, 6..55)
  // with its PTS unit at (w-56, 38); giant reps at (22,~92) fs85; RPM
  // right-aligned at (w-22, ~120).
  ...Object.fromEntries(
    [
      ['grid-plate-608', 608],
      ['grid-plate-480', 480],
    ].map(([name, w]) => [
      name,
      [
        w,
        227,
        `
    <div style="position:absolute;inset:0;background:${BG};border:${BORDER};border-bottom:none">
      <div style="position:absolute;left:0;top:0;width:48px;height:60px;background:${ACCENT}"></div>
      <div style="position:absolute;left:0;top:60px;right:0;height:1px;background:rgba(255,255,255,.1)"></div>
      <div class="mono" style="position:absolute;left:22px;top:74px;font-size:11px;letter-spacing:2px;color:${DIM}">REPS</div>
    </div>`,
      ],
    ]),
  ),

  // ── BOARD panel, output pos: centered (x=360, y=210) ─────────────────
  // Dynamic slots: heat subline right-aligned at (1155, 58); rows from
  // y=130, row pitch 62, x 45..1155.
  'board-panel': [1200, 660, `
    <div style="position:absolute;inset:0;background:rgba(13,14,16,.95);border:${BORDER};clip-path:polygon(0 0,calc(100% - 26px) 0,100% 26px,100% 100%,0 100%);padding:40px 45px">
      <div style="display:flex;align-items:center;gap:15px">
        <div style="width:8px;height:45px;background:${ACCENT};clip-path:polygon(0 0,100% 5px,100% 100%,0 calc(100% - 5px))"></div>
        <div class="bs" style="font-weight:800;font-size:45px;letter-spacing:2.5px;color:${CREAM};text-transform:uppercase;line-height:1">Standings</div>
      </div>
    </div>`],

  // ── CASTER lower-third ────────────────────────────────────────────────
  // ON AIR tag sits directly above caster-plate, left-aligned with it.
  'caster-onair': [130, 36, `
    <div style="position:absolute;inset:0;background:${ACCENT};clip-path:polygon(0 0,calc(100% - 12px) 0,100% 100%,0 100%);display:flex;align-items:center;gap:10px;padding:0 16px">
      <div style="width:8px;height:8px;border-radius:50%;background:#0d0e10"></div>
      <div class="bs" style="font-weight:800;font-size:16px;letter-spacing:3px;color:#0d0e10">ON AIR</div>
    </div>`],

  // Dynamic slots: commentator name at (30,12) BS800 36.
  'caster-plate': [470, 88, `
    <div style="position:absolute;inset:0;background:${BG};border:${BORDER}">
      <div class="mono" style="position:absolute;left:30px;bottom:12px;font-size:15px;letter-spacing:3px;color:${ACCENT}">COMMENTARY · SMELTER KETTLEBELL</div>
    </div>`],

  // Leader chip, output pos: right 70, bottom row of the lower-third.
  // Dynamic slots: leader name from x=95 BS700 22; reps right-aligned at
  // x=275 BS800 28 accent.
  'leader-chip': [300, 56, `
    <div style="position:absolute;inset:0;background:${BG};border:${BORDER};clip-path:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,0 100%)">
      <div class="mono" style="position:absolute;left:25px;top:21px;font-size:13px;letter-spacing:2.5px;color:${DIM}">LEADER</div>
    </div>`],

  // ── PODIUM, title output pos: centered, top 85 (x=510) ───────────────
  'podium-title': [900, 160, `
    <div style="position:absolute;inset:0;text-align:center">
      <div class="mono" style="font-size:17px;letter-spacing:7px;color:rgba(232,228,218,.55);margin-top:8px">SMELTER KETTLEBELL · FINAL RESULTS</div>
      <div class="bs" style="font-weight:800;font-size:75px;line-height:.95;letter-spacing:3px;color:${CREAM};text-transform:uppercase;margin-top:10px">Forged <span style="color:${ACCENT}">Champions</span></div>
    </div>`],

  // Podium blocks, output pos: row centered at bottom 110, order 2·1·3,
  // gap 20 (x from 460). Names/reps are dynamic Text above each block.
  ...Object.fromEntries(
    [
      ['podium-block-1', 240, ACCENT],
      ['podium-block-2', 170, '#c9ced6'],
      ['podium-block-3', 130, '#a9743f'],
    ].map(([name, h, color]) => [
      name,
      [
        320,
        h,
        `
    <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(38,40,45,.97), rgba(20,21,24,.97));border:1px solid rgba(255,255,255,.1);border-top:6px solid ${color};display:flex;align-items:flex-start;justify-content:center">
      <div class="bs" style="font-weight:800;font-size:85px;line-height:1;color:${color};opacity:.9;margin-top:10px">${name.slice(-1)}</div>
    </div>`,
      ],
    ]),
  ),
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
    fs.mkdtemp(path.join(os.tmpdir(), 'kbt-assets-')),
  );
  for (const [name, [w, h, body]] of Object.entries(ASSETS)) {
    if (only.length && !only.includes(name)) continue;
    const htmlPath = path.join(tmp, `${name}.html`);
    // Headless Chrome enforces a minimum viewport (~290px tall) regardless of
    // --window-size, and --screenshot crops the top-left W×H region — so every
    // fragment is anchored inside a fixed W×H wrapper instead of the viewport.
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
