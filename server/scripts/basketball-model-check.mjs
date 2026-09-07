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

const API = process.env.BB_API ?? 'http://localhost:3001';
const args = process.argv.slice(2);
const fileName = args.find((a) => !a.startsWith('--')) ?? 'bb-synth.mp4';
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : def;
};
const detector = opt('detector', 'hsv');
const [cx, cy, rx, ry] = opt('rim', '0.5,0.35,0.06,0.02').split(',').map(Number);
const [colorA, colorB] = opt('teams', '#2ee06a,#1f7bff').split(',');
const seconds = Number(opt('seconds', '25'));
const expectMakes = opt('expect-makes', null);
const imgsz = Number(opt('imgsz', '640'));
const ballConf = Number(opt('ball-conf', '0.2'));
const weights = opt('weights', 'auto');

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const created = await api('POST', '/room', {
  initInputs: [],
  skipDefaultInputs: true,
  resolution: { width: 1280, height: 720 },
});
const roomId = created.roomId;
console.log(`room ${roomId}`);
const shots = [];
const balls = { tracked: 0, samples: 0, sources: {} };
const ws = new WebSocket(`${API.replace(/^http/, 'ws')}/room/${roomId}/ws`);
ws.addEventListener('message', (m) => {
  let ev;
  try {
    ev = JSON.parse(String(m.data));
  } catch {
    return;
  }
  if (ev.type === 'bb_shot') {
    shots.push(ev);
    const s = ev.shot;
    console.log(
      `  ${ev.kind.padEnd(7)} #${s.index} t=${s.sourceT ?? '?'} team=${s.team ?? '-'} ai=${s.aiTeam ?? '-'}@${s.aiConfidence} ${s.colorSample ?? ''} ${s.status} frames=${s.frameUrl ? 'yes' : 'no'}`,
    );
  }
});
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});
ws.send(JSON.stringify({ type: 'bb_spectate' }));

try {
  await api('POST', `/room/${roomId}/basketball-game/config`, {
    teams: { A: { name: 'GREEN', color: colorA }, B: { name: 'BLUE', color: colorB } },
    rim: { cx, cy, rx, ry },
    detector: { ballDetector: detector, imgsz, ballConf, yoloWeights: weights, analysisFps: 20 },
    shotFrames: true,
    autoAssignMinConf: 0.6,
    durationMs: 600_000,
  });
  const cam = await api('POST', `/room/${roomId}/basketball-game/mp4-cam`, {
    role: 'hoop',
    fileName,
  });
  console.log(`hoop cam input ${cam.inputId} (${fileName}, detector=${detector})`);
  await api('POST', `/room/${roomId}/basketball-game/match`, { action: 'start' });

  const t0 = Date.now();
  let lastLog = 0;
  while (Date.now() - t0 < seconds * 1000) {
    await sleep(1000);
    const st = await api('GET', `/room/${roomId}/basketball-game/state`);
    const hoop = st.state.cams.hoop;
    if (hoop.ballTracked) balls.tracked++;
    balls.samples++;
    if (Date.now() - lastLog > 5000) {
      lastLog = Date.now();
      console.log(
        `  ${Math.round((Date.now() - t0) / 1000)}s cam=${hoop.camConnected ? 'live' : 'dark'} ball=${hoop.ballTracked ? 'tracked' : '-'} A=${st.state.teams.A.score} B=${st.state.teams.B.score} pending=${st.state.pending.length} attempts=${st.state.teams.A.attempts + st.state.teams.B.attempts + st.state.unattributedMisses}`,
      );
    }
  }
  const st = await api('GET', `/room/${roomId}/basketball-game/state`);
  const makes = st.state.recent.filter((s) => s.status !== 'voided').length;
  const attempts = st.state.teams.A.attempts + st.state.teams.B.attempts + st.state.unattributedMisses;
  console.log('\nRESULT', {
    makes,
    scores: { A: st.state.teams.A.score, B: st.state.teams.B.score },
    pending: st.state.pending.length,
    attempts,
    ballTrackedPolls: `${balls.tracked}/${balls.samples}`,
    shots: st.state.recent.map((s) => ({ i: s.index, team: s.team, ai: s.aiTeam, conf: s.aiConfidence, status: s.status, t: s.sourceT })),
  });
  if (expectMakes != null && Number(expectMakes) !== makes) {
    console.log(`EXPECTED ${expectMakes} makes, got ${makes}`);
    process.exitCode = 1;
  }
} finally {
  ws.close();
  await api('DELETE', `/room/${roomId}`).catch(() => {});
}
