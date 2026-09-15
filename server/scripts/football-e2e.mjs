#!/usr/bin/env node
// End-to-end smoke for the football game ("Touchline") over the real REST +
// WS surface, driven by a dataset clip and its sidecars.
//
//   FB_SIM=1 SKIP_PYTHON=1 pnpm start                    # terminal 1
//   node scripts/football-e2e.mjs                        # terminal 2
//   FB_E2E_MP4=fb-demo/pano-3x40s/pano.mp4 node scripts/football-e2e.mjs
//   FB_API=http://localhost:3111 node scripts/football-e2e.mjs   # parallel stack
//
// Flow: room → moderator socket → config → panorama file cam (+ sync) →
// telemetry + AI EVENTS armed → KICK-OFF → the first annotated play fires on
// the file clock → view switches → minimap toggle → manual goal → simulated
// goal candidate resolved as a REF CALL → undo → pause / half time / second
// half / full time → reset; plus the error contracts.

import {
  API,
  api,
  createRoom,
  deleteRoom,
  fmtEvent,
  getState,
  openSocket,
  sleep,
  waitFor,
} from './lib/fb-api.mjs';

const MP4 = process.env.FB_E2E_MP4 ?? 'fb-demo/pano-3x40s/pano.mp4';
const ROLE = process.env.FB_E2E_ROLE ?? 'pano';
const FIRST_PLAY_TIMEOUT_MS = Number(process.env.FB_E2E_PLAY_TIMEOUT ?? 90_000);

let fails = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) fails++;
}

const t0 = Date.now();
const log = (...a) =>
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const created = await createRoom();
const roomId = created.roomId;
check('room created', !!roomId && !!created.whepUrl, roomId);

/** A socket that keeps the latest state/match and every event. */
function client(label) {
  const c = {
    label,
    state: null,
    match: null,
    events: [],
    errors: [],
    aiLog: [],
    director: null,
    joined: null,
    types: new Set(),
    sock: null,
  };
  c.open = async () => {
    c.sock = await openSocket(roomId, (ev) => {
      c.types.add(ev.type);
      if (ev.type === 'fb_state') c.state = ev;
      else if (ev.type === 'fb_match') c.match = ev;
      else if (ev.type === 'fb_event') {
        c.events.push(ev);
        log(`${label} EVENT ${ev.kind}`, fmtEvent(ev.event));
      } else if (ev.type === 'fb_error') {
        c.errors.push(ev);
        log(`${label} ERROR`, ev.code, ev.message);
      } else if (ev.type === 'fb_ai_log') {
        for (const e of ev.entries) {
          c.aiLog.push(e);
          log(`${label}   ai-log`, e.label, e.text);
        }
      } else if (ev.type === 'fb_director') c.director = ev.director;
      else if (ev.type === 'fb_commentator_joined') c.joined = ev;
    });
    return c;
  };
  c.send = (obj) => c.sock.send(obj);
  c.close = () => c.sock?.close();
  return c;
}

const mod = await client('mod').open();
const spec = await client('spec').open();
mod.send({ type: 'fb_spectate' });
spec.send({ type: 'fb_spectate' });
mod.send({ type: 'fb_commentator_join', name: 'E2E MOD' });
await waitFor(() => mod.joined, { label: 'moderator joined' });
check('moderator joined', mod.joined?.name === 'E2E MOD');
await waitFor(() => spec.state, { label: 'spectator state' });
check('spectator gets fb_state', spec.state?.phase === 'lobby');

