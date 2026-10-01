#!/usr/bin/env node
// Renders the slide deck of the OB Van demo panel ("Should AI direct live
// TV?") into 1920×1080 PNGs with system Chrome in headless mode — same
// pipeline as ob-render-assets.mjs. scripts/ob-demo/panel.conductor.txt
// points its SLIDE events at them; replace them with your own exported deck
// (Keynote / Google Slides → PNG) by keeping the file names or editing the
// script.
//
//   node scripts/ob-demo-slides.mjs [--deck panel|nba] [--out data/ob-demo-raw/<deck>/slides]

import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { FONTS_DIR, RAW_DIR, resolveCli } from './lib/ob-media.mjs';

const execFileP = promisify(execFile);
const { values: opt } = parseArgs({
  options: {
    out: { type: 'string' },
    deck: { type: 'string', default: 'panel' },
  },
});
const OUT = opt.out
  ? resolveCli(opt.out)
  : path.join(RAW_DIR, opt.deck, 'slides');

const CHALK = '#F2F4F8';
const RED = '#FF2D2D';
const SKY = '#38BDF8';
const DIM = 'rgba(242,244,248,.6)';
const RULE = 'rgba(242,244,248,.16)';

const head = `<meta charset="utf-8"><style>
@font-face{font-family:'BSD';font-weight:700;src:url('file://${FONTS_DIR}/big-shoulders/BigShouldersDisplay-Bold.ttf')}
@font-face{font-family:'BSD';font-weight:900;src:url('file://${FONTS_DIR}/big-shoulders/BigShouldersDisplay-Black.ttf')}
@font-face{font-family:'Plex';font-weight:400;src:url('file://${FONTS_DIR}/ibm-plex-mono/IBMPlexMono-Regular.ttf')}
@font-face{font-family:'Plex';font-weight:600;src:url('file://${FONTS_DIR}/ibm-plex-mono/IBMPlexMono-SemiBold.ttf')}
html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#0A0C10;color:${CHALK}}
.s{position:relative;width:1920px;height:1080px;padding:120px 150px;box-sizing:border-box;
  background:radial-gradient(1400px 700px at 80% 0%,rgba(56,189,248,.10),transparent 60%),#0A0C10}
.kick{font:600 28px 'Plex';letter-spacing:.24em;color:${DIM};text-transform:uppercase}
.kick b{color:${RED};font-weight:600}
h1{font:900 180px/0.92 'BSD';margin:36px 0 0;text-transform:uppercase;letter-spacing:.01em}
h2{font:900 120px/0.95 'BSD';margin:28px 0 0;text-transform:uppercase}
p{font:400 34px/1.45 'Plex';color:${DIM};margin:28px 0 0;max-width:1300px}
.foot{position:absolute;left:150px;right:150px;bottom:90px;display:flex;justify-content:space-between;
  border-top:1px solid ${RULE};padding-top:26px;font:600 24px 'Plex';letter-spacing:.18em;color:${DIM};text-transform:uppercase}
.row{display:flex;align-items:center;gap:40px;margin-top:70px}
.lab{width:420px;font:600 30px 'Plex';color:${CHALK}}
.axis{position:relative;flex:1;height:84px;border-left:3px solid ${CHALK}}
.bar{position:absolute;top:12px;height:60px;border-radius:4px}
.val{font:900 64px 'BSD';width:260px;text-align:right}
.cols{display:flex;gap:80px;margin-top:80px}
.col{flex:1;border-top:4px solid var(--c);padding-top:30px}
.col .t{font:900 76px/1 'BSD';text-transform:uppercase;color:var(--c)}
.col p{font-size:30px}
</style>`;

const foot = (n, label = 'Smelter workshop · OB Van') =>
  `<div class="foot"><span>${label}</span><span>${n} / 4</span></div>`;

