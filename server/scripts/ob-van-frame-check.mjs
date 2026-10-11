#!/usr/bin/env node
// Finger-frame live check: records the program while the dev injector
// (OB_SIM=1, no worker needed) pushes a `hand_frame` rect onto the solo cam,
// then samples recorded frames with ffmpeg and asserts the picture is
// grayscale inside the rect (R≈G≈B), turns sepia after the pinch
// shader-switch sign (R>G>B), and is colorful outside / after release.
//
//   OB_API=http://localhost:3121 node scripts/ob-van-frame-check.mjs
//
// Timeline (side-channel hold ≈3 s on the mp4 cams delays each apply):
//   1 s   inject rect        → on screen ≈4 s (mode 0, grayscale)
//   3.5 s inject switch sign → restyles to SEPIA ≈6.5 s
//   7.5 s inject null        → released ≈10.5 s
//   11.5s toggle OFF (state assertion; rects already clear)

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
    const inject = (rect) =>
      api('POST', `/room/${roomId}/ob-van/simulate-hand-frame`, {
        inputId: c1.inputId,
        rect,
        frameW: W,
        frameH: H,
      });

    await at(1);
    await inject(RECT);
    log('rect injected');
    await at(3.5);
    await api('POST', `/room/${roomId}/ob-van/simulate-hand-frame`, {
      inputId: c1.inputId,
      rect: null,
      switch: true,
    });
    log('switch sign injected');
    await at(7.5);
    await inject(null);
    log('rect released');
    await at(11.5);
    await ob.operate(roomId, { op: 'finger_frame', enabled: false });
    check(
      (await ob.state(roomId)).fingerFrame === false,
      'operate turns it OFF',
    );
    await at(13);
    const stopped = await api('POST', `/room/${roomId}/record/stop`, {});
    const file = `data/recordings/${stopped.fileName}`;
    log('recording', file);

    // Inside patch: the middle of the rect; outside patch: top-left corner.
    const ix = Math.round((RECT.x + RECT.w / 2) * W) - 20;
    const iy = Math.round((RECT.y + RECT.h / 2) * H) - 20;
    const inOn = patchSpread(file, 5.5, ix, iy, 40, 40);
    const outOn = patchSpread(file, 5.5, 120, 120, 40, 40);
    const inAfter = patchSpread(file, 12, ix, iy, 40, 40);
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
    const [sr, sg, sb] = patchMean(file, 8.5, bx, by, bw, bh);
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
      JSON.stringify({ file, inOn, outOn, sepia: [sr, sg, sb], inAfter }),
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
