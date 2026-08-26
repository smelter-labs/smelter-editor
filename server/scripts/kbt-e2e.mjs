// Kettlebell Tournament end-to-end smoke: 2 fake phones over WS + host REST
// commands + KBT_SIM rep injection. Uses Node 22's built-in WebSocket.
//
// Usage:
//   1. SKIP_PYTHON=1 KBT_SIM=1 pnpm start   (macOS: also SMELTER_PATH scfix)
//   2. node scripts/kbt-e2e.mjs
// Exercises the whole tournament flow — roster, cam offers (real WHIP inputs
// with side channels), heats, scoring rules, final, podium, reset, same-name
// reconnect adoption — without the AI model or any real camera.
//
// MP4 mode (real decoded frames, no phone):
//   KBT_E2E_MP4=clip.mp4 node scripts/kbt-e2e.mjs
// Attaches data/mp4s/clip.mp4 as each fake phone's camera via the KBT_SIM-only
// POST /room/:id/kettlebell-tournament/mp4-cam. The mp4 input loops forever and
// gets the same video side channel as a WHIP cam, so with the python worker
// running the coach model scores real reps from the clip; without it, the
// simulate-rep injector still works on top (score checks turn into >=, since a
// live worker may add reps of its own).
//   Clip content: side-on framing (cameraView 'side'), H.264, ~720p is plenty.
//   Drop files into server/data/mp4s/ (gitignored).
// Full-AI recipe: KBT_SIM=1 pnpm start (server spawns worker.py), or add
// SKIP_PYTHON=1 and launch the worker with the exact command the server prints
// on model enable (NODE_WS_URL=ws://127.0.0.1:8091 python3
// src/ai-models/kettlebell-coach/worker.py, plus the printed
// SMELTER_SIDE_CHANNEL_SOCKET_DIR).

const API = 'http://localhost:3001';
const MP4 = process.env.KBT_E2E_MP4 || '';
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

// camConnected now measures real publish liveness (heartbeat acks), so fake
// phones ack their WHIP inputs like the real page's use-whip-heartbeat does.
// Acking outlives a closed WS on purpose — it models "the phone app is still
// publishing, only the control socket blipped" (the adoption scenarios).
const ackTimers = new Map();
function startAcking(roomId, inputId) {
  if (ackTimers.has(inputId)) return;
  const ack = () =>
    fetch(`${API}/room/${roomId}/input/${encodeURIComponent(inputId)}/whip/ack`, { method: 'POST' }).catch(() => {});
  void ack();
  ackTimers.set(inputId, setInterval(ack, 4000));
}
function stopAllAcking() {
  for (const t of ackTimers.values()) clearInterval(t);
  ackTimers.clear();
}

