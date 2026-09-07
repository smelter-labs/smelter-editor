#!/usr/bin/env node
// Render a synthetic hoop-camera clip for the basketball-scorer pipeline:
// an asphalt background, a white rim ellipse at the default rim params with a
// net under it, two "players" (solid jersey rectangles in the team colours)
// and an orange ball flying five scripted shots — three swishes, one rim-out,
// one ball flying straight past the rim. No npm deps: frames are rasterized
// into a raw RGB buffer and piped into ffmpeg.
//
//   node scripts/basketball-synth-clip.mjs            → data/mp4s/bb-synth.mp4
//   node scripts/basketball-synth-clip.mjs out.mp4
//
// Drive it with `ballDetector: 'hsv'` (no YOLO needed): expected 3 makes
// (A, B, A) and 5 attempts. Team colours: A green #2ee06a, B blue #1f7bff
// (deliberately not orange — the HSV person detector keys on them).

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 1280;
const H = 720;
const FPS = 30;
const ASPECT = W / H;
const RIM = { cx: 0.5, cy: 0.35, rx: 0.06, ry: 0.02 };
const RXY = RIM.rx * ASPECT;
const NET_DEPTH = 2.0 * RXY; // matches analysis.NET_DEPTH
const TEAM = { A: '#2ee06a', B: '#1f7bff' };
const BALL = [255, 122, 31];
const BALL_R = Math.round(0.55 * RIM.rx * W); // ~42 px diameter

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(here, '..', 'data', 'mp4s', 'bb-synth.mp4');

const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const PLAYER = {
  A: { x0: 0.1, x1: 0.18, y0: 0.45, y1: 0.85, rgb: hex(TEAM.A) },
  B: { x0: 0.82, x1: 0.9, y0: 0.45, y1: 0.85, rgb: hex(TEAM.B) },
};
const hands = (p) => ({ x: (p.x0 + p.x1) / 2, y: p.y0 + 0.03 });

// ── raster helpers (normalized coords in, pixels out) ───────────────────────
const frame = new Uint8Array(W * H * 3);
function fill(rgb) {
  for (let i = 0; i < W * H; i++) {
    frame[i * 3] = rgb[0];
    frame[i * 3 + 1] = rgb[1];
    frame[i * 3 + 2] = rgb[2];
  }
}
function rect(x0, y0, x1, y1, rgb) {
  const px0 = Math.max(0, Math.round(x0 * W));
  const px1 = Math.min(W, Math.round(x1 * W));
  const py0 = Math.max(0, Math.round(y0 * H));
  const py1 = Math.min(H, Math.round(y1 * H));
  for (let y = py0; y < py1; y++) {
    for (let x = px0; x < px1; x++) {
      const i = (y * W + x) * 3;
      frame[i] = rgb[0];
      frame[i + 1] = rgb[1];
      frame[i + 2] = rgb[2];
    }
  }
}
function circle(cx, cy, r, rgb) {
  const pcx = cx * W;
  const pcy = cy * H;
  const x0 = Math.max(0, Math.floor(pcx - r));
  const x1 = Math.min(W - 1, Math.ceil(pcx + r));
  const y0 = Math.max(0, Math.floor(pcy - r));
  const y1 = Math.min(H - 1, Math.ceil(pcy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - pcx;
      const dy = y + 0.5 - pcy;
      if (dx * dx + dy * dy <= r * r) {
        const i = (y * W + x) * 3;
        frame[i] = rgb[0];
        frame[i + 1] = rgb[1];
        frame[i + 2] = rgb[2];
      }
    }
  }
}
function ellipseRing(cx, cy, rx, ry, thicknessPx, rgb) {
  const pcx = cx * W;
  const pcy = cy * H;
  const prx = rx * W;
  const pry = ry * H;
  const x0 = Math.max(0, Math.floor(pcx - prx - thicknessPx));
  const x1 = Math.min(W - 1, Math.ceil(pcx + prx + thicknessPx));
  const y0 = Math.max(0, Math.floor(pcy - pry - thicknessPx));
  const y1 = Math.min(H - 1, Math.ceil(pcy + pry + thicknessPx));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - pcx) / prx;
      const dy = (y + 0.5 - pcy) / pry;
      const d = Math.sqrt(dx * dx + dy * dy);
      const outer = 1 + thicknessPx / Math.min(prx, pry);
      if (d <= outer && d >= 1 - thicknessPx / Math.min(prx, pry) / 2) {
        const i = (y * W + x) * 3;
        frame[i] = rgb[0];
        frame[i + 1] = rgb[1];
        frame[i + 2] = rgb[2];
      }
    }
  }
}

