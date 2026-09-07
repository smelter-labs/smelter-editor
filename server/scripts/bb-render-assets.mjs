#!/usr/bin/env node
// Renders the static chrome of the basketball-game ("Blacktop") broadcast HUD
// (BbHud.tsx) into PNGs under server/imgs/bb/, using system Chrome in headless
// mode — same pipeline as kbt-render-assets.mjs. The PNGs are committed;
// production never runs this.
//
// Look: asphalt (#141416) plates with chalk (#f4efe6) rules and an orange
// (#ff6a1f) accent, Big Shoulders Display + IBM Plex Mono. Team colours are
// NEVER baked — BbHud.tsx paints them at runtime as View backgrounds / Text
// colours, so every plate here is neutral. Dynamic values (scores, clock,
// names, QR images, stats) are drawn by BbHud.tsx at coordinates matching
// these fragments; when you move something here, update BbHud.tsx.
//
// Usage: node scripts/bb-render-assets.mjs [assetName ...]

import { mkdir, writeFile, rm } from 'node:fs/promises';
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

const ORANGE = '#ff6a1f';
const CHALK = '#f4efe6';
const ASPHALT = 'rgba(20,20,22,.94)';
const ASPHALT2 = 'rgba(30,30,34,.94)';
const RULE = '1px solid rgba(244,239,230,.14)';
const DIM = 'rgba(244,239,230,.55)';
// Chalk texture: a faint dashed rule reads as a court line.
const CHALK_LINE = `repeating-linear-gradient(90deg, ${CHALK} 0 14px, transparent 14px 22px)`;

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

const cut = (px) =>
  `clip-path:polygon(0 0,calc(100% - ${px}px) 0,100% ${px}px,100% 100%,0 100%)`;