function phone(roomId, name) {
  const ws = new WebSocket(`ws://localhost:3001/room/${roomId}/ws`);
  const p = { name, ws, clientId: null, playerKey: null, points: 0, reps: [], poses: [], errors: [], types: new Set() };
  ws.addEventListener('message', (msg) => {
    let ev;
    try { ev = JSON.parse(String(msg.data)); } catch { return; }
    p.types.add(ev.type);
    if (ev.type === 'kbt_joined') { p.clientId = ev.clientId; p.playerKey = ev.playerKey; p.joined = ev; }
    if (ev.type === 'kbt_error') { p.errors.push(ev); }
    if (ev.type === 'kbt_cam_offer') { p.clientId = ev.clientId; p.offer = ev; startAcking(roomId, ev.inputId); }
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
  cameraView: 'side',
});
check('config applied (snatch=5, clean off, strict, side)', cfgRes.config.scoring.snatch.points === 5 && cfgRes.config.scoring.clean.enabled === false && cfgRes.config.strictTechnique === true && cfgRes.config.cameraView === 'side');
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

// MP4 mode: swap each throwaway WHIP cam (which taught us the clientId via the
// offer) for a looping local-mp4 input; attach retires the WHIP input cleanly.
if (MP4) {
  const camA = await api('POST', `/room/${roomId}/kettlebell-tournament/mp4-cam`, { clientId: a.clientId, fileName: MP4 });
  const camB = await api('POST', `/room/${roomId}/kettlebell-tournament/mp4-cam`, { clientId: b.clientId, fileName: MP4 });
  check('mp4 cams attached', camA.status === 'ok' && !!camA.inputId && camB.status === 'ok' && !!camB.inputId, JSON.stringify([camA, camB]));
}

let snap = await api('GET', `/room/${roomId}/kettlebell-tournament/state`);
check('roster has 2 lifters', snap.state.players.length === 2, JSON.stringify(snap.state.players.map((p) => p.name)));

// ── 3b. Profile photo upload ────────────────────────────────────────────────
// A real (ffmpeg-encoded) 512×512 JPEG — the engine's registerImage decodes
// it, so a degenerate "smallest possible" JPEG would fail HUD registration.
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjExLjEwMAD/2wBDAAgGBgcGBwgICAgICAkJCQoKCgkJCQkKCgoKCgoMDAwKCgoKCgoKDAwMDA0ODQ0NDA0ODg8PDxISEREVFRUZGR//xABNAAEBAAAAAAAAAAAAAAAAAAAABgEBAQEAAAAAAAAAAAAAAAAAAAYHEAEAAAAAAAAAAAAAAAAAAAAAEQEAAAAAAAAAAAAAAAAAAAAA/8AAEQgCAAIAAwEiAAIRAAMRAP/aAAwDAQACEQMRAD8AiwEm38AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/9k=',
  'base64',
);
async function uploadPhoto(name, bytes) {
  const fd = new FormData();
  fd.append('name', name);
  fd.append('photo', new Blob([bytes], { type: 'image/jpeg' }), 'photo.jpg');
  return fetch(`${API}/room/${roomId}/kettlebell-tournament/photo`, { method: 'POST', body: fd });
}
const photoRes = await uploadPhoto('ANIA', TINY_JPEG);
const photoBody = photoRes.ok ? await photoRes.json() : {};
check('photo upload accepted', photoRes.status === 200 && /^\/kbt-photos\/.+\.jpg$/.test(photoBody.photoUrl ?? ''), `status=${photoRes.status} url=${photoBody.photoUrl}`);
const photoFetch = await fetch(`${API}${photoBody.photoUrl}`);
check('photo served back as jpeg', photoFetch.status === 200 && photoFetch.headers.get('content-type') === 'image/jpeg', `status=${photoFetch.status}`);
snap = await api('GET', `/room/${roomId}/kettlebell-tournament/state`);
check('photoUrl in roster state', snap.state.players.find((p) => p.name === 'ANIA')?.photoUrl === photoBody.photoUrl);
const badPhoto = await uploadPhoto('NIKT-TAKI', TINY_JPEG);
check('photo for unknown lifter -> 404', badPhoto.status === 404, `status=${badPhoto.status}`);

// ── 3b. Commentator joins via its own QR flow ────────────────────────────────
const caster = phone(roomId, 'MAREK');
await caster.open;
caster.ws.send(j({ type: 'kbt_commentator_join', name: 'MAREK' }));
await sleep(200);
caster.ws.send(j({ type: 'kbt_commentator_cam_request' }));
await sleep(1500);
check('commentator cam offer received', !!caster.offer?.whipUrl && !!caster.offer?.bearerToken);
snap = await api('GET', `/room/${roomId}/kettlebell-tournament/state`);
check('commentator in state (not a player)', snap.state.commentator?.name === 'MAREK' && snap.state.players.length === 2, JSON.stringify(snap.state.commentator));

// ── 4. Draw heats + run the heat ─────────────────────────────────────────────
await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'assign_heats' });
snap = await api('GET', `/room/${roomId}/kettlebell-tournament/state`);
check('one heat of 2 drawn', snap.state.heats.length === 1 && snap.state.heats[0].playerIds.length === 2);

