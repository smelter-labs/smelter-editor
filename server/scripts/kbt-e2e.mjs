// Kettlebell Tournament end-to-end smoke: 2 fake phones over WS + host REST
// commands + KBT_SIM rep injection. Uses Node 22's built-in WebSocket.
//
// Usage:
//   1. SKIP_PYTHON=1 KBT_SIM=1 pnpm start   (macOS: also SMELTER_PATH scfix)
//   2. node scripts/kbt-e2e.mjs
// Exercises the whole tournament flow — roster, cam offers (real WHIP inputs
// with side channels), heats, scoring rules, final, podium, reset, same-name
// reconnect adoption — without the AI model or any real camera.

const API = 'http://localhost:3001';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = (m) => JSON.stringify(m);
let failures = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : `  ${extra}`}`);
  if (!cond) failures += 1;
}

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

function phone(roomId, name) {
  const ws = new WebSocket(`ws://localhost:3001/room/${roomId}/ws`);
  const p = { name, ws, clientId: null, points: 0, reps: [], poses: [], types: new Set() };
  ws.addEventListener('message', (msg) => {
    let ev;
    try { ev = JSON.parse(String(msg.data)); } catch { return; }
    p.types.add(ev.type);
    if (ev.type === 'kbt_cam_offer') { p.clientId = ev.clientId; p.offer = ev; }
    if (ev.type === 'kbt_rep' && ev.clientId === p.clientId) { p.points = ev.totalPoints; p.reps.push(ev); }
  });
  p.open = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  return p;
}

// ── 1. Room ──────────────────────────────────────────────────────────────────
const created = await api('POST', '/room', {
  initInputs: [],
  skipDefaultInputs: true,
  resolution: { width: 1920, height: 1080 },
});
const roomId = created.roomId;
check('room created', !!roomId && !!created.whepUrl);

// ── 2. Config + roster ───────────────────────────────────────────────────────
const cfgRes = await api('POST', `/room/${roomId}/kettlebell-tournament/config`, {
  scoring: { snatch: { points: 5 }, clean: { enabled: false } },
  strictTechnique: true,
  heatDurationMs: 45_000,
  heatSize: 2,
});
check('config applied (snatch=5, clean off, strict)', cfgRes.config.scoring.snatch.points === 5 && cfgRes.config.scoring.clean.enabled === false && cfgRes.config.strictTechnique === true);
await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'roster' });

// ── 3. Phones join + cameras ─────────────────────────────────────────────────
const a = phone(roomId, 'ANIA');
const b = phone(roomId, 'BARTEK');
await a.open; await b.open;
a.ws.send(j({ type: 'kbt_spectate' }));
a.ws.send(j({ type: 'kbt_join', name: 'ANIA' }));
b.ws.send(j({ type: 'kbt_join', name: 'BARTEK' }));
await sleep(300);
a.ws.send(j({ type: 'kbt_cam_request' }));
b.ws.send(j({ type: 'kbt_cam_request' }));
await sleep(2000);
check('cam offers received (real WHIP inputs registered)', !!a.clientId && !!b.clientId, `a=${a.clientId} b=${b.clientId}`);
check('offer carries whipUrl + bearer', !!a.offer?.whipUrl && !!a.offer?.bearerToken);

let snap = await api('GET', `/room/${roomId}/kettlebell-tournament/state`);
check('roster has 2 lifters', snap.state.players.length === 2, JSON.stringify(snap.state.players.map((p) => p.name)));

// ── 4. Draw heats + run the heat ─────────────────────────────────────────────
await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'assign_heats' });
snap = await api('GET', `/room/${roomId}/kettlebell-tournament/state`);
check('one heat of 2 drawn', snap.state.heats.length === 1 && snap.state.heats[0].playerIds.length === 2);

await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'start_heat' });
await sleep(400);
snap = await api('GET', `/room/${roomId}/kettlebell-tournament/state`);
check('heat staged (intro)', snap.match.phase === 'intro');

// Reps before the countdown must not score.
await api('POST', `/room/${roomId}/kettlebell-tournament/simulate-rep`, { clientId: a.clientId, exercise: 'swing' });
await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'begin_heat' });
await sleep(3400); // 3s countdown -> playing
snap = await api('GET', `/room/${roomId}/kettlebell-tournament/state`);
check('heat playing after countdown', snap.match.phase === 'playing');

// ANIA: 2 swings (1pt) + 1 incorrect snatch (strict: floor(5/2)=2) = 4
await api('POST', `/room/${roomId}/kettlebell-tournament/simulate-rep`, { clientId: a.clientId, exercise: 'swing' });
await api('POST', `/room/${roomId}/kettlebell-tournament/simulate-rep`, { clientId: a.clientId, exercise: 'swing' });
await api('POST', `/room/${roomId}/kettlebell-tournament/simulate-rep`, { clientId: a.clientId, exercise: 'snatch', verdict: 'incorrect' });
// BARTEK: 1 clean (disabled = 0) + 1 snatch (5) = 5 → leads
await api('POST', `/room/${roomId}/kettlebell-tournament/simulate-rep`, { clientId: b.clientId, exercise: 'clean' });
await api('POST', `/room/${roomId}/kettlebell-tournament/simulate-rep`, { clientId: b.clientId, exercise: 'snatch' });
await sleep(400);

