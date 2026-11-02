#!/usr/bin/env node
// Finger-frame live check: records the program while fingertip quads are
// pushed onto the solo cam through the production browser-detector endpoint
// (POST /ob-van/hand-frame — no worker or MediaPipe needed), then samples
// recorded frames with ffmpeg and asserts: a crossed
// cycle draws as an hourglass (top lobe effected, between the lobes not), a
// simple quad is grayscale inside (R≈G≈B) and colorful outside, the pinch
// switch sign turns it sepia (R>G>B), and release restores the color.
//
//   OB_API=http://localhost:3121 node scripts/ob-van-frame-check.mjs
//
// Timeline (side-channel hold ≈3 s on the mp4 cams delays each apply):
//   1 s   inject crossed quad → hourglass on screen ≈4 s (grayscale)
//   4.5 s inject simple quad  → rectangle ≈7.5 s (grayscale)
//   7 s   inject switch sign  → restyles to SEPIA ≈10 s
//   10.5s inject null         → released ≈13.5 s
//   14 s  toggle OFF (state assertion; quads already clear)

import { execFileSync } from 'node:child_process';
import {
  API,
  DEMO_CAMS,
  api,
  check,
  createRoom,
  deleteRoom,
  failureCount,
  ob,
  sleep,
} from './lib/ob-api.mjs';

const W = 1280;
const H = 720;
const RECT = { x: 0.55, y: 0.52, w: 0.34, h: 0.36 };
const TL = [RECT.x, RECT.y];
const TR = [RECT.x + RECT.w, RECT.y];
const BR = [RECT.x + RECT.w, RECT.y + RECT.h];
const BL = [RECT.x, RECT.y + RECT.h];
// Cycle order TL→TR→BR→BL is a simple quad; swapping the last two crosses
// the edges — the hourglass (even-odd fill: two lobes, top + bottom).
const QUAD = [TL, TR, BR, BL];
const HOURGLASS = [TL, TR, BL, BR];

const log = (...a) =>
  console.log(`[${new Date().toISOString().slice(11, 23)}]`, ...a);

/** Mean [R, G, B] over a patch of the frame at `t` seconds (rgb24). */
function patchMean(file, t, px, py, pw, ph) {
  const buf = execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-ss',
      String(t),
      '-i',
      file,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  if (buf.length < W * H * 3) throw new Error(`short frame at ${t}s`);
  const sum = [0, 0, 0];
  let n = 0;
  for (let y = py; y < py + ph; y++) {
    for (let x = px; x < px + pw; x++) {
      const i = (y * W + x) * 3;
      sum[0] += buf[i];
      sum[1] += buf[i + 1];
      sum[2] += buf[i + 2];
      n++;
    }
  }
  return sum.map((s) => s / n);
}

/** Mean |R−G| + |G−B| over a patch of the frame at `t` seconds (rgb24). */
function patchSpread(file, t, px, py, pw, ph) {
  const buf = execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-ss',
      String(t),
      '-i',
      file,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  if (buf.length < W * H * 3) throw new Error(`short frame at ${t}s`);
  let sum = 0;
  let n = 0;
  for (let y = py; y < py + ph; y++) {
    for (let x = px; x < px + pw; x++) {
      const i = (y * W + x) * 3;
      sum += Math.abs(buf[i] - buf[i + 1]) + Math.abs(buf[i + 1] - buf[i + 2]);
      n++;
    }
  }
  return sum / n;
}