function drawScene(ball) {
  fill([42, 42, 46]); // asphalt
  // backboard
  rect(
    RIM.cx - 0.14,
    RIM.cy - 0.32,
    RIM.cx + 0.14,
    RIM.cy - 0.02,
    [216, 212, 204],
  );
  rect(
    RIM.cx - 0.05,
    RIM.cy - 0.12,
    RIM.cx + 0.05,
    RIM.cy - 0.03,
    [150, 40, 40],
  );
  // net: a few grey strands tapering under the rim
  const netTop = RIM.cy + RIM.ry;
  for (let k = -3; k <= 3; k++) {
    const x = RIM.cx + (k / 3) * RIM.rx * 0.9;
    const xb = RIM.cx + (k / 3) * RIM.rx * 0.6;
    for (let s = 0; s <= 40; s++) {
      const u = s / 40;
      circle(x + (xb - x) * u, netTop + NET_DEPTH * u, 1.2, [200, 200, 200]);
    }
  }
  // players (jersey blocks + a skin-tone head)
  for (const p of Object.values(PLAYER)) {
    rect(p.x0, p.y0, p.x1, p.y1, p.rgb);
    circle((p.x0 + p.x1) / 2, p.y0 - 0.06, 22, [222, 184, 135]);
  }
  // rim on top of the net, ball on top of everything
  ellipseRing(RIM.cx, RIM.cy, RIM.rx, RIM.ry, 4, [250, 250, 250]);
  if (ball) circle(ball.x, ball.y, BALL_R, BALL);
}

// ── motion script ───────────────────────────────────────────────────────────
// Each segment: {t0, t1, f(u) → {x,y}} with u = 0..1 (linear time).
const segs = [];
const push = (t0, dur, f) => {
  segs.push({ t0, t1: t0 + dur, f });
  return t0 + dur;
};
const lerp = (a, b, u) => a + (b - a) * u;
// Parabolic arc from p0 to p1 with apex `apexY` (normalized, smaller = higher).
function arc(p0, p1, apexY) {
  return (u) => {
    const x = lerp(p0.x, p1.x, u);
    // y(u) = a u^2 + b u + c through (0,y0),(1,y1) with minimum apexY
    const y0 = p0.y;
    const y1 = p1.y;
    // choose vertex position so the peak equals apexY
    const k =
      Math.sqrt(Math.max(0, y0 - apexY)) /
      (Math.sqrt(Math.max(0, y0 - apexY)) +
        Math.sqrt(Math.max(0, y1 - apexY)) || 1);
    const a = (y0 - apexY) / (k * k || 1e-6);
    return { x, y: apexY + a * (u - k) * (u - k) };
  };
}
const netBottom = RIM.cy + RIM.ry + NET_DEPTH;
const floor = 0.95;

let expectedMakes = 0;
let expectedAttempts = 0;
let t = 0;
const hold = (p, dur) => (t = push(t, dur, () => ({ ...hands(p) })));

