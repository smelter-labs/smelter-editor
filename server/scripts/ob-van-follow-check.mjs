#!/usr/bin/env node
// FOLLOW preset end-to-end, without a worker or an API key: the default grid
// goes up, a fake host confirmation (OB_SIM simulate-host) cuts to the host
// camera and holds it, clearing the host restores the grid, and a simulated
// motion spike solos the action camera. Needs the server started with
// OB_SIM=1 and the two demo clips in data/mp4s/ob-demo/ (speaker.mp4,
// wide.mp4 — see scripts/lib/ob-api.mjs DEMO_CAMS).
//
//   OB_SIM=1 pnpm start            # in one terminal
//   OB_API=http://localhost:3001 node scripts/ob-van-follow-check.mjs
//
// Exits non-zero when a check fails.

import {
  API,
  DEMO_CAMS,
  check,
  createRoom,
  deleteRoom,
  failureCount,
  ob,
  sleep,
  waitFor,
} from './lib/ob-api.mjs';

const log = (...a) =>
  console.log(`[${new Date().toISOString().slice(11, 23)}]`, ...a);

const shotOf = (state) => state.program.shot;
const kindOf = (state) => shotOf(state)?.kind ?? 'none';

async function waitForShot(roomId, label, pred, timeoutMs = 20_000) {
  return waitFor(
    async () => {
      const state = await ob.state(roomId);
      return pred(shotOf(state)) ? state : null;
    },
    { timeoutMs, label },
  );
}

async function main() {
  log('API', API);
  const { roomId } = await createRoom({ width: 1280, height: 720 });
  log('room', roomId);
  try {
    await ob.config(roomId, {
      eventName: 'Follow the Host',
      presetId: 'follow',
      audio: { mode: 'mix' },
      autoPilot: true,
      // host.enabled stays false: simulate-host drives the signal directly,
      // the real lifecycle (worker snapshot + LLM) is out of scope here.
    });
    const cams = [];
    for (const c of DEMO_CAMS) cams.push((await ob.mp4Cam(roomId, c)).camId);
    const [c1, c2] = cams;
    await ob.sync(roomId, 0);
    await sleep(1000);
    await ob.control(roomId, 'go_live');
    log('on air, waiting for the default grid…');

    const grid = await waitForShot(
      roomId,
      'default grid',
      (s) => s?.kind === 'grid',
    );
    check(true, `grid on air (${JSON.stringify(shotOf(grid))})`);

    log('host appears on CAM 1…');
    await ob.simulateHost(roomId, c1);
    const hostOn = await waitForShot(
      roomId,
      'host solo',
      (s) => s?.kind === 'solo' && s.cam === c1,
      15_000,
    );
    check(true, 'host-follow solo on the host camera');
    check(
      hostOn.cams.find((c) => c.id === c1) !== undefined,
      'host camera still listed',
    );

    // The host stays: the program must not move for a few seconds.
    await sleep(4000);
    const held = await ob.state(roomId);
    check(
      kindOf(held) === 'solo' && shotOf(held).cam === c1,
      'program held on the host while the signal stays',
      kindOf(held),
    );

    log('host leaves…');
    await ob.simulateHost(roomId, null);
    await waitForShot(roomId, 'grid back', (s) => s?.kind === 'grid');
    check(true, 'grid returns when the host is gone');

    log('action on CAM 2 (simulated motion spike)…');
    const quiet = {
      kind: 'video',
      frameW: 1280,
      frameH: 720,
      persons: [{ x: 0.4, y: 0.2, w: 0.2, h: 0.6 }],
      ball: null,
      motion: 0.02,
    };
    for (let i = 0; i < 10; i++) {
      await ob.simulate(roomId, c2, quiet);
      await sleep(180);
    }
    for (let i = 0; i < 12; i++) {
      await ob.simulate(roomId, c2, { ...quiet, motion: 0.7 });
      await sleep(180);
    }
    const spiked = await waitForShot(
      roomId,
      'spike solo',
      (s) => s?.kind === 'solo' && s.cam === c2,
      15_000,
    ).catch(() => null);
    check(
      spiked !== null,
      'motion spike solos the action camera',
      spiked ? '' : `still ${kindOf(await ob.state(roomId))}`,
    );

    const state = await ob.state(roomId);
    check(state.host.status === 'off', 'host lifecycle reports off (sim mode)');
    log('WHY log tail:');
    for (const e of state.log.slice(-6)) log(` · ${e.label} ${e.text}`);
  } finally {
    await deleteRoom(roomId);
  }
  const failures = failureCount();
  log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECKS FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