check('ANIA live points = 4 (1+1+2)', a.points === 4, `got ${a.points}`);
check('BARTEK live points = 5 (0+5)', b.points === 5, `got ${b.points}`);
check('phones saw kbt_lead_change', a.types.has('kbt_lead_change'));
check('pre-countdown rep did not score', a.reps.length === 3, `got ${a.reps.length}`);

await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'stop_heat' });
await sleep(700); // rep grace closes, heat finalizes
snap = await api('GET', `/room/${roomId}/kettlebell-tournament/state`);
check('heat ended + BARTEK crowned', snap.match.phase === 'ended' && snap.match.winner?.name === 'BARTEK', JSON.stringify(snap.match.winner));
const ania = snap.state.players.find((p) => p.name === 'ANIA');
const bartek = snap.state.players.find((p) => p.name === 'BARTEK');
check('bestScores rolled up (4/5)', ania?.bestScore === 4 && bartek?.bestScore === 5, `ania=${ania?.bestScore} bartek=${bartek?.bestScore}`);
const sheet = Object.values(snap.match.scores).find((s) => s.name === 'BARTEK');
check('disabled clean counted as rep, 0 pts', sheet?.reps.clean === 1 && sheet?.points === 5);

// ── 5. Final + podium + reset ────────────────────────────────────────────────
await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'start_final' });
await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'start_heat' });
await sleep(300);
await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'begin_heat' });
await sleep(3400);
await api('POST', `/room/${roomId}/kettlebell-tournament/simulate-rep`, { clientId: a.clientId, exercise: 'snatch' });
await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'stop_heat' });
await sleep(700);
snap = await api('GET', `/room/${roomId}/kettlebell-tournament/state`);
check('final ran, ANIA finalScore=5', snap.state.players.find((p) => p.name === 'ANIA')?.finalScore === 5, JSON.stringify(snap.state.players.map((p) => [p.name, p.finalScore])));
check('final heat flagged', snap.state.heats.some((h) => h.final && h.phase === 'ended'));

await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'podium' });
snap = await api('GET', `/room/${roomId}/kettlebell-tournament/state`);
check('podium phase', snap.state.tournamentPhase === 'podium');

await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'reset' });
snap = await api('GET', `/room/${roomId}/kettlebell-tournament/state`);
check('reset keeps roster, wipes scores', snap.state.players.length === 2 && snap.state.players.every((p) => p.bestScore === 0 && p.finalScore == null) && snap.state.heats.length === 0);

// Disconnect adoption: drop ANIA's socket, rejoin by name on a new one.
a.ws.close();
await sleep(300);
const a2 = phone(roomId, 'ANIA');
await a2.open;
a2.ws.send(j({ type: 'kbt_join', name: 'ANIA' }));
await sleep(300);
snap = await api('GET', `/room/${roomId}/kettlebell-tournament/state`);
check('same-name rejoin adopts (still 2 lifters)', snap.state.players.length === 2, `got ${snap.state.players.length}`);

// ── 6. Solo challenge (one lifter, one heat of one) ─────────────────────────
b.ws.send(j({ type: 'kbt_leave' }));
await sleep(300);
snap = await api('GET', `/room/${roomId}/kettlebell-tournament/state`);
check('solo roster after BARTEK leaves', snap.state.players.length === 1);
// The adopted ANIA kept her cam input from before the reconnect.
const soloId = snap.state.players[0].clientId;
await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'assign_heats' });
snap = await api('GET', `/room/${roomId}/kettlebell-tournament/state`);
check('solo draw: one heat of one', snap.state.heats.length === 1 && snap.state.heats[0].playerIds.length === 1);
await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'start_heat' });
await sleep(300);
await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'begin_heat' });
await sleep(3400);
await api('POST', `/room/${roomId}/kettlebell-tournament/simulate-rep`, { clientId: soloId, exercise: 'swing' });
await api('POST', `/room/${roomId}/kettlebell-tournament/simulate-rep`, { clientId: soloId, exercise: 'snatch' });
await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'stop_heat' });
await sleep(700);
snap = await api('GET', `/room/${roomId}/kettlebell-tournament/state`);
// Config survives reset: swing 1 + snatch 5 (set back in step 2) = 6.
check('solo winner crowned', snap.match.winner?.name === 'ANIA' && snap.match.winner?.points === 6, JSON.stringify(snap.match.winner));
// start_final must be a no-op with a single scored player.
await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'start_final' });
snap = await api('GET', `/room/${roomId}/kettlebell-tournament/state`);
check('solo start_final is a no-op', snap.state.heats.length === 1 && snap.state.tournamentPhase !== 'final');

// ── Cleanup ──────────────────────────────────────────────────────────────────
b.ws.close(); a2.ws.close();
await api('DELETE', `/room/${roomId}`);
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
