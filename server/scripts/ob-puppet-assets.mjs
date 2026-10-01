#!/usr/bin/env node
/**
 * Smelterionaire live-puppet art: renders the layered character sprites the
 * puppet renderer (server/src/obVan/puppets) composes at runtime, plus the
 * studio set pieces. Pure SVG → PNG via headless Chrome, like
 * ob-render-assets.mjs; outputs land in server/imgs/ob and are registered at
 * boot as `ob-<name>` engine images.
 *
 *   node scripts/ob-puppet-assets.mjs            # render everything
 *   node scripts/ob-puppet-assets.mjs puppet-lux-mouth-a puppet-studio-wall
 *
 * Every character shares one 900×1200 logical canvas and one face geometry
 * (PUPPET_GEOM in server/src/obVan/puppets/geometry.ts mirrors these boxes),
 * so the renderer can place any character's layers with the same rects:
 *   body  (incl. -cheer)  BODY_BOX   — torso, arms
 *   head                  HEAD_BOX   — skull, ears, hair, static accessories
 *   eyes-open/closed      EYES_BOX   — incl. glasses / lashes
 *   brows / brows-up      BROWS_BOX
 *   mouth-<viseme>        MOUTH_BOX  — rest m e a o s
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'imgs', 'ob');

const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// ── shared geometry (mirrored in server/src/obVan/puppets/geometry.ts) ─────
const CX = 450;
const HEAD_CY = 430;
const EYE_Y = 445;
const EYE_DX = 85;
const BROW_Y = 378;
const MOUTH_X = 450;
const MOUTH_Y = 590;

const BODY_BOX = { x: 40, y: 490, w: 820, h: 710 };
const HEAD_BOX = { x: 170, y: 130, w: 560, h: 860 };
const EYES_BOX = { x: 235, y: 355, w: 430, h: 180 };
const BROWS_BOX = { x: 290, y: 318, w: 320, h: 112 };
const MOUTH_BOX = { x: 330, y: 520, w: 240, h: 190 };

const INK = '#221433';
const OUTLINE = 14;
const GOLD = '#FFD166';

const SKIN = {
  warm: '#f2b98c',
  tan: '#d99a62',
  deep: '#9c6b43',
  pale: '#f7cfae',
  olive: '#c89066',
};

// ── svg helpers ────────────────────────────────────────────────────────────
const P = (d, fill, extra = '') =>
  `<path d="${d}" fill="${fill}" stroke="${INK}" stroke-width="${OUTLINE}" stroke-linejoin="round" stroke-linecap="round" ${extra}/>`;
const PN = (d, fill, extra = '') => `<path d="${d}" fill="${fill}" ${extra}/>`;
const E = (cx, cy, rx, ry, fill, extra = '') =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${INK}" stroke-width="${OUTLINE}" ${extra}/>`;
const EN = (cx, cy, rx, ry, fill, extra = '') =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" ${extra}/>`;
const R = (x, y, w, h, rx, fill, extra = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${INK}" stroke-width="${OUTLINE}" ${extra}/>`;
const L = (x1, y1, x2, y2, w = OUTLINE, color = INK) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;

function starPath(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push(`${cx + rr * Math.cos(a)},${cy + rr * Math.sin(a)}`);
  }
  return `M ${pts.join(' L ')} Z`;
}

// ── body (torso to the desk line; `cheer` raises both arms) ────────────────
function torso({ coat, shirt, tie, skin, tieColor = '#5b2d91', lapel = null }) {
  const sh = 250;
  const topY = 760;
  const parts = [];
  parts.push(P(`M ${CX - 55} ${topY - 110} h 110 v 90 h -110 Z`, skin));
  parts.push(
    P(
      `M ${CX - sh} 1210 V ${topY + 90} Q ${CX - sh} ${topY} ${CX - sh + 90} ${topY - 10} L ${CX - 60} ${topY - 25} L ${CX} ${topY + 10} L ${CX + 60} ${topY - 25} L ${CX + sh - 90} ${topY - 10} Q ${CX + sh} ${topY} ${CX + sh} ${topY + 90} V 1210 Z`,
      coat,
    ),
  );
  parts.push(
    P(
      `M ${CX - 60} ${topY - 25} L ${CX} ${topY + 65} L ${CX + 60} ${topY - 25} L ${CX + 40} ${topY + 160} h -80 Z`,
      shirt,
    ),
  );
  if (tie === 'tie') {
    parts.push(P(`M ${CX - 22} ${topY + 15} h 44 l -10 30 h -24 Z`, tieColor));
    parts.push(
      P(`M ${CX - 16} ${topY + 45} h 32 l 14 120 l -30 40 l -30 -40 Z`, tieColor),
    );
  } else if (tie === 'bow') {
    parts.push(P(`M ${CX - 14} ${topY + 8} h 28 v 26 h -28 Z`, tieColor));
    parts.push(P(`M ${CX - 14} ${topY + 21} l -52 -26 v 52 Z`, tieColor));
    parts.push(P(`M ${CX + 14} ${topY + 21} l 52 -26 v 52 Z`, tieColor));
  }
  if (lapel) {
    parts.push(
      PN(`M ${CX - 60} ${topY - 25} L ${CX} ${topY + 65} L ${CX - 95} ${topY + 120} Z`, lapel),
    );
    parts.push(
      PN(`M ${CX + 60} ${topY - 25} L ${CX} ${topY + 65} L ${CX + 95} ${topY + 120} Z`, lapel),
    );
  }
  return parts.join('');
}

/** Raised celebration arms, drawn over the torso: sleeve + fist per side. */
function cheerArms(coat, skin) {
  const arm = (side) => {
    const sx = CX + side * 225; // shoulder
    const fx = CX + side * 330; // fist
    return (
      P(
        `M ${sx - side * 30} 840 Q ${sx + side * 60} 790 ${fx - side * 10} 640 L ${fx + side * 30} 600 L ${fx + side * 70} 660 Q ${sx + side * 95} 800 ${sx + side * 40} 880 Z`,
        coat,
      ) + E(fx + side * 28, 588, 44, 44, skin)
    );
  };
  return arm(-1) + arm(1);
}