await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'start_heat' });
// Staging arms the coach; on mp4 inputs that means a disconnect+reconnect (the
// side channel appears), which can flap camConnected for a poll cycle or two.
await sleep(MP4 ? 2500 : 1200); // stage + cam poll (1 Hz) flips camConnected
snap = await api('GET', `/room/${roomId}/kettlebell-tournament/state`);
check('heat staged (intro)', snap.match.phase === 'intro');
if (MP4) check('mp4 cams report connected', snap.state.players.every((p) => p.camConnected), JSON.stringify(snap.state.players.map((p) => [p.name, p.camConnected])));

// begin_heat is gated: every lifter must reach the briefing (kbt_briefed).
await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'begin_heat' });
snap = await api('GET', `/room/${roomId}/kettlebell-tournament/state`);
check('begin_heat blocked until lifters brief', snap.match.phase === 'intro');
a.ws.send(j({ type: 'kbt_briefed' }));
b.ws.send(j({ type: 'kbt_briefed' }));
await sleep(300);

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

if (MP4) {
  // A live worker may score extra reps off the clip — assert lower bounds only.
  check('ANIA points >= injected 4', a.points >= 4, `got ${a.points}`);
  check('BARTEK points >= injected 5', b.points >= 5, `got ${b.points}`);
  check('injected reps arrived', a.reps.length >= 3, `got ${a.reps.length}`);
} else {
  check('ANIA live points = 4 (1+1+2)', a.points === 4, `got ${a.points}`);
  check('BARTEK live points = 5 (0+5)', b.points === 5, `got ${b.points}`);
  check('phones saw kbt_lead_change', a.types.has('kbt_lead_change'));
  check('pre-countdown rep did not score', a.reps.length === 3, `got ${a.reps.length}`);
}

// ── 4b. Commentator panel: view overrides + WS match control ────────────────
caster.ws.send(j({ type: 'kbt_commentator_view', override: { mode: 'caster' } }));
await sleep(300);
snap = await api('GET', `/room/${roomId}/kettlebell-tournament/state`);
check('caster view forced mid-heat', snap.state.scene === 'caster' && snap.state.viewOverride?.mode === 'caster', JSON.stringify([snap.state.scene, snap.state.viewOverride]));

// A phone must not be able to steer the broadcast.
a.ws.send(j({ type: 'kbt_commentator_view', override: { mode: 'board' } }));
await sleep(300);
snap = await api('GET', `/room/${roomId}/kettlebell-tournament/state`);
check('players cannot override the view', snap.state.viewOverride?.mode === 'caster');

caster.ws.send(j({ type: 'kbt_commentator_view', override: { mode: 'split', playerId: a.clientId } }));
await sleep(300);
snap = await api('GET', `/room/${roomId}/kettlebell-tournament/state`);
check('split view forced (caster + featured lifter)', snap.state.scene === 'split' && snap.state.viewOverride?.playerId === a.clientId);

caster.ws.send(j({ type: 'kbt_commentator_view', override: { mode: 'auto' } }));
await sleep(300);
snap = await api('GET', `/room/${roomId}/kettlebell-tournament/state`);
check('auto restores the derived scene', snap.state.scene === 'grid' && snap.state.viewOverride?.mode === 'auto');

