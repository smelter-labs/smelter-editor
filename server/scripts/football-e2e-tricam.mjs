#!/usr/bin/env node
// End-to-end smoke for the THREE-CAMERA session of the football game and the
// operator contracts around it (football-e2e.mjs covers the panorama flow).
//
//   FB_SIM=1 SKIP_PYTHON=1 pnpm start                          # terminal 1
//   node scripts/football-e2e-tricam.mjs                        # terminal 2
//   FB_API=http://localhost:3111 node scripts/football-e2e-tricam.mjs
//   FB_E2E_DIR=fb-demo/tricam-3min FB_E2E_PANO=fb-demo/pano-3x40s/pano.mp4 …
//
// Flow: clip library names each clip's rig → a clip is refused in the slot of
// the other rig → three file cams + sync → session `tricam` → KICK-OFF → the
// HOST steers the view / minimap over REST (no moderator seat) → a pause and a
// kick of ANOTHER camera keep the manual view, a kick of ITS camera drops it →
// the moderator seat cannot be taken (role_taken), the host frees it → the
// clock blows HALF TIME by itself with `autoFlow`.

import {
  API,
  api,
  createRoom,
  deleteRoom,
  openSocket,
  waitFor,
} from './lib/fb-api.mjs';

const DIR = process.env.FB_E2E_DIR ?? 'fb-demo/tricam-3min';
const PANO = process.env.FB_E2E_PANO ?? 'fb-demo/pano-3x40s/pano.mp4';
const CLIPS = {
  left: `${DIR}/cam0.mp4`,
  centre: `${DIR}/cam1.mp4`,
  right: `${DIR}/cam2.mp4`,
};

let fails = 0;
function check(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!ok) fails++;
}
const t0 = Date.now();
const log = (...a) =>
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
/** The refusal message of a call that must fail (null when it went through). */
const refusal = (p) =>
  p.then(
    () => null,
    (err) => (err instanceof Error ? err.message : String(err)),
  );

const { roomId } = await createRoom();
check('room created', !!roomId, roomId);
const base = `/room/${roomId}/football-game`;

function client(label) {
  const c = { label, state: null, match: null, errors: [], joined: null };
  c.open = async () => {
    c.sock = await openSocket(roomId, (ev) => {
      if (ev.type === 'fb_state') c.state = ev;
      else if (ev.type === 'fb_match') c.match = ev;
      else if (ev.type === 'fb_commentator_joined') c.joined = ev;
      else if (ev.type === 'fb_error') {
        c.errors.push(ev);
        log(`${label} ERROR`, ev.code, ev.message);
      }
    });
    c.sock.send({ type: 'fb_spectate' });
    return c;
  };
  c.send = (obj) => c.sock.send(obj);
  c.close = () => c.sock?.close();
  return c;
}

const mod = await client('mod').open();
const intruder = await client('intruder').open();