// ── head base (skull + ears + nose + cheeks; hair goes on top) ─────────────
function headBase(skin) {
  const parts = [];
  parts.push(E(CX - 190, HEAD_CY + 40, 38, 52, skin));
  parts.push(E(CX + 190, HEAD_CY + 40, 38, 52, skin));
  parts.push(
    P(
      `M ${CX - 185} ${HEAD_CY + 20} Q ${CX - 185} ${HEAD_CY - 185} ${CX} ${HEAD_CY - 185} Q ${CX + 185} ${HEAD_CY - 185} ${CX + 185} ${HEAD_CY + 20} Q ${CX + 185} ${HEAD_CY + 215} ${CX} ${HEAD_CY + 215} Q ${CX - 185} ${HEAD_CY + 215} ${CX - 185} ${HEAD_CY + 20} Z`,
      skin,
    ),
  );
  parts.push(P(`M ${CX - 2} ${EYE_Y + 18} q 34 44 6 64 q -14 10 -26 2`, 'none'));
  parts.push(EN(CX - 120, EYE_Y + 70, 34, 22, '#00000012'));
  parts.push(EN(CX + 120, EYE_Y + 70, 34, 22, '#00000012'));
  return parts.join('');
}

// ── eyes / brows ───────────────────────────────────────────────────────────
function eyesOpen(iris) {
  const e = (dx) =>
    EN(CX + dx, EYE_Y, 34, 38, '#ffffff') +
    EN(CX + dx, EYE_Y + 4, 16, 18, iris) +
    EN(CX + dx + 6, EYE_Y - 4, 6, 7, '#ffffff') +
    `<path d="M ${CX + dx - 34} ${EYE_Y} a 34 38 0 0 1 68 0" fill="none" stroke="${INK}" stroke-width="10"/>`;
  return e(-EYE_DX) + e(EYE_DX);
}
function eyesClosed() {
  const e = (dx) =>
    `<path d="M ${CX + dx - 30} ${EYE_Y + 6} q 30 26 60 0" fill="none" stroke="${INK}" stroke-width="12" stroke-linecap="round"/>`;
  return e(-EYE_DX) + e(EYE_DX);
}
function brows(up, color = INK, thick = 16) {
  const y = up ? BROW_Y - 22 : BROW_Y;
  const arc = up ? 26 : 12;
  const b = (dx) =>
    `<path d="M ${CX + dx - 44} ${y + 8} q 44 ${-arc} 88 0" fill="none" stroke="${color}" stroke-width="${thick}" stroke-linecap="round"/>`;
  return b(-EYE_DX) + b(EYE_DX);
}