// The panel stops the heat over the WS (same vocabulary as the host REST).
caster.ws.send(j({ type: 'kbt_commentator_match', action: 'stop_heat' }));
await sleep(700); // rep grace closes, heat finalizes
snap = await api('GET', `/room/${roomId}/kettlebell-tournament/state`);
if (MP4) {
  check('heat ended with a winner', snap.match.phase === 'ended' && !!snap.match.winner, JSON.stringify(snap.match.winner));
} else {
  check('heat ended + BARTEK crowned', snap.match.phase === 'ended' && snap.match.winner?.name === 'BARTEK', JSON.stringify(snap.match.winner));
}
const ania = snap.state.players.find((p) => p.name === 'ANIA');
const bartek = snap.state.players.find((p) => p.name === 'BARTEK');
if (MP4) {
  check('bestScores rolled up (>=4/>=5)', ania?.bestScore >= 4 && bartek?.bestScore >= 5, `ania=${ania?.bestScore} bartek=${bartek?.bestScore}`);
} else {
  check('bestScores rolled up (4/5)', ania?.bestScore === 4 && bartek?.bestScore === 5, `ania=${ania?.bestScore} bartek=${bartek?.bestScore}`);
  const sheet = Object.values(snap.match.scores).find((s) => s.name === 'BARTEK');
  check('disabled clean counted as rep, 0 pts', sheet?.reps.clean === 1 && sheet?.points === 5);
}
const aniaSheet = Object.values(snap.match.scores).find((s) => s.name === 'ANIA');
check('photoUrl snapshotted into heat scores', !!aniaSheet && /^\/kbt-photos\//.test(aniaSheet.photoUrl ?? ''), JSON.stringify(aniaSheet?.photoUrl));

// ── 5. Final + podium + reset ────────────────────────────────────────────────
await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'start_final' });
await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'start_heat' });
await sleep(300);
// Both sockets stayed open, so their `briefed` flags survive into the final.
await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'begin_heat' });
await sleep(3400);
await api('POST', `/room/${roomId}/kettlebell-tournament/simulate-rep`, { clientId: a.clientId, exercise: 'snatch' });
await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'stop_heat' });
await sleep(700);
snap = await api('GET', `/room/${roomId}/kettlebell-tournament/state`);
const aniaFinal = snap.state.players.find((p) => p.name === 'ANIA')?.finalScore;
check(MP4 ? 'final ran, ANIA finalScore>=5' : 'final ran, ANIA finalScore=5', MP4 ? aniaFinal >= 5 : aniaFinal === 5, JSON.stringify(snap.state.players.map((p) => [p.name, p.finalScore])));
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
check('photo survives rejoin adoption', snap.state.players.find((p) => p.name === 'ANIA')?.photoUrl === photoBody.photoUrl);

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
await sleep(MP4 ? 2500 : 1200); // cam poll (mp4: + model-enable reconnect)
// ANIA's disconnect cleared her briefed flag — the new socket must re-brief.
await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'begin_heat' });
snap = await api('GET', `/room/${roomId}/kettlebell-tournament/state`);
check('solo begin_heat blocked until re-brief', snap.match.phase === 'intro');
a2.ws.send(j({ type: 'kbt_briefed' }));
await sleep(300);
await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'begin_heat' });
await sleep(3400);
await api('POST', `/room/${roomId}/kettlebell-tournament/simulate-rep`, { clientId: soloId, exercise: 'swing' });
await api('POST', `/room/${roomId}/kettlebell-tournament/simulate-rep`, { clientId: soloId, exercise: 'snatch' });
await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'stop_heat' });
await sleep(700);
snap = await api('GET', `/room/${roomId}/kettlebell-tournament/state`);
// Config survives reset: swing 1 + snatch 5 (set back in step 2) = 6.
check('solo winner crowned', snap.match.winner?.name === 'ANIA' && (MP4 ? snap.match.winner?.points >= 6 : snap.match.winner?.points === 6), JSON.stringify(snap.match.winner));
// start_final must be a no-op with a single scored player.
await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'start_final' });
snap = await api('GET', `/room/${roomId}/kettlebell-tournament/state`);
check('solo start_final is a no-op', snap.state.heats.length === 1 && snap.state.tournamentPhase !== 'final');

// ── 7. Resilience: error channel, playerKey adoption, restart/kick/force ─────

// 7a. Rejected requests are no longer silent no-ops.
const ghost = phone(roomId, 'GHOST');
await ghost.open;
ghost.ws.send(j({ type: 'kbt_cam_request' }));
await sleep(300);
check('kbt_error not_joined for cam request before join', ghost.errors.some((e) => e.code === 'not_joined'), JSON.stringify(ghost.errors));
ghost.ws.close();