try {
  // ── config ──
  const cfg = await api('POST', `/room/${roomId}/football-game/config`, {
    teams: { A: { name: 'Tromsø', short: 'TIL' }, B: { name: 'Tottenham' } },
    halfMs: 3 * 60_000,
    replayDelayMs: 0,
    ai: {
      events: true,
      kinds: ['goal', 'chance', 'shot', 'corner', 'sprint', 'attack'],
      replayOn: ['shot', 'goal'],
    },
    perf: { hudPublishHz: 5 },
  });
  check(
    'config applied',
    cfg.config?.halfMs === 180_000 && cfg.config?.teams?.A?.short === 'TIL',
  );

  // ── file cam + telemetry ──
  const attached = await api('POST', `/room/${roomId}/football-game/mp4-cam`, {
    role: ROLE,
    fileName: MP4,
  });
  check('file cam attached', !!attached.inputId, attached.inputId);
  const synced = await api(
    'POST',
    `/room/${roomId}/football-game/mp4-cam/sync`,
    { playFromMs: 0 },
  );
  check('file cams synced', Array.isArray(synced.inputIds));
  await waitFor(() => mod.state?.cams?.[ROLE]?.connected, {
    label: 'file cam connected',
    timeoutMs: 40_000,
  });
  const tele = mod.state.cams[ROLE].telemetry;
  log('telemetry', JSON.stringify(tele), 'session', mod.state.session);
  check(
    'session detected',
    mod.state.session === (ROLE === 'pano' ? 'pano' : 'tricam'),
  );
  check('telemetry sidecars read', tele.zxy || tele.ball, JSON.stringify(tele));
  const aiStatus = await waitFor(
    () =>
      mod.state?.aiEvents === 'armed' || mod.state?.aiEvents === 'no_events'
        ? mod.state.aiEvents
        : null,
    { label: 'AI EVENTS resolved', timeoutMs: 30_000 },
  );
  check(
    'AI EVENTS armed from the clip sidecar',
    aiStatus === 'armed',
    `${aiStatus} · ${JSON.stringify(mod.state.aiRun)}`,
  );
  const hasPlays = aiStatus === 'armed' && (mod.state.aiRun?.total ?? 0) > 0;

  // ── lobby contracts ──
  const early = await api('POST', `/room/${roomId}/football-game/event`, {
    op: 'add',
    team: 'A',
    kind: 'goal',
  });
  check('no manual events before kick-off', early.status === 'rejected');

  // ── kick-off ──
  const start = await api('POST', `/room/${roomId}/football-game/match`, {
    action: 'start',
  });
  check('kick-off', start.status === 'ok' && start.match.phase === 'live');
  log(
    'clock from clip',
    start.match.clockFromClip,
    'elapsed',
    start.match.elapsedMs,
  );
  const again = await api('POST', `/room/${roomId}/football-game/match`, {
    action: 'start',
  });
  check('second kick-off rejected', again.status === 'rejected');

  // ── director ──
  await waitFor(() => mod.director || mod.state?.director?.crop, {
    label: 'director',
  });
  const d0 = mod.state.director;
  log('director', JSON.stringify(d0));
  if (ROLE === 'pano') {
    check('follow crop on air', d0.effectiveView === 'follow' && !!d0.crop);
    check(
      'ball tracked',
      d0.ballTracked === true || !tele.ball,
      `ball=${tele.ball}`,
    );
    mod.send({
      type: 'fb_commentator_view',
      override: { mode: 'view', view: 'wide' },
    });
    await waitFor(() => mod.state?.director?.effectiveView === 'wide', {
      label: 'wide view',
    });
    check(
      'WIDE view',
      mod.state.director.crop.h >= mod.state.director.crop.w / 2,
    );
    mod.send({
      type: 'fb_commentator_view',
      override: { mode: 'view', view: 'left-goal' },
    });
    await waitFor(() => mod.state?.director?.effectiveView === 'left-goal', {
      label: 'left goal view',
    });
    check('LEFT GOAL view', mod.state.director.crop.x < 1500);
    spec.send({
      type: 'fb_commentator_view',
      override: { mode: 'view', view: 'wide' },
    });
    await waitFor(() => spec.errors.length > 0, { label: 'spectator refused' });
    check(
      'spectator cannot switch views',
      spec.errors[0].code === 'not_commentator',
    );
    mod.send({ type: 'fb_commentator_view', override: { mode: 'auto' } });
    await waitFor(() => mod.state?.director?.effectiveView === 'follow', {
      label: 'auto view',
    });
    check('back to AUTO', mod.state.director.view === 'auto');
  }

  // ── minimap ──
  if (tele.zxy) {
    mod.send({ type: 'fb_commentator_minimap', enabled: false });
    await waitFor(() => mod.state?.minimap === false, { label: 'minimap off' });
    mod.send({ type: 'fb_commentator_minimap', enabled: true });
    await waitFor(() => mod.state?.minimap === true, { label: 'minimap on' });
    check('minimap toggles', true);
    check(
      'tracking table filled',
      (mod.state.tracking?.length ?? 0) > 0,
      `${mod.state.tracking?.length} tags`,
    );
  }

  // ── the first annotated play ──
  if (hasPlays) {
    const fired = await waitFor(
      () => mod.events.find((e) => e.kind === 'fired') ?? null,
      { label: 'first AI play', timeoutMs: FIRST_PLAY_TIMEOUT_MS },
    );
    check(
      'AI play fired from the sidecar',
      fired.event.source === 'ai' && fired.event.mediaMs != null,
      fmtEvent(fired.event),
    );
    check(
      'play is confirmed or a goal REF CALL',
      fired.event.kind === 'goal'
        ? fired.event.status === 'pending'
        : fired.event.status === 'confirmed',
    );
    check(
      'AI log tells the play',
      mod.aiLog.some((e) => e.kind === 'event' || e.kind === 'refcall'),
    );
    const run = mod.state.aiRun;
    check(
      'AI run counts the fire',
      (run?.fired ?? 0) >= 1,
      JSON.stringify(run),
    );
    if (
      ['shot', 'goal'].includes(fired.event.kind) &&
      mod.state.config.replay
    ) {
      const replay = await waitFor(
        () =>
          mod.aiLog.find(
            (e) => e.label === 'REPLAY' && /clip ready/.test(e.text),
          ) ?? null,
        { label: 'replay clip', timeoutMs: 15_000 },
      ).catch(() => null);
      check('instant replay clip cut', !!replay, replay?.text ?? 'no clip');
      if (replay) {
        const shown = await waitFor(() => mod.state?.scene === 'replay', {
          label: 'replay scene',
          timeoutMs: 8000,
        }).catch(() => false);
        check('replay on air', !!shown);
      }
    }
  } else {
    check('AI plays available (skipped: none in the clip)', true);
  }

  // ── ledger ──
  mod.send({ type: 'fb_event_add', team: 'A', kind: 'goal' });
  await waitFor(
    () =>
      mod.events.some((e) => e.kind === 'manual' && e.event.kind === 'goal'),
    {
      label: 'manual goal',
    },
  );
  check(
    'manual goal A',
    mod.match?.scores?.A === 1 || mod.state?.teams?.A?.score === 1,
  );

  const sim = await api(
    'POST',
    `/room/${roomId}/football-game/simulate-event`,
    {
      kind: 'goal',
      team: null,
      side: 'right',
    },
  ).catch((err) => ({ error: String(err) }));
  if (sim.error) {
    check('simulate-event (FB_SIM=1 needed)', false, sim.error);
  } else {
    check('simulated goal → REF CALL', sim.event?.status === 'pending');
    await waitFor(() => mod.state?.pending?.length === 1, { label: 'pending' });
    const ref = await api('POST', `/room/${roomId}/football-game/event`, {
      op: 'resolve',
      eventId: sim.event.id,
      team: 'B',
    });
    check('REF CALL → B', ref.status === 'ok' && ref.match.scores.B === 1);
    const undo = await api('POST', `/room/${roomId}/football-game/event`, {
      op: 'undo',
    });
    check(
      'UNDO voids the newest goal',
      undo.status === 'ok' && undo.match.scores.B === 0,
    );
    const st = await getState(roomId);
    check(
      'ledger keeps the voided row',
      st.state.recent.some((e) => e.status === 'voided'),
    );
  }

  // ── clock ──
  const pause = await api('POST', `/room/${roomId}/football-game/match`, {
    action: 'pause',
  });
  check('pause', pause.match.phase === 'paused');
  const frozen = pause.match.elapsedMs;
  await sleep(1200);
  const stPaused = await getState(roomId);
  check(
    'clock frozen while paused',
    stPaused.match.elapsedMs === frozen,
    `${frozen} vs ${stPaused.match.elapsedMs}`,
  );
  const resume = await api('POST', `/room/${roomId}/football-game/match`, {
    action: 'resume',
  });
  check('resume', resume.match.phase === 'live');
  const ht = await api('POST', `/room/${roomId}/football-game/match`, {
    action: 'half_time',
  });
  check('half time', ht.match.phase === 'halftime');
  const sh = await api('POST', `/room/${roomId}/football-game/match`, {
    action: 'second_half',
  });
  check('second half', sh.match.phase === 'live' && sh.match.period === 2);
  const end = await api('POST', `/room/${roomId}/football-game/match`, {
    action: 'end',
  });
  check(
    'full time',
    end.match.phase === 'ended' && end.state.winner === 'A',
    `winner=${end.state.winner}`,
  );
  await waitFor(() => mod.state?.phase === 'ended', {
    label: 'ended broadcast',
  });
  // The final banner plays out (3.5 s) before the full-time card takes the stage.
  const endedScene = await waitFor(() => mod.state?.scene === 'ended', {
    label: 'ended scene',
    timeoutMs: 8000,
  }).catch(() => false);
  check('ended scene on air', !!endedScene);
  const reset = await api('POST', `/room/${roomId}/football-game/match`, {
    action: 'reset',
  });
  check(
    'reset to lobby',
    reset.match.phase === 'lobby' && reset.state.recent.length === 0,
  );

  // ── AI EVENTS toggle over REST ──
  const off = await api('POST', `/room/${roomId}/football-game/ai-events`, {
    enabled: false,
  });
  check('AI EVENTS off', off.state.aiEvents === 'off');
  const on = await api('POST', `/room/${roomId}/football-game/ai-events`, {
    enabled: true,
  });
  check('AI EVENTS back on', on.state.aiEvents !== 'off');

  check(`e2e took ${Math.round((Date.now() - t0) / 1000)} s`, true);
} catch (err) {
  check('e2e threw', false, err instanceof Error ? err.message : String(err));
} finally {
  mod.close();
  spec.close();
  await deleteRoom(roomId);
}

console.log(fails === 0 ? `\nALL PASS (${API})` : `\n${fails} FAILED (${API})`);
process.exit(fails === 0 ? 0 : 1);
