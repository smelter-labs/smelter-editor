#!/usr/bin/env node
// Run the basketball-scorer model on a clip through the REAL pipeline
// (room → local-mp4 hoop cam with a video side channel → worker → bb_shot
// events) and print what it saw. Needs the API on :3001 started with
// BB_SIM=1 and the Python sidecars enabled (no SKIP_PYTHON).
//
//   node scripts/basketball-model-check.mjs bb-synth.mp4 --detector hsv \
//        --rim 0.5,0.35,0.06,0.02 --teams '#2ee06a,#1f7bff' --seconds 25
//   node scripts/basketball-model-check.mjs bb-real.mp4 --detector auto --rim 0.42,0.44,0.11,0.05
//
// Exit code 0 when `--expect-makes N` (if given) matches exactly.
// For ground-truth scoring (precision/recall vs an events.json) see
// scripts/basketball-bench.mjs.

import {
  api,
  createRoom,
  deleteRoom,
  fmtShot,
  getState,
  openSpectator,
  parseArgs,
  sleep,
} from './lib/bb-api.mjs';

const { positional, opt } = parseArgs(process.argv);
const fileName = positional[0] ?? 'bb-synth.mp4';
const detector = opt('detector', 'hsv');
const [cx, cy, rx, ry] = opt('rim', '0.5,0.35,0.06,0.02')
  .split(',')
  .map(Number);
const [colorA, colorB] = opt('teams', '#2ee06a,#1f7bff').split(',');
const seconds = Number(opt('seconds', '25'));
const expectMakes = opt('expect-makes', null);
const imgsz = Number(opt('imgsz', '640'));
const ballConf = Number(opt('ball-conf', '0.2'));
const weights = opt('weights', 'auto');

const roomId = await createRoom();
console.log(`room ${roomId}`);
const balls = { tracked: 0, samples: 0 };
const ws = await openSpectator(roomId, (ev) => {
  if (ev.type === 'bb_shot') console.log(fmtShot(ev.kind, ev.shot));
});

try {
  await api('POST', `/room/${roomId}/basketball-game/config`, {
    teams: {
      A: { name: 'GREEN', color: colorA },
      B: { name: 'BLUE', color: colorB },
    },
    rim: { cx, cy, rx, ry },
    detector: {
      ballDetector: detector,
      imgsz,
      ballConf,
      yoloWeights: weights,
      analysisFps: 20,
    },
    shotFrames: true,
    autoAssignMinConf: 0.6,
    durationMs: 600_000,
  });
  const cam = await api('POST', `/room/${roomId}/basketball-game/mp4-cam`, {
    role: 'hoop',
    fileName,
  });
  console.log(
    `hoop cam input ${cam.inputId} (${fileName}, detector=${detector})`,
  );
  await api('POST', `/room/${roomId}/basketball-game/match`, {
    action: 'start',
  });

  const t0 = Date.now();
  let lastLog = 0;
  while (Date.now() - t0 < seconds * 1000) {
    await sleep(1000);
    const st = await getState(roomId);
    const hoop = st.cams.hoop;
    if (hoop.ballTracked) balls.tracked++;
    balls.samples++;
    if (Date.now() - lastLog > 5000) {
      lastLog = Date.now();
      console.log(
        `  ${Math.round((Date.now() - t0) / 1000)}s cam=${hoop.camConnected ? 'live' : 'dark'} ball=${hoop.ballTracked ? 'tracked' : '-'} A=${st.teams.A.score} B=${st.teams.B.score} pending=${st.pending.length} attempts=${st.teams.A.attempts + st.teams.B.attempts + st.unattributedMisses}`,
      );
    }
  }
  const st = await getState(roomId);
  const makes = st.recent.filter((s) => s.status !== 'voided').length;
  const attempts =
    st.teams.A.attempts + st.teams.B.attempts + st.unattributedMisses;
  console.log('\nRESULT', {
    makes,
    scores: { A: st.teams.A.score, B: st.teams.B.score },
    pending: st.pending.length,
    attempts,
    ballTrackedPolls: `${balls.tracked}/${balls.samples}`,
    shots: st.recent.map((s) => ({
      i: s.index,
      team: s.team,
      ai: s.aiTeam,
      conf: s.aiConfidence,
      status: s.status,
      t: s.sourceT,
      mediaMs: s.mediaMs,
    })),
  });
  if (expectMakes != null && Number(expectMakes) !== makes) {
    console.log(`EXPECTED ${expectMakes} makes, got ${makes}`);
    process.exitCode = 1;
  }
} finally {
  ws.close();
  await deleteRoom(roomId);
}