async function main() {
  log('API', API);
  const { roomId } = await createRoom({ width: W, height: H });
  log('room', roomId);
  try {
    await ob.config(roomId, {
      eventName: 'Frame Check',
      transition: { type: 'cut', durationMs: 0 },
    });
    const cams = [];
    for (const c of DEMO_CAMS) cams.push(await ob.mp4Cam(roomId, c));
    const [c1] = cams;
    await ob.sync(roomId, 60_000);
    await ob.control(roomId, 'go_live');
    await ob.operate(roomId, {
      op: 'shot',
      shot: { kind: 'solo', cam: c1.camId },
      mode: 'cut',
    });
    await sleep(5000); // let the pictures start

    check((await ob.state(roomId)).fingerFrame === false, 'state starts OFF');
    await ob.operate(roomId, { op: 'finger_frame', enabled: true });
    check((await ob.state(roomId)).fingerFrame === true, 'operate turns it ON');
    check(
      (await ob.state(roomId)).config.fingerFrame === true,
      'config carries the flag',
    );

    await api('POST', `/room/${roomId}/record/start`, {});
    const t0 = Date.now();
    const at = async (sec) => {
      const wait = t0 + sec * 1000 - Date.now();
      if (wait > 0) await sleep(wait);
    };
    const inject = (quad) =>
      api('POST', `/room/${roomId}/ob-van/hand-frame`, {
        inputId: c1.inputId,
        quad,
        frameW: W,
        frameH: H,
      });

    await at(1);
    await inject(HOURGLASS);
    log('crossed quad injected');
    await at(4.5);
    await inject(QUAD);
    log('simple quad injected');
    await at(7);
    await api('POST', `/room/${roomId}/ob-van/hand-frame`, {
      inputId: c1.inputId,
      quad: null,
      switch: true,
    });
    log('switch sign injected');
    await at(10.5);
    await inject(null);
    log('quad released');
    await at(14);
    await ob.operate(roomId, { op: 'finger_frame', enabled: false });
    check(
      (await ob.state(roomId)).fingerFrame === false,
      'operate turns it OFF',
    );
    await at(14.6);
    const stopped = await api('POST', `/room/${roomId}/record/stop`, {});
    const file = `data/recordings/${stopped.fileName}`;
    log('recording', file);

    // Hourglass phase (crossed cycle, grayscale): the top lobe is effected,
    // the area beside the crossing point (left-middle) is not.
    const topOn = patchSpread(
      file,
      5.5,
      Math.round((RECT.x + RECT.w / 2) * W) - 20,
      Math.round(RECT.y * H) + 26,
      40,
      30,
    );
    const leftOn = patchSpread(
      file,
      5.5,
      Math.round(RECT.x * W) + 20,
      Math.round((RECT.y + RECT.h / 2) * H) - 15,
      30,
      30,
    );
    log(`hourglass spread top=${topOn.toFixed(1)} left=${leftOn.toFixed(1)}`);
    check(
      topOn <= 10,
      'hourglass: the top lobe is grayed',
      `spread ${topOn.toFixed(1)}`,
    );
    check(
      leftOn > topOn + 2.5,
      'hourglass: beside the crossing stays colorful',
      `left ${leftOn.toFixed(1)} vs top ${topOn.toFixed(1)}`,
    );

    // Inside patch: the middle of the quad; outside patch: top-left corner.
    const ix = Math.round((RECT.x + RECT.w / 2) * W) - 20;
    const iy = Math.round((RECT.y + RECT.h / 2) * H) - 20;
    const inOn = patchSpread(file, 8.7, ix, iy, 40, 40);
    const outOn = patchSpread(file, 8.7, 120, 120, 40, 40);
    const inAfter = patchSpread(file, 14.2, ix, iy, 40, 40);
    log(
      `spread inside=${inOn.toFixed(1)} outside=${outOn.toFixed(1)} after=${inAfter.toFixed(1)}`,
    );
    check(
      inOn <= 10,
      'inside the frame is grayscale',
      `spread ${inOn.toFixed(1)}`,
    );
    check(
      outOn > inOn + 5,
      'outside the frame keeps its color',
      `outside ${outOn.toFixed(1)} vs inside ${inOn.toFixed(1)}`,
    );
    // The switch sign cycled the look to SEPIA (mode 1): warm, strictly
    // ordered channels where grayscale had R≈G≈B. Judged over the whole rect
    // interior (minus the drawn border) — the center alone is nearly black.
    const bx = Math.round(RECT.x * W) + 14;
    const by = Math.round(RECT.y * H) + 14;
    const bw = Math.round(RECT.w * W) - 28;
    const bh = Math.round(RECT.h * H) - 28;
    const [sr, sg, sb] = patchMean(file, 12, bx, by, bw, bh);
    log(`sepia rgb=(${sr.toFixed(1)}, ${sg.toFixed(1)}, ${sb.toFixed(1)})`);
    check(
      sr > sg && sg > sb && sr - sb > 4,
      'the switch sign turns the frame sepia',
      `rgb (${sr.toFixed(1)}, ${sg.toFixed(1)}, ${sb.toFixed(1)})`,
    );
    // The demo clips are muted, so "colorful again" is judged against the
    // same frame's outside baseline rather than an absolute spread.
    check(
      inAfter > inOn + 3 && inAfter > outOn * 0.5,
      'release restores the color',
      `after ${inAfter.toFixed(1)} vs during ${inOn.toFixed(1)} (outside ${outOn.toFixed(1)})`,
    );
    console.log(
      JSON.stringify({
        file,
        topOn,
        leftOn,
        inOn,
        outOn,
        sepia: [sr, sg, sb],
        inAfter,
      }),
    );
  } finally {
    await deleteRoom(roomId);
  }
  if (failureCount() > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
