// Duck Hunter end-to-end smoke: fake phones over WS + host REST commands.
// Uses Node 22's built-in WebSocket.
//
// Usage:
//   1. SKIP_PYTHON=1 pnpm start
//   2. node scripts/duck-hunter-e2e.mjs
//
// Exercises the stabilization surface without the YOLO sidecar or a real
// camera: join acks + playerKey resume, the 6-player cap, reconnect adoption
// (fast-refresh and closed-socket variants), camera offers through
// InputManager (heartbeat acks flip camLive; a silent publish goes dark
// after the 12 s liveness TTL), match lifecycle incl. the solo-zero draw,
// and the 4404 room_error contract for dead rooms. No duck/hit assertions —
// those need the bird model.

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

// camLive measures real publish liveness (heartbeat acks), so fake phones ack
// their WHIP inputs like the real page's use-whip-heartbeat does.
const ackTimers = new Map();
function startAcking(roomId, inputId) {
  if (ackTimers.has(inputId)) return;
  const ack = () =>
    fetch(
      `${API}/room/${roomId}/input/${encodeURIComponent(inputId)}/whip/ack`,
      { method: 'POST' },
    ).catch(() => {});
  void ack();
  ackTimers.set(inputId, setInterval(ack, 4000));
}
function stopAcking(inputId) {
  const t = ackTimers.get(inputId);
  if (t) clearInterval(t);
  ackTimers.delete(inputId);
}
function stopAllAcking() {
  for (const t of ackTimers.values()) clearInterval(t);
  ackTimers.clear();
}

function phone(roomId, name) {
  const ws = new WebSocket(`ws://localhost:3001/room/${roomId}/ws`);
  const p = {
    name,
    ws,
    clientId: null,
    playerKey: null,
    joined: null,
    offer: null,
    errors: [],
    states: [],
    matches: [],
    closeCode: null,
    types: new Set(),
  };
  ws.addEventListener('message', (msg) => {
    let ev;
    try {
      ev = JSON.parse(String(msg.data));
    } catch {
      return;
    }
    p.types.add(ev.type);
    if (ev.type === 'shooter_joined') {
      p.clientId = ev.clientId;
      p.playerKey = ev.playerKey;
      p.joined = ev;
    }
    if (ev.type === 'shooter_error') p.errors.push(ev);
    if (ev.type === 'shooter_cam_offer') p.offer = ev;
    if (ev.type === 'shooter_state') p.states.push(ev);
    if (ev.type === 'shooter_match') p.matches.push(ev);
    if (ev.type === 'room_error') p.roomError = ev;
  });
  ws.addEventListener('close', (ev) => {
    p.closeCode = ev.code;
  });
  p.open = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  p.lastState = () => p.states[p.states.length - 1] ?? null;
  return p;
}

// ── 1. Room + config ─────────────────────────────────────────────────────────
const created = await api('POST', '/room', {
  initInputs: [],
  skipDefaultInputs: true,
  resolution: { width: 1920, height: 1080 },
});
const roomId = created.roomId;
check('room created', !!roomId && !!created.whepUrl);
await api('POST', `/room/${roomId}/duck-hunter/config`, {
  maxAmmo: 6,
  reloadMs: 3000,
});

// ── 2. Joins: ack + playerKey + the 6-player cap ────────────────────────────
const phones = [];
for (let i = 0; i < 6; i++) {
  const p = phone(roomId, `HUNTER${i}`);
  phones.push(p);
  await p.open;
  p.ws.send(j({ type: 'shoot_join', name: p.name }));
}
await sleep(400);
check(
  'all 6 joins acked with playerKeys',
  phones.every((p) => !!p.playerKey && !!p.clientId),
  JSON.stringify(phones.map((p) => [p.name, p.playerKey?.slice(0, 8)])),
);
const [a, b] = phones;
check(
  'roster has 6 hunters',
  a.lastState()?.players.length === 6,
  JSON.stringify(a.lastState()?.players.map((p) => p.name)),
);

const late = phone(roomId, 'LATE');
await late.open;
late.ws.send(j({ type: 'shoot_join', name: 'LATE' }));
await sleep(300);
check(
  '7th join refused with room_full',
  late.errors.some((e) => e.code === 'room_full') && !late.playerKey,
  JSON.stringify(late.errors),
);
late.ws.close();

// ── 3. Reconnect adoption ────────────────────────────────────────────────────
// 3a. Closed socket → rejoin with the key on a fresh socket.
const keyB = b.playerKey;
const colorB = a.lastState()?.players.find((p) => p.clientId === b.clientId)
  ?.color;
b.ws.close();
await sleep(400);
const b2 = phone(roomId, 'HUNTER1');
await b2.open;
b2.ws.send(j({ type: 'shoot_join', name: 'HUNTER1', playerKey: keyB }));
await sleep(400);
check('key rejoin echoes the same key', b2.playerKey === keyB);
check(
  'adoption kept the roster at 6 with the same color',
  b2.lastState()?.players.length === 6 &&
    b2.lastState()?.players.find((p) => p.clientId === b2.clientId)?.color ===
      colorB,
  JSON.stringify(b2.lastState()?.players.map((p) => [p.name, p.color])),
);

