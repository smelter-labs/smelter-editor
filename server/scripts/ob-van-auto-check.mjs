#!/usr/bin/env node
// OB Van auto-pilot check with the REAL signal worker (run the server
// without SKIP_PYTHON): two file cams, TALK preset, auto pilot on. Records
// ~60 s of program, logs the per-camera signal summaries once a second and
// every director decision (source, label, reasons), then asserts that the
// worker reported for both cameras and that the auto pilot cut at least once.
//
//   OB_API=http://localhost:3111 caffeinate -i node scripts/ob-van-auto-check.mjs
//
// The last stdout line is JSON: {"file", "cuts": [{t, label, reasons}]}.

import {
  API,
  DEMO_CAMS,
  api,
  check,
  createRoom,
  deleteRoom,
  failureCount,
  ob,
  openSocket,
  sleep,
  waitFor,
} from './lib/ob-api.mjs';

const RUN_S = Number(process.env.OB_AUTO_RUN_S ?? 60);
const log = (...a) =>
  console.log(`[${new Date().toISOString().slice(11, 23)}]`, ...a);

async function main() {
  log('API', API);
  const { roomId } = await createRoom({ width: 1280, height: 720 });
  log('room', roomId);
  let sock;
  try {
    let signals = {};
    let t0 = 0;
    const cuts = [];
    sock = await openSocket(roomId, (ev) => {
      if (ev.type === 'ob_signals') signals = ev.signals;
      if (ev.type === 'ob_log') {
        for (const e of ev.entries) {
          const t = t0 ? ((e.atMs - t0) / 1000).toFixed(1) : '-';
          log(
            `log [${e.source}] ${e.label} ${e.text}`,
            e.reasons?.join(' | ') ?? '',
          );
          // Program changes by the auto pilot: source 'auto', label AUTO, with reasons.
          if (
            e.source === 'auto' &&
            e.label === 'AUTO' &&
            (e.reasons?.length ?? 0) > 0
          )
            cuts.push({
              t: Number(t),
              label: `${e.label} ${e.text}`,
              reasons: e.reasons ?? [],
            });
        }
      }
    });
    sock.send({ type: 'ob_spectate' });

    await ob.config(roomId, {
      eventName: 'Auto check',
      presetId: 'talk',
      autoPilot: false,
      resumeAfterMs: 0,
    });
    const cams = [];
    for (const c of DEMO_CAMS) cams.push((await ob.mp4Cam(roomId, c)).camId);
    await ob.sync(roomId, 60_000);
    await ob.control(roomId, 'go_live');
    await ob.operate(roomId, {
      op: 'shot',
      shot: { kind: 'solo', cam: cams[1] },
      mode: 'cut',
    });
    log('waiting for the worker to report on both cameras…');
    await waitFor(() => cams.every((id) => signals[id] && !signals[id].stale), {
      timeoutMs: 90_000,
      label: 'signals from both cams',
    });
    log('signals live', JSON.stringify(signals));
    await ob.config(roomId, { autoPilot: true });
    await api('POST', `/room/${roomId}/record/start`, {});
    t0 = Date.now();
    for (let s = 0; s < RUN_S; s++) {
      await sleep(1000);
      const line = cams
        .map((id, i) => {
          const g = signals[id];
          if (!g) return `CAM${i + 1} –`;
          return `CAM${i + 1} ${g.speech ? 'SPEECH' : 'quiet '} p=${g.speechProb.toFixed(2)} rms=${g.rmsDb.toFixed(0)} mot=${g.motion.toFixed(2)} ppl=${g.people}${g.stale ? ' STALE' : ''}`;
        })
        .join('  ');
      if (s % 5 === 0) log(line);
    }
    const stop = await api('POST', `/room/${roomId}/record/stop`, {});
    const state = await ob.state(roomId);
    check(
      cams.every((id) => state.cams.find((c) => c.id === id)?.signals),
      'worker reported for both cameras',
    );
    check(cuts.length > 0, `auto pilot cut (${cuts.length} cuts)`);
    check(
      cuts.every((c) => c.reasons.length > 0),
      'every auto cut carries reasons',
    );
    const file = stop?.fileName ?? stop?.file ?? stop?.path ?? null;
    console.log(JSON.stringify({ roomId, file, stop, cuts }));
  } finally {
    sock?.close();
    await deleteRoom(roomId);
  }
  process.exit(failureCount() ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