// 7b. Refresh fork: a new socket joins with ANIA's playerKey while her old
// socket is STILL OPEN (fast refresh beats the stale close). Must adopt, not
// duplicate — and the stale socket's late close must not clear her state.
check('kbt_joined carried a playerKey', !!a2.playerKey, JSON.stringify(a2.joined));
const a3 = phone(roomId, 'ANIA');
await a3.open;
a3.ws.send(j({ type: 'kbt_join', name: 'ANIA', playerKey: a2.playerKey }));
await sleep(300);
snap = await api('GET', `/room/${roomId}/kettlebell-tournament/state`);
check('key adoption with old socket open — still 1 ANIA', snap.state.players.filter((p) => p.name === 'ANIA').length === 1 && snap.state.players.length === 1, JSON.stringify(snap.state.players.map((p) => p.name)));
check('resume snapshot echoes the same key', a3.playerKey === a2.playerKey);
a3.ws.send(j({ type: 'kbt_briefed' }));
await sleep(200);
a2.ws.close(); // the stale socket finally closes — must hit a missing entry
await sleep(400);
snap = await api('GET', `/room/${roomId}/kettlebell-tournament/state`);
const adoptedAnia = snap.state.players.find((p) => p.name === 'ANIA');
check('late stale close leaves the adopted entry briefed + connected', adoptedAnia?.briefed === true && adoptedAnia?.connected === true, JSON.stringify(adoptedAnia));
check('photo survives key adoption', adoptedAnia?.photoUrl === photoBody.photoUrl);

// 7c. Refused match actions come back as status 'rejected' with a reason.
const rejected = await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'restart_heat' }); // last heat 'ended'
check('rejected action reports status + error', rejected.status === 'rejected' && !!rejected.error?.code, JSON.stringify(rejected.error));

// 7d. restart_heat mid-heat: wipes the sheets, back to a fresh intro.
const darek = phone(roomId, 'DAREK');
await darek.open;
darek.ws.send(j({ type: 'kbt_join', name: 'DAREK' }));
await sleep(300);
await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'reset' });
await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'assign_heats' });
await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'start_heat' });
await sleep(MP4 ? 2500 : 1200);

// DAREK has no camera: begin refuses with his name, force_begin overrides.
a3.ws.send(j({ type: 'kbt_briefed' }));
await sleep(300);
const blocked = await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'begin_heat' });
check('begin_heat rejection names the blocker', blocked.status === 'rejected' && blocked.error?.code === 'not_ready' && String(blocked.error?.message).includes('DAREK'), JSON.stringify(blocked.error));
const forced = await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'force_begin' });
check('force_begin starts despite the camless lifter', forced.status === 'ok' && forced.match.phase === 'countdown', JSON.stringify([forced.status, forced.match.phase]));
await sleep(3400);
await api('POST', `/room/${roomId}/kettlebell-tournament/simulate-rep`, { clientId: adoptedAnia.clientId, exercise: 'swing' });
await sleep(300);
const restarted = await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'restart_heat' });
check('restart_heat returns to intro with wiped sheets', restarted.status === 'ok' && restarted.match.phase === 'intro' && Object.values(restarted.match.scores).every((s) => s.points === 0), JSON.stringify([restarted.match.phase, restarted.match.scores]));

// 7e. kick_player drops the stuck participant and frees the ready gate.
const kicked = await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'kick_player', clientId: darek.clientId });
check('kick_player removes the participant', kicked.status === 'ok' && kicked.state.players.every((p) => p.name !== 'DAREK'), JSON.stringify(kicked.state.players.map((p) => p.name)));
check('kick frees the heat slot', kicked.state.heats[0].playerIds.length === 1);
a3.ws.send(j({ type: 'kbt_briefed' }));
await sleep(300);
const beganAfterKick = await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'begin_heat' });
check('begin_heat starts after the kick', beganAfterKick.status === 'ok' && beganAfterKick.match.phase === 'countdown', JSON.stringify([beganAfterKick.status, beganAfterKick.match.phase]));
await api('POST', `/room/${roomId}/kettlebell-tournament/match`, { action: 'stop_heat' });
darek.ws.close();

// ── Cleanup ──────────────────────────────────────────────────────────────────
b.ws.close(); a3.ws.close();
stopAllAcking();
await api('DELETE', `/room/${roomId}`);
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