// 3b. Fast refresh: a new socket adopts while the old one is STILL OPEN.
const c = phones[2];
const c2 = phone(roomId, 'HUNTER2');
await c2.open;
c2.ws.send(j({ type: 'shoot_join', name: 'HUNTER2', playerKey: c.playerKey }));
await sleep(400);
check(
  'fast-refresh key adoption — still 6 hunters',
  c2.lastState()?.players.length === 6,
  JSON.stringify(c2.lastState()?.players.map((p) => p.name)),
);
c.ws.close(); // the stale close must hit a missing entry and no-op
await sleep(400);
check(
  'late stale close leaves the adopted entry connected',
  c2.lastState()?.players.find((p) => p.clientId === c2.clientId)?.connected ===
    true,
);

// 3c. Disconnect grace: a dropped phone stays on the roster (grayed out).
const d = phones[3];
d.ws.close();
await sleep(600);
const dRow = c2
  .lastState()
  ?.players.find((p) => p.name === 'HUNTER3');
check(
  'dropped phone lingers disconnected (grace, not deletion)',
  !!dRow && dRow.connected === false,
  JSON.stringify(dRow),
);

// ── 4. Camera through InputManager: offer + heartbeat liveness ──────────────
a.ws.send(j({ type: 'shoot_cam_start', nativeWidth: 720, nativeHeight: 1280 }));
await sleep(1500);
check(
  'cam offer carries an InputManager whip input + bearer',
  !!a.offer?.inputId &&
    a.offer.inputId.includes('::whip::') &&
    !!a.offer?.whipUrl &&
    !!a.offer?.bearerToken,
  JSON.stringify(a.offer),
);
startAcking(roomId, a.offer.inputId);
await sleep(2500); // cam poll (1 Hz) picks up the acks
let aRow = a.lastState()?.players.find((p) => p.clientId === a.clientId);
check('acked publish flips camLive true', aRow?.camLive === true, JSON.stringify(aRow));

stopAcking(a.offer.inputId);
await sleep(14_000); // WHIP_LIVE_TTL_MS (12 s) + a poll cycle
aRow = a.lastState()?.players.find((p) => p.clientId === a.clientId);
check(
  'silent publish goes dark after the liveness TTL',
  aRow?.camLive === false,
  JSON.stringify(aRow),
);
// (The 45 s stale sweep + onInputsRemoved reap is covered by unit tests —
// waiting it out here would double the script's runtime.)
a.ws.send(j({ type: 'shoot_cam_stop' }));

// ── 5. Match lifecycle ───────────────────────────────────────────────────────
// The REST endpoints wrap the snapshot: { status: 'ok', match: {...} }.
const getMatch = async () =>
  (await api('GET', `/room/${roomId}/duck-hunter/match`)).match;
await api('POST', `/room/${roomId}/duck-hunter/match`, { action: 'lobby' });
let match = await getMatch();
check('lobby armed', match.phase === 'lobby', JSON.stringify(match));

await api('POST', `/room/${roomId}/duck-hunter/match`, {
  action: 'start',
  mode: 'time',
  durationMs: 30_000,
});
match = await getMatch();
check('countdown running', match.phase === 'countdown', JSON.stringify(match));
await sleep(3400);
match = await getMatch();
check('playing after countdown', match.phase === 'playing');
check(
  'phones got the 1 Hz shooter_match clock',
  a.matches.filter((m) => m.phase === 'playing').length >= 1,
);

await api('POST', `/room/${roomId}/duck-hunter/match`, { action: 'stop' });
match = await getMatch();
check(
  'ended with no winner (all zero scores = draw, nobody crowned)',
  match.phase === 'ended' &&
    match.winner == null &&
    match.finalScores?.length === 6,
  JSON.stringify([match.phase, match.winner, match.finalScores?.length]),
);
// A draw records nothing, but the ended snapshot still carries the global
// table (real submissions need the bird model, out of scope for fake phones).
check(
  'ended snapshot carries topScores + null rank on a draw',
  Array.isArray(match.topScores) && match.topScoreRank === null,
  JSON.stringify([match.topScores, match.topScoreRank]),
);
const topScoresRes = await api('GET', `/duck-hunter/top-scores`);
check(
  'GET /duck-hunter/top-scores returns per-mode arrays',
  Array.isArray(topScoresRes.scores?.time) &&
    Array.isArray(topScoresRes.scores?.points),
  JSON.stringify(topScoresRes),
);

// ── 6. Dead-room contract: room_error + close 4404, no silent black hole ────
const ghost = phone('no-such-room', 'GHOST');
await ghost.open; // the upgrade itself succeeds; the server then refuses
await sleep(400);
check(
  'unknown room → room_error event',
  ghost.roomError?.code === 'room_not_found',
  JSON.stringify(ghost.roomError),
);
check('unknown room → close code 4404', ghost.closeCode === 4404, String(ghost.closeCode));

// ── Cleanup ──────────────────────────────────────────────────────────────────
for (const p of [a, b2, c2, ...phones.slice(4)]) p.ws.close();
stopAllAcking();
await api('DELETE', `/room/${roomId}`);
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