const PANEL = {
  '01-title': `<div class="s">
    <div class="kick"><b>● LIVE</b> · panel</div>
    <h1>Should AI direct<br>live TV?</h1>
    <p>Three panelists, three cameras, one set of slides — and a director that has never had a coffee break.</p>
    ${foot(1)}</div>`,
  '02-numbers': `<div class="s">
    <div class="kick">the numbers</div>
    <h2>When does the cut land?</h2>
    <p>Measured from the first syllable of a new speaker.</p>
    <div class="row"><div class="lab">Human director</div>
      <div class="axis"><div class="bar" style="left:0;width:62%;background:${DIM}"></div></div>
      <div class="val">after</div></div>
    <div class="row"><div class="lab">OB Van · TALK</div>
      <div class="axis" style="border-left-color:${RED}"><div class="bar" style="left:-9%;width:9%;background:${SKY}"></div></div>
      <div class="val" style="color:${SKY}">−200 ms</div></div>
    <p style="margin-top:70px;font-size:28px">A human can only react once they hear it. The AI hears the side channel 3 s before the viewers do.</p>
    ${foot(2)}</div>`,
  '03-debate': `<div class="s">
    <div class="kick">the debate</div>
    <h2>Automation — or direction?</h2>
    <div class="cols">
      <div class="col" style="--c:${SKY}"><div class="t">It reads audio</div><p>Who is speaking, how loud, who is moving, who we haven't seen in a while.</p></div>
      <div class="col" style="--c:${RED}"><div class="t">It can't read the room</div><p>No taste, no story, no idea why the sneeze was not the moment.</p></div>
    </div>
    ${foot(3)}</div>`,
  '04-closing': `<div class="s">
    <div class="kick">closing</div>
    <h1>Thanks for<br>watching</h1>
    <p>Directed live by OB Van. Every cut has a reason in the WHY log.</p>
    ${foot(4)}</div>`,
};

const NBA_FOOT = 'Full Court Press · NBA';
const NBA = {
  '01-title': `<div class="s">
    <div class="kick"><b>● LIVE</b> · nba panel · sep 30 2026</div>
    <h1>Full Court<br>Press</h1>
    <p>LeBron in Philly — the season preview. Three voices, one desk, and an AI director in the truck.</p>
    ${foot(1, NBA_FOOT)}</div>`,
  '02-numbers': `<div class="s">
    <div class="kick">the numbers</div>
    <h2>LeBron by the numbers</h2>
    <div class="row"><div class="lab">Career points</div>
      <div class="axis"><div class="bar" style="left:0;width:96%;background:${SKY}"></div></div>
      <div class="val" style="color:${SKY}">43,241</div></div>
    <div class="row"><div class="lab">NBA seasons</div>
      <div class="axis"><div class="bar" style="left:0;width:78%;background:${DIM}"></div></div>
      <div class="val">24th</div></div>
    <div class="row"><div class="lab">Championships</div>
      <div class="axis"><div class="bar" style="left:0;width:26%;background:${RED}"></div></div>
      <div class="val" style="color:${RED}">4</div></div>
    <p style="margin-top:70px;font-size:28px">Age 41. First season in Philadelphia — alongside Jaylen Brown.</p>
    ${foot(2, NBA_FOOT)}</div>`,
  '03-debate': `<div class="s">
    <div class="kick">the debate</div>
    <h2>Can Philly get past the champs?</h2>
    <div class="cols">
      <div class="col" style="--c:${SKY}"><div class="t">The pieces</div><p>LeBron and Jaylen Brown on one wing — the deepest starting five in the East, on paper.</p></div>
      <div class="col" style="--c:${RED}"><div class="t">The age question</div><p>Year 24 at age 41, while the champions in New York are young, deep and hungry.</p></div>
    </div>
    ${foot(3, NBA_FOOT)}</div>`,
  '04-closing': `<div class="s">
    <div class="kick">closing</div>
    <h1>Predictions</h1>
    <p>Three predictions, one desk. Directed live by OB Van — every cut has a reason in the WHY log.</p>
    ${foot(4, NBA_FOOT)}</div>`,
};

const DECKS = { panel: PANEL, nba: NBA };
const SLIDES = DECKS[opt.deck];
if (!SLIDES) {
  console.error(
    `Unknown deck "${opt.deck}" — pick one of: ${Object.keys(DECKS).join(', ')}`,
  );
  process.exit(1);
}

async function findChrome() {
  for (const p of [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean)) {
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
  const chrome = await findChrome();
  mkdirSync(OUT, { recursive: true });
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'ob-slides-'));
  try {
    for (const [name, body] of Object.entries(SLIDES)) {
      const html = path.join(tmp, `${name}.html`);
      writeFileSync(
        html,
        `<!doctype html><html><head>${head}</head><body>${body}</body></html>`,
      );
      const out = path.join(OUT, `${name}.png`);
      await execFileP(chrome, [
        '--headless=new',
        '--disable-gpu',
        '--force-device-scale-factor=1',
        '--hide-scrollbars',
        '--window-size=1920,1080',
        `--screenshot=${out}`,
        `file://${html}`,
      ]);
      console.log(`rendered ${path.relative(process.cwd(), out)}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