// Each asset: [width, height, bodyHtml]. Output positions are design px at
// 1080p (BbHud.tsx scales by resolution.height/1080).
const ASSETS = {
  // ── LOBBY title, output pos: left 70, top 60 ─────────────────────────
  'lobby-title': [
    760,
    150,
    `
    <div style="position:absolute;inset:0;display:flex;align-items:center;gap:20px">
      <div style="width:12px;height:84px;background:${ORANGE};clip-path:polygon(0 0,100% 8px,100% 100%,0 calc(100% - 8px))"></div>
      <div>
        <div class="bs" style="font-weight:800;font-size:66px;line-height:.9;letter-spacing:3px;color:${CHALK};text-transform:uppercase">Black<span style="color:${ORANGE}">top</span></div>
        <div class="mono" style="font-size:16px;letter-spacing:6px;color:${DIM};margin-top:8px">SMELTER STREETBALL · ONE HOOP · FIRST TO 21</div>
      </div>
    </div>`,
  ],

  // ── LOBBY join panel, output pos: x=370, y=620 (bottom strip) ─────────
  // Three columns at x = 40 / 420 / 800 (each 340 wide). Dynamic slots
  // (BbHud.tsx LobbyScene): QR image 150×150 at (col+20, 95); status label
  // at (col+190, 100) w=140 (mono 13); operator name at (col+190, 130);
  // join host at (col+190, 210); team swatches at the top-right (x from 780,
  // y 26), match rules mono at (40, 330).
  'lobby-panel': [
    1180,
    400,
    `
    <div style="position:absolute;inset:0;background:${ASPHALT};border:${RULE};${cut(26)};padding:26px 40px">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:8px;height:8px;background:${ORANGE}"></div>
        <div class="bs" style="font-weight:700;font-size:28px;letter-spacing:3px;color:${CHALK}">JOIN THE PRODUCTION</div>
        <div class="mono" style="font-size:13px;letter-spacing:2.5px;color:${DIM};margin-left:14px">SCAN WITH A PHONE</div>
      </div>
      ${['HOOP CAM', 'COURT CAM', 'COMMENTATOR']
        .map(
          (l, i) => `
      <div style="position:absolute;left:${40 + i * 380}px;top:95px;width:150px;height:150px;background:${CHALK}"></div>
      <div class="bs" style="position:absolute;left:${230 + i * 380}px;top:70px;font-weight:700;font-size:22px;letter-spacing:2.5px;color:${CHALK}">${l}</div>
      <div style="position:absolute;left:${230 + i * 380}px;top:255px;width:110px;height:2px;background:${CHALK_LINE}"></div>`,
        )
        .join('')}
      <div style="position:absolute;left:40px;top:300px;right:40px;height:1px;background:rgba(244,239,230,.12)"></div>
    </div>`,
  ],

  // ── SCORE BUG, output pos: left 70, top 40 ───────────────────────────
  // Dynamic slots: team A colour bar (0,0,16,92); A name at (32,14) w=210
  // BS700 26; A score right-aligned ending x=330 BS800 58; clock centered in
  // x 340..480 (mono 600 30) with period tag under it; B score from x=490
  // BS800 58; B name right-aligned ending x=788 w=210; B colour bar
  // (804,0,16,92).
  'scorebug-plate': [
    820,
    92,
    `
    <div style="position:absolute;left:16px;top:0;width:788px;height:92px;background:${ASPHALT};border:${RULE}">
      <div style="position:absolute;left:324px;top:0;bottom:0;width:1px;background:rgba(244,239,230,.14)"></div>
      <div style="position:absolute;left:464px;top:0;bottom:0;width:1px;background:rgba(244,239,230,.14)"></div>
      <div style="position:absolute;left:324px;bottom:0;width:140px;height:3px;background:${ORANGE}"></div>
    </div>`,
  ],

  // ── PiP frame, output pos: pip rect − 8px on each side ───────────────
  // 480×270 window + 8 px chalk frame + a tag above the top-left corner.
  ...Object.fromEntries(
    [
      ['pip-frame-hoop', 'HOOP CAM'],
      ['pip-frame-court', 'COURT CAM'],
    ].map(([name, tag]) => [
      name,
      [
        496,
        320,
        `
    <div style="position:absolute;left:0;top:34px;width:496px;height:286px;border:8px solid ${CHALK}"></div>
    <div style="position:absolute;left:0;top:0;height:34px;padding:0 14px;background:${ORANGE};clip-path:polygon(0 0,calc(100% - 12px) 0,100% 100%,0 100%);display:flex;align-items:center;gap:10px">
      <div style="width:8px;height:8px;border-radius:50%;background:#141416"></div>
      <div class="bs" style="font-weight:800;font-size:16px;letter-spacing:3px;color:#141416">${tag}</div>
    </div>`,
      ],
    ]),
  ),

  // ── Last-shot toast, output pos: left 70, top 150 (under the score bug)
  // Dynamic slots: team colour block (0,0,14,64); text at (30,0) centered in
  // 64 BS800 34.
  'toast-plate': [
    460,
    64,
    `
    <div style="position:absolute;left:14px;top:0;width:446px;height:64px;background:${ASPHALT2};border:${RULE};clip-path:polygon(0 0,calc(100% - 16px) 0,100% 16px,100% 100%,0 100%)"></div>`,
  ],

  // ── Pending pill, output pos: left 70, top 230 ───────────────────────
  // Dynamic slot: count right-aligned ending x=250 BS800 30 (orange).
  'pending-pill': [
    270,
    54,
    `
    <div style="position:absolute;inset:0;background:${ASPHALT};border:1px solid ${ORANGE};clip-path:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,0 100%)">
      <div style="position:absolute;left:18px;top:19px;width:10px;height:10px;border-radius:50%;background:${ORANGE}"></div>
      <div class="mono" style="position:absolute;left:38px;top:19px;font-size:13px;letter-spacing:2.5px;color:${CHALK}">AWAITING REF</div>
    </div>`,
  ],

  // ── SCORE banner, output pos: centered (x=460, y=330) ────────────────
  // Dynamic slots: "+1 TEAM" line centered at y 190 BS800 60 in the team
  // colour; team colour bar (0,0,1000,10) drawn as a View above the plate.
  'banner-score': [
    1000,
    280,
    `
    <div style="position:absolute;inset:0;background:rgba(20,20,22,.9);border:${RULE};${cut(34)}"></div>
    <div style="position:absolute;left:0;right:0;top:34px;text-align:center">
      <div class="bs" style="font-weight:800;font-size:150px;line-height:.9;letter-spacing:6px;color:${CHALK}">SCORE!</div>
    </div>
    <div style="position:absolute;left:60px;right:60px;top:172px;height:2px;background:${CHALK_LINE}"></div>`,
  ],

  // ── Generic banner plate (lead change / overtime / final), output pos:
  // centered (x=510, y=880). Dynamic: text centered BS800 44 in banner colour.
  'banner-plate': [
    900,
    84,
    `
    <div style="position:absolute;inset:0;background:${ASPHALT};border:${RULE};clip-path:polygon(18px 0,calc(100% - 18px) 0,100% 100%,0 100%)"></div>`,
  ],

  // ── Release still frame, output pos: right 70, bottom 70 on the score
  // scene (x=1370, y=700): 480×270 window + chalk frame + THE RELEASE tag.
  'still-frame': [
    496,
    320,
    `
    <div style="position:absolute;left:0;top:34px;width:496px;height:286px;border:8px solid ${CHALK}"></div>
    <div style="position:absolute;left:0;top:0;height:34px;padding:0 14px;background:${CHALK};clip-path:polygon(0 0,calc(100% - 12px) 0,100% 100%,0 100%);display:flex;align-items:center;gap:10px">
      <div class="bs" style="font-weight:800;font-size:16px;letter-spacing:3px;color:#141416">THE RELEASE</div>
    </div>`,
  ],

  // ── CASTER lower-third (KBT geometry, Blacktop colours) ──────────────
  'caster-onair': [
    130,
    36,
    `
    <div style="position:absolute;inset:0;background:${ORANGE};clip-path:polygon(0 0,calc(100% - 12px) 0,100% 100%,0 100%);display:flex;align-items:center;gap:10px;padding:0 16px">
      <div style="width:8px;height:8px;border-radius:50%;background:#141416"></div>
      <div class="bs" style="font-weight:800;font-size:16px;letter-spacing:3px;color:#141416">ON AIR</div>
    </div>`,
  ],
  // Dynamic slots: commentator name at (30,12) BS800 36.
  'caster-plate': [
    470,
    88,
    `
    <div style="position:absolute;inset:0;background:${ASPHALT};border:${RULE}">
      <div class="mono" style="position:absolute;left:30px;bottom:12px;font-size:15px;letter-spacing:3px;color:${ORANGE}">COMMENTARY · BLACKTOP</div>
    </div>`,
  ],

  // ── ENDED panel, output pos: centered (x=360, y=180) ─────────────────
  // Dynamic slots: team columns at x 60 (A) and 660 (B), each 480 wide:
  // colour bar (col, 120, 480, 10); name at (col, 150) BS700 40; score at
  // (col, 200) BS800 190; stat rows from y 430, pitch 48 (mono 20 label /
  // BS700 30 value right-aligned at col+480). Footer at (60, 640) mono 16.
  'ended-panel': [
    1200,
    720,
    `
    <div style="position:absolute;inset:0;background:rgba(20,20,22,.95);border:${RULE};${cut(30)};padding:40px 60px">
      <div style="display:flex;align-items:center;gap:16px">
        <div style="width:8px;height:48px;background:${ORANGE};clip-path:polygon(0 0,100% 5px,100% 100%,0 calc(100% - 5px))"></div>
        <div class="bs" style="font-weight:800;font-size:56px;letter-spacing:3px;color:${CHALK};text-transform:uppercase;line-height:1">Final</div>
        <div class="mono" style="font-size:15px;letter-spacing:5px;color:${DIM};margin-left:18px">BLACKTOP · SMELTER STREETBALL</div>
      </div>
      <div style="position:absolute;left:590px;top:130px;width:1px;height:490px;background:rgba(244,239,230,.14)"></div>
      ${['MAKES', 'ATTEMPTS', 'FG%', 'TWOS']
        .map(
          (l, i) => `
      <div class="mono" style="position:absolute;left:60px;top:${430 + i * 48}px;font-size:16px;letter-spacing:3px;color:${DIM}">${l}</div>
      <div class="mono" style="position:absolute;left:660px;top:${430 + i * 48}px;font-size:16px;letter-spacing:3px;color:${DIM}">${l}</div>`,
        )
        .join('')}
      <div style="position:absolute;left:60px;right:60px;top:632px;height:1px;background:rgba(244,239,230,.12)"></div>
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