// ── mouth visemes ──────────────────────────────────────────────────────────
const MOUTHS = {
  rest: () =>
    `<path d="M ${MOUTH_X - 70} ${MOUTH_Y - 8} q 70 52 140 0" fill="none" stroke="${INK}" stroke-width="14" stroke-linecap="round"/>`,
  m: () =>
    `<path d="M ${MOUTH_X - 62} ${MOUTH_Y + 2} q 62 20 124 0" fill="none" stroke="${INK}" stroke-width="16" stroke-linecap="round"/>`,
  e: () =>
    P(
      `M ${MOUTH_X - 58} ${MOUTH_Y - 6} q 58 -18 116 0 q -58 44 -116 0 Z`,
      '#7c2d3e',
    ) +
    PN(
      `M ${MOUTH_X - 44} ${MOUTH_Y - 8} q 44 -12 88 0 l -4 12 q -40 -10 -80 0 Z`,
      '#ffffff',
    ),
  a: () =>
    P(
      `M ${MOUTH_X - 62} ${MOUTH_Y - 14} q 62 -24 124 0 q 2 86 -62 86 q -64 0 -62 -86 Z`,
      '#6e2437',
    ) +
    PN(
      `M ${MOUTH_X - 48} ${MOUTH_Y - 16} q 48 -16 96 0 l -6 18 q -42 -14 -84 0 Z`,
      '#ffffff',
    ) +
    EN(MOUTH_X, MOUTH_Y + 52, 34, 18, '#c4506a'),
  o: () =>
    E(MOUTH_X, MOUTH_Y + 10, 38, 50, '#6e2437') +
    EN(MOUTH_X, MOUTH_Y + 34, 20, 14, '#c4506a'),
  s: () =>
    P(
      `M ${MOUTH_X - 85} ${MOUTH_Y - 18} q 85 30 170 0 q -10 70 -85 70 q -75 0 -85 -70 Z`,
      '#6e2437',
    ) +
    PN(
      `M ${MOUTH_X - 70} ${MOUTH_Y - 12} q 70 22 140 0 l -4 16 q -66 -18 -132 0 Z`,
      '#ffffff',
    ),
};