function swish(from) {
  expectedMakes++;
  expectedAttempts++;
  const h = hands(from);
  const entry = { x: RIM.cx, y: RIM.cy - 3.5 * RXY };
  t = push(t, 0.7, arc(h, entry, RIM.cy - 4.5 * RXY));
  // fast descent into the rim (≈1.3 heights/s)
  t = push(t, (RIM.cy - entry.y) / 1.3, (u) => ({
    x: RIM.cx,
    y: lerp(entry.y, RIM.cy, u),
  }));
  // caught by the net: slow, slightly swaying
  t = push(t, 0.4, (u) => ({
    x: RIM.cx + Math.sin(u * Math.PI) * 0.004,
    y: lerp(RIM.cy, netBottom + 0.01, u),
  }));
  // drops out of the net to the floor
  t = push(t, 0.45, (u) => ({
    x: RIM.cx + 0.02 * u,
    y: lerp(netBottom + 0.01, floor, u * u),
  }));
}
function rimOut(from) {
  expectedAttempts++;
  const h = hands(from);
  const edge = { x: RIM.cx - RIM.rx * 0.95, y: RIM.cy - RIM.ry };
  t = push(t, 0.8, arc(h, edge, RIM.cy - 3.5 * RXY));
  // bounce up and away
  const away = { x: RIM.cx - 0.22, y: RIM.cy - 0.1 };
  t = push(t, 0.35, (u) => ({
    x: lerp(edge.x, away.x, u),
    y: edge.y - 0.09 * Math.sin(u * Math.PI) + (away.y - edge.y) * u,
  }));
  t = push(t, 0.5, (u) => ({
    x: away.x - 0.05 * u,
    y: lerp(away.y, floor, u * u),
  }));
}
function passBy(from) {
  expectedAttempts++;
  const h = hands(from);
  const top = { x: RIM.cx, y: RIM.cy - 3.5 * RXY };
  t = push(t, 0.7, arc(h, top, RIM.cy - 4.5 * RXY));
  // straight through the projected ellipse and the net band at free fall
  const end = { x: RIM.cx, y: floor };
  const dist = end.y - top.y;
  const g = 3.0; // heights/s² — keeps ~1.4 h/s through the net band
  const v0 = 1.1;
  const dur = (-v0 + Math.sqrt(v0 * v0 + 2 * g * dist)) / g;
  t = push(t, dur, (u) => {
    const tt = u * dur;
    return { x: RIM.cx, y: top.y + v0 * tt + 0.5 * g * tt * tt };
  });
}
function travelTo(to, dur) {
  const last = segs[segs.length - 1];
  const p0 = last.f(1);
  const p1 = hands(to);
  t = push(t, dur, (u) => ({ x: lerp(p0.x, p1.x, u), y: lerp(p0.y, p1.y, u) }));
}

hold(PLAYER.A, 1.0);
swish(PLAYER.A);
travelTo(PLAYER.B, 1.2);
hold(PLAYER.B, 0.8);
swish(PLAYER.B);
travelTo(PLAYER.A, 1.2);
hold(PLAYER.A, 0.8);
rimOut(PLAYER.A);
travelTo(PLAYER.B, 1.2);
hold(PLAYER.B, 0.8);
passBy(PLAYER.B);
travelTo(PLAYER.A, 1.2);
hold(PLAYER.A, 0.8);
swish(PLAYER.A);
hold(PLAYER.A, 0.0);
t = push(t, 1.5, () => null); // ball out of frame at the end
const total = t;

function ballAt(time) {
  for (const s of segs) {
    if (time >= s.t0 && time < s.t1) {
      const u = (time - s.t0) / (s.t1 - s.t0 || 1);
      return s.f(u);
    }
  }
  return null;
}

// ── encode ──────────────────────────────────────────────────────────────────
const ff = spawn(
  'ffmpeg',
  [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    '-s',
    `${W}x${H}`,
    '-r',
    String(FPS),
    '-i',
    '-',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    out,
  ],
  { stdio: ['pipe', 'inherit', 'inherit'] },
);
const frames = Math.ceil(total * FPS);
for (let i = 0; i < frames; i++) {
  drawScene(ballAt(i / FPS));
  if (
    !ff.stdin.write(
      Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength),
    )
  ) {
    await new Promise((r) => ff.stdin.once('drain', r));
  }
}
ff.stdin.end();
await new Promise((resolve, reject) => {
  ff.on('close', (code) =>
    code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)),
  );
});
console.log(
  JSON.stringify(
    {
      file: out,
      seconds: Math.round(total * 10) / 10,
      fps: FPS,
      rim: RIM,
      teams: TEAM,
      expectedMakes,
      expectedAttempts,
      detector: 'hsv',
    },
    null,
    2,
  ),
);
