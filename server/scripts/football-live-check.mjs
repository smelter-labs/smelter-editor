#!/usr/bin/env node
// Live on-air check for the football game: attach dataset file cams, kick
// off, record N seconds while the director works (and the moderator switches
// views), then print what fired and where the recording landed.
//
//   FB_SIM=1 SKIP_PYTHON=1 pnpm start                                # terminal 1
//   node scripts/football-live-check.mjs                             # panorama demo window
//   FB_CLIPS=left:fb-demo/tricam-3min/cam0.mp4,centre:fb-demo/tricam-3min/cam1.mp4,right:fb-demo/tricam-3min/cam2.mp4 \
//     node scripts/football-live-check.mjs                           # three cameras
//   FB_API=http://localhost:3111 FB_SECONDS=60 node scripts/football-live-check.mjs
//   FB_STAY=1 FB_MINIMAP_SIZE_AT=15:3,25:5 node scripts/football-live-check.mjs
//     # follow only (no view switches / manual goal) + minimap resizes at 15 s and 25 s
//
// Then look at frames: ffmpeg -ss T -i data/recordings/<file> -frames:v 1 out.png

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

const CLIPS = (process.env.FB_CLIPS ?? 'pano:fb-demo/pano-3x40s/pano.mp4')
  .split(',')
  .map((s) => {
    const [role, fileName] = s.split(':');
    return { role: role.trim(), fileName: fileName.trim() };
  });
const SECONDS = Number(process.env.FB_SECONDS ?? 45);
const PLAY_FROM_MS = Number(process.env.FB_PLAY_FROM_MS ?? 0);
const isPano = CLIPS.some((c) => c.role === 'pano');
const STAY = process.env.FB_STAY === '1';
const MINIMAP_SIZE_AT = (process.env.FB_MINIMAP_SIZE_AT ?? '')
  .split(',')
  .filter(Boolean)
  .map((s) => s.split(':').map(Number));

const t0 = Date.now();
const log = (...a) =>
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const created = await createRoom({ width: 1280, height: 720 });
const roomId = created.roomId;
log('room', roomId, API);

let state = null;
const events = [];
const cuts = [];
let lastCam = null;
const sock = await openSocket(roomId, (ev) => {
  if (ev.type === 'fb_state') {
    state = ev;
    const cam = ev.director?.cam ?? ev.director?.effectiveView;
    if (cam !== lastCam) {
      lastCam = cam;
      cuts.push({ at: Date.now() - t0, cam });
    }
  } else if (ev.type === 'fb_event') {
    events.push(ev);
    log('EVENT', ev.kind, fmtEvent(ev.event));
  } else if (ev.type === 'fb_ai_log') {
    for (const e of ev.entries) log('  ai-log', e.label, e.text);
  } else if (ev.type === 'fb_director') {
    log(
      '  director',
      ev.director.effectiveView,
      ev.director.cam ?? '',
      ev.director.crop ? JSON.stringify(ev.director.crop) : '',
      'ball',
      ev.director.ballTracked,
    );
  } else if (ev.type === 'fb_error') log('ERROR', ev.code, ev.message);
});
sock.send({ type: 'fb_spectate' });
sock.send({ type: 'fb_commentator_join', name: 'Check' });

try {
  await api('POST', `/room/${roomId}/football-game/config`, {
    halfMs: 5 * 60_000,
    replayDelayMs: 1000,
    perf: { hudPublishHz: 5 },
  });
  for (const c of CLIPS) {
    const att = await api('POST', `/room/${roomId}/football-game/mp4-cam`, {
      role: c.role,
      fileName: c.fileName,
    });
    log('attached', c.role, c.fileName, att.inputId);
  }
  await api('POST', `/room/${roomId}/football-game/mp4-cam/sync`, {
    playFromMs: PLAY_FROM_MS,
  });
  await waitFor(
    () => CLIPS.every((c) => state?.cams?.[c.role]?.connected) && state,
    { label: 'cams connected', timeoutMs: 60_000 },
  );
  await waitFor(
    () =>
      state?.aiEvents === 'armed' ||
      state?.aiEvents === 'no_events' ||
      state?.aiEvents === 'off',
    { label: 'AI EVENTS', timeoutMs: 30_000 },
  );
  const driving = CLIPS[0].role;
  log(
    'session',
    state.session,
    'telemetry',
    JSON.stringify(state.cams[driving].telemetry),
    'aiEvents',
    state.aiEvents,
    JSON.stringify(state.aiRun),
  );

  const rec = await api('POST', `/room/${roomId}/record/start`, {});
  log('recording', JSON.stringify(rec));
  const started = await api('POST', `/room/${roomId}/football-game/match`, {
    action: 'start',
  });
  log(
    'match',
    started.status,
    started.error ?? '',
    'clockFromClip',
    started.match?.clockFromClip,
    'elapsed',
    started.match?.elapsedMs,
  );

  const plan = STAY
    ? []
    : isPano
      ? [
          [Math.round(SECONDS * 0.4), { mode: 'view', view: 'wide' }],
          [Math.round(SECONDS * 0.55), { mode: 'view', view: 'left-goal' }],
          [Math.round(SECONDS * 0.7), { mode: 'auto' }],
        ]
      : [
          [Math.round(SECONDS * 0.6), { mode: 'view', view: 'right' }],
          [Math.round(SECONDS * 0.75), { mode: 'auto' }],
        ];
  for (let s = 1; s <= SECONDS; s++) {
    await sleep(1000);
    const p = plan.find(([at]) => at === s);
    if (p) {
      log('VIEW →', JSON.stringify(p[1]));
      sock.send({ type: 'fb_commentator_view', override: p[1] });
    }
    const size = MINIMAP_SIZE_AT.find(([at]) => at === s);
    if (size) {
      log('MINIMAP SIZE →', size[1]);
      sock.send({ type: 'fb_commentator_minimap_size', size: size[1] });
    }
    if (!STAY && s === Math.round(SECONDS * 0.85)) {
      log('manual goal A');
      sock.send({ type: 'fb_event_add', team: 'A', kind: 'goal' });
    }
  }
  const stopped = await api('POST', `/room/${roomId}/record/stop`, {});
  log('stopped', JSON.stringify(stopped));
  const st = await getState(roomId);
  log(
    'final scores',
    JSON.stringify(st.match.scores),
    'elapsed',
    st.match.elapsedMs,
    'events',
    events.length,
  );
  for (const e of st.state.recent) console.log(fmtEvent(e));
  console.log(
    'CUTS',
    cuts.map((c) => `${(c.at / 1000).toFixed(1)}s:${c.cam}`).join('  '),
  );
  console.log(
    'RECORDING',
    stopped.fileName ?? stopped.file ?? JSON.stringify(stopped),
  );
} catch (err) {
  console.error('CHECK FAILED', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  sock.close();
  await deleteRoom(roomId);
}
process.exit(process.exitCode ?? 0);