// ── the cast ───────────────────────────────────────────────────────────────
const CAST = {
  host: {
    skin: SKIN.warm,
    iris: '#2d4a7a',
    coat: '#d9a62e',
    browColor: INK,
    body: () =>
      torso({
        coat: '#d9a62e',
        shirt: '#ffffff',
        tie: 'tie',
        skin: SKIN.warm,
        tieColor: '#4b2d8f',
        lapel: '#b9881f',
      }) + PN(`M ${CX + 130} 880 l 56 -18 l 8 34 l -52 12 Z`, '#4b2d8f'),
    hair: () =>
      P(
        `M ${CX - 192} ${HEAD_CY - 10} Q ${CX - 205} ${HEAD_CY - 215} ${CX - 40} ${HEAD_CY - 222} Q ${CX + 130} ${HEAD_CY - 240} ${CX + 196} ${HEAD_CY - 60} Q ${CX + 150} ${HEAD_CY - 150} ${CX + 60} ${HEAD_CY - 150} Q ${CX - 120} ${HEAD_CY - 140} ${CX - 150} ${HEAD_CY - 40} Z`,
        '#cfd4dc',
      ),
    headExtra: () => '',
    eyesExtra: () => '',
  },
  nova: {
    skin: SKIN.tan,
    iris: '#1f6f5f',
    coat: '#3f7fd9',
    browColor: INK,
    body: () =>
      torso({ coat: '#3f7fd9', shirt: '#f3e9d7', tie: null, skin: SKIN.tan }) +
      P(`M ${CX - 60} 735 l -60 70 l 40 30 Z`, '#346ab5') +
      P(`M ${CX + 60} 735 l 60 70 l -40 30 Z`, '#346ab5'),
    hair: () =>
      P(
        `M ${CX - 195} ${HEAD_CY + 10} Q ${CX - 215} ${HEAD_CY - 230} ${CX + 10} ${HEAD_CY - 225} Q ${CX + 215} ${HEAD_CY - 220} ${CX + 193} ${HEAD_CY - 20} Q ${CX + 170} ${HEAD_CY - 120} ${CX + 70} ${HEAD_CY - 128} Q ${CX + 115} ${HEAD_CY - 95} ${CX + 85} ${HEAD_CY - 60} Q ${CX - 40} ${HEAD_CY - 170} ${CX - 148} ${HEAD_CY - 60} Z`,
        '#2fb8a6',
      ),
    headExtra: () =>
      PN(starPath(CX - 190, HEAD_CY + 110, 22), GOLD) +
      PN(starPath(CX + 190, HEAD_CY + 110, 22), GOLD),
    eyesExtra: () => '',
  },
  bit: {
    skin: SKIN.pale,
    iris: '#4a3b85',
    coat: '#e6603f',
    browColor: INK,
    body: () =>
      torso({ coat: '#e6603f', shirt: '#2b2b3d', tie: null, skin: SKIN.pale }) +
      L(CX - 40, 790, CX - 40, 900, 10) +
      L(CX + 40, 790, CX + 40, 900, 10),
    hair: () =>
      P(
        `M ${CX - 196} ${HEAD_CY - 40} Q ${CX - 196} ${HEAD_CY - 235} ${CX} ${HEAD_CY - 235} Q ${CX + 196} ${HEAD_CY - 235} ${CX + 196} ${HEAD_CY - 40} l -14 0 q 0 -40 -182 -40 q -182 0 -182 40 Z`,
        '#e6603f',
      ) + R(CX - 200, HEAD_CY - 60, 400, 46, 20, '#d1532f'),
    headExtra: () => '',
    eyesExtra: () =>
      `<circle cx="${CX - EYE_DX}" cy="${EYE_Y}" r="56" fill="#ffffff22" stroke="${INK}" stroke-width="12"/>` +
      `<circle cx="${CX + EYE_DX}" cy="${EYE_Y}" r="56" fill="#ffffff22" stroke="${INK}" stroke-width="12"/>` +
      L(CX - 29, EYE_Y - 10, CX + 29, EYE_Y - 10, 12) +
      L(CX - EYE_DX - 56, EYE_Y - 6, CX - 196, EYE_Y - 16, 12) +
      L(CX + EYE_DX + 56, EYE_Y - 6, CX + 196, EYE_Y - 16, 12),
  },
  prof: {
    skin: SKIN.olive,
    iris: '#3a3a3a',
    coat: '#6d5a44',
    browColor: '#bbbbbb',
    browThick: 20,
    body: () =>
      torso({
        coat: '#6d5a44',
        shirt: '#efe7d8',
        tie: 'bow',
        skin: SKIN.olive,
        tieColor: '#9c2f2f',
      }) +
      EN(CX, 950, 9, 9, INK) +
      EN(CX, 1030, 9, 9, INK),
    hair: () =>
      P(`M ${CX - 196} ${HEAD_CY + 20} q -26 -60 10 -90 q 10 60 30 80 Z`, '#cccccc') +
      P(`M ${CX + 196} ${HEAD_CY + 20} q 26 -60 -10 -90 q -10 60 -30 80 Z`, '#cccccc') +
      P(
        `M ${CX - 150} ${HEAD_CY + 120} Q ${CX - 120} ${HEAD_CY + 260} ${CX} ${HEAD_CY + 262} Q ${CX + 120} ${HEAD_CY + 260} ${CX + 150} ${HEAD_CY + 120} Q ${CX + 90} ${HEAD_CY + 180} ${CX} ${HEAD_CY + 180} Q ${CX - 90} ${HEAD_CY + 180} ${CX - 150} ${HEAD_CY + 120} Z`,
        '#d8d8d8',
      ),
    headExtra: () => '',
    eyesExtra: () => '',
  },
  lux: {
    skin: SKIN.deep,
    iris: '#6b3b17',
    coat: '#20203a',
    browColor: INK,
    body: () =>
      torso({
        coat: '#20203a',
        shirt: '#e8c25c',
        tie: null,
        skin: SKIN.deep,
        lapel: '#15152a',
      }) +
      `<path d="M ${CX - 58} 742 q 58 60 116 0" fill="none" stroke="${GOLD}" stroke-width="12"/>` +
      EN(CX, 802, 12, 14, GOLD),
    hair: () =>
      P(
        `M ${CX - 250} 980 Q ${CX - 260} ${HEAD_CY - 120} ${CX - 140} ${HEAD_CY - 205} Q ${CX} ${HEAD_CY - 260} ${CX + 140} ${HEAD_CY - 205} Q ${CX + 260} ${HEAD_CY - 120} ${CX + 250} 980 L ${CX + 150} 980 Q ${CX + 185} ${HEAD_CY + 160} ${CX + 150} ${HEAD_CY - 40} Q ${CX + 120} ${HEAD_CY - 130} ${CX} ${HEAD_CY - 130} Q ${CX - 120} ${HEAD_CY - 130} ${CX - 150} ${HEAD_CY - 40} Q ${CX - 185} ${HEAD_CY + 160} ${CX - 150} 980 Z`,
        '#c2317e',
      ),
    headExtra: () =>
      `<circle cx="${CX - 186}" cy="${HEAD_CY + 120}" r="20" fill="none" stroke="${GOLD}" stroke-width="10"/>` +
      `<circle cx="${CX + 186}" cy="${HEAD_CY + 120}" r="20" fill="none" stroke="${GOLD}" stroke-width="10"/>`,
    eyesExtra: () =>
      L(CX - EYE_DX - 40, EYE_Y - 30, CX - EYE_DX - 54, EYE_Y - 40, 8) +
      L(CX + EYE_DX + 40, EYE_Y - 30, CX + EYE_DX + 54, EYE_Y - 40, 8),
  },
};