try {
  // ── clip library ──
  const lib = await api('GET', '/football-game/clips');
  const rig = (f) => lib.clips.find((c) => c.fileName === f)?.session;
  check(
    'clip library names the rigs',
    rig(CLIPS.centre) === 'tricam' && rig(PANO) === 'pano',
    `${CLIPS.centre}=${rig(CLIPS.centre)} ${PANO}=${rig(PANO)}`,
  );

  // ── the wrong rig is refused ──
  const asPano = await refusal(
    api('POST', `${base}/mp4-cam`, { role: 'pano', fileName: CLIPS.centre }),
  );
  check(
    'a camera clip is refused as PANORAMA',
    /three-camera/.test(asPano ?? ''),
  );
  const asCam = await refusal(
    api('POST', `${base}/mp4-cam`, { role: 'left', fileName: PANO }),
  );
  check('a panorama clip is refused as a camera', /panorama/.test(asCam ?? ''));
  check(
    'a refused clip leaves no camera behind',
    (await api('GET', `${base}/state`)).state.session == null,
  );

  // ── three cameras ──
  await api('POST', `${base}/config`, {
    halfMs: 60_000,
    clockFromClip: false,
    autoFlow: true,
    ai: { events: true },
  });
  for (const [role, fileName] of Object.entries(CLIPS)) {
    const r = await api('POST', `${base}/mp4-cam`, { role, fileName });
    check(`${role} cam attached`, !!r.inputId);
  }
  const synced = await api('POST', `${base}/mp4-cam/sync`, { playFromMs: 0 });
  check('three clips restarted together', synced.inputIds?.length === 3);
  await waitFor(
    () =>
      ['left', 'centre', 'right'].every((r) => mod.state?.cams?.[r]?.connected),
    { label: 'three cams connected', timeoutMs: 60_000 },
  );
  check('session is tricam', mod.state.session === 'tricam');

  // ── moderator seat ──
  mod.send({ type: 'fb_commentator_join', name: 'E2E MOD' });
  await waitFor(() => mod.joined, { label: 'moderator joined' });
  intruder.send({ type: 'fb_commentator_join', name: 'EVE' });
  await waitFor(() => intruder.errors.length > 0, { label: 'role_taken' });
  check(
    'a connected moderator keeps the seat',
    intruder.errors[0].code === 'role_taken' &&
      mod.state.commentator?.name === 'E2E MOD',
  );

  // ── kick-off, host steers without a seat ──
  const start = await api('POST', `${base}/match`, { action: 'start' });
  check('kick-off', start.match.phase === 'live');
  const kickOffAt = Date.now();
  await waitFor(() => mod.state?.director?.effectiveView, {
    label: 'director',
  });
  log('director opens on', mod.state.director.effectiveView);
  check(
    'AUTO picks one of the cameras',
    ['left', 'centre', 'right'].includes(mod.state.director.effectiveView),
  );

  const toRight = await api('POST', `${base}/view`, {
    override: { mode: 'view', view: 'right' },
  });
  check(
    'host REST view → RIGHT CAM',
    toRight.state.director.view === 'right' &&
      toRight.state.director.effectiveView === 'right',
  );
  const panoView = await refusal(
    api('POST', `${base}/view`, { override: { mode: 'view', view: 'wide' } }),
  );
  check('a panorama view is refused on three cameras', !!panoView);
  const mini = await api('POST', `${base}/minimap`, { enabled: false });
  check('host REST minimap off', mini.state.minimap === false);

  // ── what keeps / drops the manual view ──
  await api('POST', `${base}/match`, { action: 'pause' });
  const resumed = await api('POST', `${base}/match`, { action: 'resume' });
  check(
    'pause / resume keep the manual view',
    resumed.state.director.view === 'right',
  );
  const kickLeft = await api('POST', `${base}/match`, {
    action: 'kick_cam',
    role: 'left',
  });
  check(
    'kicking another camera keeps the manual view',
    kickLeft.state.director.view === 'right' &&
      !kickLeft.state.cams.left.fileName,
  );
  const kickRight = await api('POST', `${base}/match`, {
    action: 'kick_cam',
    role: 'right',
  });
  check(
    'kicking the viewed camera returns to AUTO',
    kickRight.state.director.view === 'auto',
  );

  // ── host frees the seat ──
  const freed = await api('POST', `${base}/match`, {
    action: 'kick_commentator',
  });
  check('host frees the moderator seat', freed.state.commentator == null);
  intruder.send({ type: 'fb_commentator_join', name: 'EVE' });
  await waitFor(() => intruder.joined, { label: 'new moderator' });
  check('the freed seat can be taken', intruder.joined?.name === 'EVE');

  // ── autoFlow: the 1-minute half ends by itself ──
  log('waiting for the clock to blow HALF TIME…');
  await waitFor(() => mod.match?.phase === 'halftime', {
    label: 'auto half time',
    timeoutMs: 75_000,
  });
  const ranS = (Date.now() - kickOffAt) / 1000;
  // The pause above does not count: anything from 60 s up is right.
  check(
    'autoFlow blew HALF TIME',
    ranS >= 59 && ranS < 75,
    `${ranS.toFixed(1)} s`,
  );

  check(`e2e took ${Math.round((Date.now() - t0) / 1000)} s`, true);
} catch (err) {
  check('e2e threw', false, err instanceof Error ? err.message : String(err));
} finally {
  mod.close();
  intruder.close();
  await deleteRoom(roomId);
}

console.log(fails === 0 ? `\nALL PASS (${API})` : `\n${fails} FAILED (${API})`);
process.exit(fails === 0 ? 0 : 1);
