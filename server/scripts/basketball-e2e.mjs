#!/usr/bin/env node
// End-to-end smoke for the basketball game over the real REST + WS surface.
//
//   BB_SIM=1 SKIP_PYTHON=1 pnpm start        # terminal 1
//   node scripts/basketball-e2e.mjs          # terminal 2
//   BB_E2E_MP4=bb-synth.mp4 node scripts/basketball-e2e.mjs   # + real model
//   BB_E2E_MP4=apidis/q2/cam7.mp4 BB_E2E_REPLAY=apidis/q2/events.json node scripts/basketball-e2e.mjs
//                                                          # + ground-truth replay (no model needed)
//
// Two fake camera phones (hoop + court) register real WHIP inputs through the
// offer flow and ack their heartbeats like use-whip-heartbeat does; a fake
// moderator joins over the same socket kind the panel uses. Then the ledger,
// clock, overtime, adoption and error contracts are exercised.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.BB_API ?? 'http://localhost:3001';
const MP4 = process.env.BB_E2E_MP4 ?? '';
const REPLAY = process.env.BB_E2E_REPLAY ?? '';
const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const j = JSON.stringify;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) fails++;
}
async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? j(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

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

function phone(roomId, label) {
  const ws = new WebSocket(`${API.replace(/^http/, 'ws')}/room/${roomId}/ws`);
  const p = { label, ws, joined: null, offer: null, errors: [], shots: [], balls: [], states: [], types: new Set() };
  ws.addEventListener('message', (msg) => {
    let ev;
    try {
      ev = JSON.parse(String(msg.data));
    } catch {
      return;
    }
    p.types.add(ev.type);
    if (ev.type === 'bb_cam_joined' || ev.type === 'bb_commentator_joined') p.joined = ev;
    if (ev.type === 'bb_error') p.errors.push(ev);
    if (ev.type === 'bb_cam_offer') {
      p.offer = ev;
      startAcking(roomId, ev.inputId);
    }
    if (ev.type === 'bb_shot') p.shots.push(ev);
    if (ev.type === 'bb_ball') p.balls.push(ev);
    if (ev.type === 'bb_state') p.states.push(ev);
  });
  p.open = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  p.send = (m) => ws.send(j(m));
  return p;
}

const state = (roomId) => api('GET', `/room/${roomId}/basketball-game/state`);

// ── 1. Room + config ─────────────────────────────────────────────────────────
const created = await api('POST', '/room', {
  initInputs: [],
  skipDefaultInputs: true,
  resolution: { width: 1280, height: 720 },
});
const roomId = created.roomId;
check('room created', !!roomId && !!created.whepUrl);

try {
  const cfg = await api('POST', `/room/${roomId}/basketball-game/config`, {
    teams: { A: { name: 'BLACKTOP', color: '#ff6a1f' }, B: { name: 'CHALK', color: '#1f7bff' } },
    targetPoints: 21,
    durationMs: 30_000,
    otWinPoints: 2,
    autoAssignMinConf: 0.6,
    detector: { ballDetector: MP4 ? 'hsv' : 'auto' },
    joinUrls: { hoop: 'http://e2e/h', court: 'http://e2e/c', commentator: 'http://e2e/m' },
    joinLabel: 'e2e',
  });
  check('config applied (30 s clock, 21 pts, OT +2)', cfg.config.durationMs === 30_000 && cfg.config.targetPoints === 21 && cfg.config.teams.B.name === 'CHALK');

  // ── 2. Phones ──────────────────────────────────────────────────────────────
  const hoop = phone(roomId, 'hoop');
  const court = phone(roomId, 'court');
  const mod = phone(roomId, 'mod');
  await Promise.all([hoop.open, court.open, mod.open]);
  hoop.send({ type: 'bb_cam_join', role: 'hoop', name: 'RIM' });
  court.send({ type: 'bb_cam_join', role: 'court', name: 'WIDE' });
  mod.send({ type: 'bb_commentator_join', name: 'REF' });
  await sleep(300);
  check('cams + moderator joined (keys issued)', !!hoop.joined?.camKey && !!court.joined?.camKey && !!mod.joined?.commentatorKey);
  hoop.send({ type: 'bb_cam_request', nativeWidth: 1280, nativeHeight: 720 });
  court.send({ type: 'bb_cam_request', nativeWidth: 1920, nativeHeight: 1080 });
  await sleep(2000);
  check('WHIP offers received for both cams', !!hoop.offer?.whipUrl && !!court.offer?.bearerToken && hoop.offer.role === 'hoop');

  const taken = phone(roomId, 'taken');
  await taken.open;
  taken.send({ type: 'bb_cam_join', role: 'hoop', name: 'INTRUDER' });
  await sleep(300);
  check('a held role is refused without the key', taken.errors.some((e) => e.code === 'role_taken'));
  taken.ws.close();

  hoop.send({ type: 'bb_rim_calibrate', rim: { cx: 0.5, cy: 0.35, rx: 0.06, ry: 0.02 } });
  await sleep(300);
  let snap = await state(roomId);
  check('rim calibrated', snap.state.cams.hoop.calibrated === true && snap.state.config.rim?.rx === 0.06);
  hoop.send({ type: 'bb_rim_calibrate', rim: { cx: 5, cy: 0, rx: 0, ry: 0 } });
  await sleep(200);
  check('bad rim rejected', hoop.errors.some((e) => e.code === 'invalid_rim'));
  mod.send({ type: 'bb_team_color', team: 'B', color: '#2ee06a' });
  await sleep(200);
  snap = await state(roomId);
  check('moderator set a team colour', snap.state.config.teams.B.color === '#2ee06a');

  if (MP4) {
    const cam = await api('POST', `/room/${roomId}/basketball-game/mp4-cam`, { role: 'hoop', fileName: MP4 });
    check('mp4 hoop cam attached', cam.status === 'ok' && !!cam.inputId, j(cam));
    const courtCam = await api('POST', `/room/${roomId}/basketball-game/mp4-cam`, { role: 'court', fileName: MP4 });
    check('mp4 court cam attached (replaces the phone stream)', courtCam.status === 'ok' && !!courtCam.inputId, j(courtCam));
    const bad = await api('POST', `/room/${roomId}/basketball-game/mp4-cam`, { role: 'court', fileName: '../etc/passwd.mp4' }).catch((e) => String(e));
    check('traversal fileName rejected', typeof bad === 'string' && bad.includes('400'), String(bad));
    const synced = await api('POST', `/room/${roomId}/basketball-game/mp4-cam/sync`, { playFromMs: 0 });
    check('file cams restarted in sync', synced.status === 'ok' && synced.inputIds.length === 2, j(synced));
    snap = await state(roomId);
    check('state reports file cams', snap.state.cams.hoop.source === 'file' && snap.state.cams.hoop.fileName === MP4 && snap.state.cams.court.source === 'file', j(snap.state.cams));
    if (REPLAY) {
      const badGt = await api('POST', `/room/${roomId}/basketball-game/replay`, { fileName: '../events.json' }).catch((e) => String(e));
      check('replay: traversal fileName rejected', typeof badGt === 'string' && badGt.includes('400'), String(badGt));
      const loaded = await api('POST', `/room/${roomId}/basketball-game/replay`, { fileName: REPLAY, basket: 'both' });
      check('replay: ground truth loaded on the file cams', loaded.status === 'ok' && loaded.replay?.total > 0 && loaded.replay.active === true, j(loaded.replay));
      snap = await state(roomId);
      check('replay: state carries the replay', snap.state.replay?.fileName === REPLAY && snap.state.replay.total === loaded.replay.total, j(snap.state.replay));
      const off = await api('POST', `/room/${roomId}/basketball-game/replay`, { action: 'off' });
      check('replay: off clears it', off.status === 'ok' && off.replay === null && (await state(roomId)).state.replay === null);
    }
    // The court phone still holds its slot: a fresh publish takes it back
    // from the clip (the liveness checks below need a heartbeat-driven cam).
    const prevCourtOffer = court.offer;
    court.send({ type: 'bb_cam_request', nativeWidth: 1920, nativeHeight: 1080 });
    for (let i = 0; i < 50 && court.offer === prevCourtOffer; i++) await sleep(100);
    snap = await state(roomId);
    check('court phone took the slot back from the clip', court.offer !== prevCourtOffer && snap.state.cams.court.source === 'whip' && !snap.state.cams.court.fileName, j(snap.state.cams.court));
    const syncedOne = await api('POST', `/room/${roomId}/basketball-game/mp4-cam/sync`, {});
    check('sync now restarts the hoop clip only', syncedOne.inputIds.length === 1 && syncedOne.inputIds[0] === cam.inputId, j(syncedOne));
  }

  await sleep(4500); // heartbeat acks → camConnected
  snap = await state(roomId);
  check('cams report live', snap.state.cams.court.camConnected === true && (MP4 || snap.state.cams.hoop.camConnected === true), j(snap.state.cams));

  // ── 3. Warm-up + start ────────────────────────────────────────────────────
  const warm = await api('POST', `/room/${roomId}/basketball-game/simulate-shot`, { team: 'A', confidence: 0.9 });
  check('lobby make is warm-up feedback', warm.shot?.status === 'voided');
  await sleep(200);
  check('hoop phone got the warm-up event', hoop.shots.some((s) => s.kind === 'warmup'));

  const start = await api('POST', `/room/${roomId}/basketball-game/match`, { action: 'start' });
  check('tip-off', start.status === 'ok' && start.match.phase === 'live');
  const t0 = Date.now();

  // ── 4. Ledger ─────────────────────────────────────────────────────────────
  const a1 = await api('POST', `/room/${roomId}/basketball-game/simulate-shot`, { team: 'A', confidence: 0.92 });
  check('confident make → confirmed A', a1.shot?.status === 'confirmed' && a1.shot.team === 'A');
  const unsure = await api('POST', `/room/${roomId}/basketball-game/simulate-shot`, { team: 'B', confidence: 0.3 });
  check('unsure make → pending', unsure.shot?.status === 'pending');
  await sleep(200);
  mod.send({ type: 'bb_shot_resolve', shotId: unsure.shot.id, team: 'B' });
  await sleep(300);
  snap = await state(roomId);
  check('moderator resolved the call over WS (1:1)', snap.state.teams.A.score === 1 && snap.state.teams.B.score === 1 && snap.state.pending.length === 0);
  hoop.send({ type: 'bb_shot_resolve', shotId: unsure.shot.id, team: 'A' });
  await sleep(200);
  check('a camera phone cannot edit the ledger', hoop.errors.some((e) => e.code === 'not_commentator'));

  const two = await api('POST', `/room/${roomId}/basketball-game/shot`, { op: 'add', team: 'B', points: 2 });
  check('manual +2 via REST', two.status === 'ok' && two.state.teams.B.score === 3 && two.state.teams.B.twos === 1);
  check('lead change broadcast', mod.types.has('bb_lead_change'));
  const undo = await api('POST', `/room/${roomId}/basketball-game/shot`, { op: 'undo' });
  check('undo voids the manual +2', undo.shot?.status === 'voided' && undo.state.teams.B.score === 1);

  // ── 5. Clock: pause / resume, buzzer → overtime ───────────────────────────
  await api('POST', `/room/${roomId}/basketball-game/match`, { action: 'pause' });
  const paused1 = (await state(roomId)).match;
  await sleep(1500);
  const paused2 = (await state(roomId)).match;
  check('pause freezes the clock', paused1.phase === 'paused' && paused1.remainingMs === paused2.remainingMs);
  mod.send({ type: 'bb_commentator_match', action: 'resume' });
  await sleep(300);
  check('moderator resumed over WS', (await state(roomId)).match.phase === 'live');

  // Tied 1:1 → the buzzer must send the match to overtime. Wait it out.
  const remaining = (await state(roomId)).match.remainingMs;
  console.log(`  waiting ${Math.ceil(remaining / 1000)} s for the buzzer…`);
  await sleep(remaining + 1200);
  snap = await state(roomId);
  check('tied at the buzzer → overtime', snap.match.phase === 'overtime' && snap.match.period === 'ot', j(snap.match));
  await api('POST', `/room/${roomId}/basketball-game/simulate-shot`, { team: 'B', confidence: 0.9 });
  check('one OT point does not end it', (await state(roomId)).match.phase === 'overtime');
  await api('POST', `/room/${roomId}/basketball-game/simulate-shot`, { team: 'B', confidence: 0.9 });
  snap = await state(roomId);
  check('+2 in OT ends the match for B', snap.match.phase === 'ended' && snap.match.winner === 'B' && snap.match.otScores.B === 2, j(snap.match));
  const reopen = await api('POST', `/room/${roomId}/basketball-game/shot`, { op: 'undo' });
  check('undo after the final re-opens overtime', reopen.match.phase === 'overtime' && reopen.match.winner === null);
  await api('POST', `/room/${roomId}/basketball-game/match`, { action: 'end' });
  snap = await state(roomId);
  check('manual end crowns the leader', snap.match.phase === 'ended' && snap.match.winner === 'B');
  check(`clock path took ${Math.round((Date.now() - t0) / 1000)} s`, true);

  // ── 6. Adoption + reap ────────────────────────────────────────────────────
  const hoopKey = hoop.joined.camKey;
  const hoopInput = hoop.offer.inputId;
  hoop.ws.close();
  await sleep(300);
  const hoop2 = phone(roomId, 'hoop2');
  await hoop2.open;
  hoop2.send({ type: 'bb_cam_join', role: 'hoop', camKey: hoopKey });
  await sleep(300);
  check('refreshed hoop phone re-adopts its role and input', hoop2.joined?.camKey === hoopKey && hoop2.joined?.camInputActive === true && hoop2.joined?.rim?.rx === 0.06);
  snap = await state(roomId);
  check('adopted slot is connected again', snap.state.cams.hoop.connected === true);
  // Stop acking the court cam: the server must mark it dark within the TTL.
  clearInterval(ackTimers.get(court.offer.inputId));
  ackTimers.delete(court.offer.inputId);
  await sleep(13_000);
  snap = await state(roomId);
  check('silent publish goes dark (camConnected false)', snap.state.cams.court.camConnected === false);
  void hoopInput;

  // ── 7. Reset + kick ───────────────────────────────────────────────────────
  const reset = await api('POST', `/room/${roomId}/basketball-game/match`, { action: 'reset' });
  check('reset → lobby, ledger cleared, cams kept', reset.state.phase === 'lobby' && reset.state.recent.length === 0 && reset.state.cams.hoop.joined === true);
  const kick = await api('POST', `/room/${roomId}/basketball-game/match`, { action: 'kick_cam', role: 'court' });
  check('kick court cam', kick.status === 'ok' && kick.state.cams.court.joined === false);
  const badStart = await api('POST', `/room/${roomId}/basketball-game/match`, { action: 'pause' });
  check('pause in the lobby is rejected', badStart.status === 'rejected' && badStart.error?.code === 'bad_action');

  if (MP4 && REPLAY) {
    // Fire one annotated make on the clip: seek just before it, load, START.
    const gt = JSON.parse(fs.readFileSync(path.join(DATA, 'mp4s', REPLAY), 'utf8'));
    const firstMake = gt.events.filter((e) => e.kind === 'throw' && e.made).sort((a, b) => a.tMs - b.tMs)[0];
    check('replay: events file has a made throw', !!firstMake, REPLAY);
    const hoopClip = await api('POST', `/room/${roomId}/basketball-game/mp4-cam`, { role: 'hoop', fileName: MP4 });
    check('replay: hoop clip re-attached', hoopClip.status === 'ok', j(hoopClip));
    for (let i = 0; i < 150 && !(await state(roomId)).state.cams.hoop.clip; i++) await sleep(200);
    // The engine cannot seek a clip beyond the pipeline's age, so ask for the
    // lesser of "just before the first make" and where the clip already is.
    const ageMs = (await state(roomId)).state.cams.hoop.clip.mediaMs;
    const seekMs = Math.max(0, Math.min(firstMake.tMs - 4000, ageMs));
    await api('POST', `/room/${roomId}/basketball-game/mp4-cam/sync`, { playFromMs: seekMs });
    for (let i = 0; i < 150; i++) {
      snap = await state(roomId);
      if (snap.state.cams.hoop.clip && Math.abs(snap.state.cams.hoop.clip.playFromMs - seekMs) < 1500) break;
      await sleep(200);
    }
    const playFrom = snap.state.cams.hoop.clip?.playFromMs ?? 0;
    check('replay: clip restarted at the requested playhead', Math.abs(playFrom - seekMs) < 1500, `asked ${seekMs}, got ${j(snap.state.cams.hoop.clip)}`);
    const target = gt.events.filter((e) => e.kind === 'throw' && e.made && e.tMs >= playFrom + 3000).sort((a, b) => a.tMs - b.tMs)[0] ?? firstMake;
    const loaded = await api('POST', `/room/${roomId}/basketball-game/replay`, { fileName: REPLAY, basket: 'both', loop: false });
    check('replay: next throw is ahead of the playhead', loaded.replay?.nextEventTMs != null && loaded.replay.nextEventTMs >= playFrom - 2000, j(loaded.replay));
    await api('POST', `/room/${roomId}/basketball-game/match`, { action: 'start' });
    const waitMs = Math.max(0, target.tMs - playFrom) + 6000;
    console.log(`  waiting ${waitMs} ms for the ground-truth make at ${target.tMs} ms (clip at ${playFrom} ms)…`);
    await sleep(waitMs);
    snap = await state(roomId);
    const gtShots = snap.state.recent.filter((s) => s.source === 'replay');
    check('replay: a ground-truth make landed in the ledger', gtShots.length >= 1, `fired=${snap.state.replay?.fired} skipped=${snap.state.replay?.skipped} recent=${j(snap.state.recent.map((s) => [s.source, s.mediaMs]))}`);
    check('replay: no AI shots while the replay owns the ledger', !snap.state.recent.some((s) => s.source === 'ai'));
    check('replay: shots carry the clip media time', gtShots.every((s) => typeof s.mediaMs === 'number'), j(gtShots.map((s) => s.mediaMs)));
  } else if (MP4) {
    await api('POST', `/room/${roomId}/basketball-game/match`, { action: 'start' });
    console.log('  running the model on the clip for 25 s…');
    await sleep(25_000);
    snap = await state(roomId);
    const makes = snap.state.recent.filter((s) => s.source === 'ai' && s.status !== 'voided').length;
    check('model produced makes from the clip', makes >= 1, `${makes} makes, A=${snap.state.teams.A.score} B=${snap.state.teams.B.score}`);
  }

  // ── 8. Room gone contract ─────────────────────────────────────────────────
  hoop2.ws.close();
  court.ws.close();
  mod.ws.close();
  await api('DELETE', `/room/${roomId}`);
  const gone = phone(roomId, 'gone');
  const closeCode = await new Promise((resolve) => {
    gone.ws.addEventListener('close', (ev) => resolve(ev.code), { once: true });
    gone.ws.addEventListener('error', () => resolve(-1), { once: true });
  });
  check('WS to a deleted room closes with 4404', closeCode === 4404, String(closeCode));
} catch (err) {
  check(`unexpected error: ${err instanceof Error ? err.message : String(err)}`, false);
} finally {
  stopAllAcking();
  await api('DELETE', `/room/${roomId}`).catch(() => {});
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
}