// ── studio set pieces ──────────────────────────────────────────────────────
/** 1920×1080 LED back wall: navy radial glow, gold hex lattice, floor band. */
function studioWall() {
  const hexes = [];
  const a = 74; // hex radius
  const hx = a * Math.sqrt(3);
  for (let row = -1; row < 12; row++) {
    for (let col = -1; col < 17; col++) {
      const cx = col * hx + (row % 2 ? hx / 2 : 0);
      const cy = row * a * 1.5;
      const pts = [];
      for (let i = 0; i < 6; i++) {
        const ang = (Math.PI / 3) * i + Math.PI / 6;
        pts.push(`${(cx + a * 0.92 * Math.cos(ang)).toFixed(1)},${(cy + a * 0.92 * Math.sin(ang)).toFixed(1)}`);
      }
      hexes.push(`<polygon points="${pts.join(' ')}" fill="none" stroke="#FFD166" stroke-width="2.5"/>`);
    }
  }
  return `
  <defs>
    <radialGradient id="wallGlow" cx="50%" cy="38%" r="75%">
      <stop offset="0%" stop-color="#1d2c5e"/>
      <stop offset="45%" stop-color="#101a3c"/>
      <stop offset="100%" stop-color="#070b18"/>
    </radialGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0d1430"/>
      <stop offset="18%" stop-color="#11204a"/>
      <stop offset="100%" stop-color="#05070f"/>
    </linearGradient>
    <radialGradient id="beamL" cx="50%" cy="0%" r="100%">
      <stop offset="0%" stop-color="#FFD16626"/>
      <stop offset="100%" stop-color="#FFD16600"/>
    </radialGradient>
    <linearGradient id="hexFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.32"/>
      <stop offset="60%" stop-color="#ffffff" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <mask id="hexMask"><rect width="1920" height="820" fill="url(#hexFade)"/></mask>
  </defs>
  <rect width="1920" height="1080" fill="url(#wallGlow)"/>
  <g mask="url(#hexMask)">${hexes.join('')}</g>
  <ellipse cx="400" cy="0" rx="700" ry="620" fill="url(#beamL)"/>
  <ellipse cx="1520" cy="0" rx="700" ry="620" fill="url(#beamL)"/>
  <rect y="820" width="1920" height="260" fill="url(#floor)"/>
  <rect y="816" width="1920" height="6" fill="#FFD166" opacity="0.55"/>
  <rect y="824" width="1920" height="2" fill="#FFD166" opacity="0.25"/>
  <rect width="1920" height="1080" fill="url(#vign)"/>
  <defs>
    <radialGradient id="vign" cx="50%" cy="46%" r="78%">
      <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="78%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.5"/>
    </radialGradient>
  </defs>`;
}

/** 900×330 contestant desk: gold-trimmed navy hex plate, wordmark strip. */
function studioDesk() {
  const cut = 56;
  const plate = `M ${cut} 28 H ${900 - cut} L ${900 - 10} ${28 + cut} V 320 H 10 V ${28 + cut} Z`;
  return `
  <defs>
    <linearGradient id="deskG" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#16214a"/>
      <stop offset="30%" stop-color="#0c1430"/>
      <stop offset="100%" stop-color="#070b18"/>
    </linearGradient>
    <linearGradient id="goldG" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#FFE9B0"/>
      <stop offset="50%" stop-color="#FFD166"/>
      <stop offset="100%" stop-color="#B8860B"/>
    </linearGradient>
  </defs>
  <path d="${plate}" fill="url(#deskG)" stroke="url(#goldG)" stroke-width="5"/>
  <path d="M ${cut + 8} 40 H ${900 - cut - 8} L ${900 - 22} ${40 + cut - 6} V 60 H 22 V ${40 + cut - 6} Z" fill="#FFD16614"/>
  <rect x="330" y="196" width="240" height="4" fill="url(#goldG)" opacity="0.8"/>
  <text x="450" y="172" text-anchor="middle" font-family="'Big Shoulders Display'" font-weight="800" font-size="64" fill="url(#goldG)" letter-spacing="6">SMELTERIONAIRE</text>
  <rect x="330" y="232" width="240" height="4" fill="url(#goldG)" opacity="0.8"/>`;
}

/** Radial gold speaking glow, three intensities. */
function glow(strength) {
  return `
  <defs>
    <radialGradient id="g" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#FFD166" stop-opacity="${0.34 * strength}"/>
      <stop offset="55%" stop-color="#FFB84D" stop-opacity="${0.16 * strength}"/>
      <stop offset="100%" stop-color="#FFB84D" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="800" height="800" fill="url(#g)"/>`;
}

// ── asset table: name → [logicalW, logicalH, scale, svgBody] ───────────────
function characterAssets() {
  const out = {};
  const crop = (box, k, body) =>
    [
      Math.round(box.w * k),
      Math.round(box.h * k),
      `<g transform="scale(${k}) translate(${-box.x}, ${-box.y})">${body}</g>`,
    ];
  for (const [key, c] of Object.entries(CAST)) {
    const browThick = c.browThick ?? 16;
    out[`puppet-${key}-body`] = crop(BODY_BOX, 1.5, c.body());
    out[`puppet-${key}-body-cheer`] = crop(
      BODY_BOX,
      1.5,
      c.body() + cheerArms(c.coat, c.skin),
    );
    out[`puppet-${key}-head`] = crop(
      HEAD_BOX,
      1.5,
      headBase(c.skin) + c.hair() + c.headExtra(),
    );
    out[`puppet-${key}-eyes-open`] = crop(
      EYES_BOX,
      2,
      eyesOpen(c.iris) + c.eyesExtra(),
    );
    out[`puppet-${key}-eyes-closed`] = crop(
      EYES_BOX,
      2,
      eyesClosed() + c.eyesExtra(),
    );
    out[`puppet-${key}-brows`] = crop(
      BROWS_BOX,
      2,
      brows(false, c.browColor, browThick),
    );
    out[`puppet-${key}-brows-up`] = crop(
      BROWS_BOX,
      2,
      brows(true, c.browColor, browThick),
    );
    for (const [v, draw] of Object.entries(MOUTHS)) {
      out[`puppet-${key}-mouth-${v}`] = crop(MOUTH_BOX, 2, draw());
    }
  }
  return out;
}

const ASSETS = {
  ...characterAssets(),
  'puppet-studio-wall': [1920, 1080, studioWall()],
  'puppet-studio-desk': [1800, 660, `<g transform="scale(2)">${studioDesk()}</g>`],
  'puppet-glow-1': [800, 800, glow(0.45)],
  'puppet-glow-2': [800, 800, glow(0.75)],
  'puppet-glow-3': [800, 800, glow(1)],
};

// ── renderer (ob-render-assets.mjs pattern) ────────────────────────────────
const FONT_CSS = `
  @font-face { font-family: 'Big Shoulders Display'; font-weight: 800;
    src: url('file://${ROOT}/fonts/big-shoulders/BigShouldersDisplay-ExtraBold.ttf'); }
`;

function render(name, [w, h, body]) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    ${FONT_CSS}
    html, body { margin: 0; padding: 0; background: transparent; }
  </style></head><body>
  <svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>
  </body></html>`;
  const tmp = path.join(os.tmpdir(), `ob-puppet-${name}.html`);
  writeFileSync(tmp, html);
  execFileSync(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--force-device-scale-factor=1',
    '--default-background-color=00000000',
    '--hide-scrollbars',
    `--window-size=${w},${h}`,
    `--screenshot=${path.join(OUT_DIR, `${name}.png`)}`,
    `file://${tmp}`,
  ]);
  rmSync(tmp, { force: true });
  console.log(`rendered ${name}.png (${w}x${h})`);
}

const only = process.argv.slice(2);
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
if (!existsSync(CHROME)) {
  console.error(`Chrome not found at ${CHROME}; set CHROME_PATH`);
  process.exit(1);
}
for (const [name, spec] of Object.entries(ASSETS)) {
  if (only.length && !only.includes(name)) continue;
  render(name, spec);
}
