#!/usr/bin/env node
// OB Van end-to-end over REST + the room WebSocket against a running server
// started with OB_SIM=1 (simulate-signal). Two file cams from
// data/mp4s/ob-demo/ (copy them in first: speaker.mp4, wide.mp4).
//
//   OB_API=http://localhost:3111 node scripts/ob-van-e2e.mjs
//
// create → config → 2× mp4-cam → spectate + phone join over WS → preview /
// take / cut / shot / lower third / title bug → auto pilot on simulated
// speech (ob_log source 'auto' with reasons) → operator cut pauses auto →
// replay → record 10 s → refusals (400/404/409/422) → delete.

import {
  API,
  DEMO_CAMS,
  api,
  call,
  check,
  createRoom,
  deleteRoom,
  failureCount,
  ob,
  openSocket,
  sleep,
  speech,
  waitFor,
} from './lib/ob-api.mjs';

const log = (...a) =>
  console.log(`[${new Date().toISOString().slice(11, 23)}]`, ...a);

async function main() {
  log('API', API);
  const { roomId } = await createRoom();
  log('room', roomId);
  const events = [];
  const phoneEvents = [];
  let sock;
  let phone;
  try {
    sock = await openSocket(roomId, (e) => events.push(e));
    sock.send({ type: 'ob_spectate' });

    console.log('config');
    const { config } = await ob.config(roomId, {
      eventName: 'Smelter Conf',
      presetId: 'talk',
      resumeAfterMs: 6000,
      rundown: [
        { id: 'k', title: 'Keynote' },
        { id: 'q', title: 'Q&A' },
      ],
      joinUrls: {
        cam: `http://localhost:3000/ob-van/cam?room=${roomId}&server=${API}`,
      },
    });
    check(config.eventName === 'Smelter Conf', 'config applied');

    console.log('file cams');
    const cams = [];
    for (const c of DEMO_CAMS) {
      const r = await ob.mp4Cam(roomId, c);
      cams.push(r.camId);
      log('attached', c.fileName, JSON.stringify(r));
    }
    await ob.sync(roomId, 30_000);
    let s = await ob.state(roomId);
    check(
      s.cams.length === 2 && s.cams.every((c) => c.live),
      'two live file cams',
      JSON.stringify(s.cams),
    );
    check(s.cams.map((c) => c.number).join() === '1,2', 'bus numbers 1,2');
    check(
      events.some((e) => e.type === 'ob_state'),
      'ob_state over WS',
    );

    console.log('phone over WS');
    phone = await openSocket(roomId, (e) => phoneEvents.push(e));
    phone.send({
      type: 'ob_cam_join',
      name: 'Phone',
      role: 'audience',
      talent: null,
    });
    const joined = await waitFor(
      () => phoneEvents.find((e) => e.type === 'ob_cam_joined'),
      {
        label: 'ob_cam_joined',
      },
    );
    check(joined.number === 3, 'phone seat = CAM 3', JSON.stringify(joined));

    console.log('desk');
    const [c1, c2] = cams;
    await ob.operate(roomId, {
      op: 'shot',
      shot: { kind: 'solo', cam: c1 },
      mode: 'cut',
    });
    await ob.operate(roomId, {
      op: 'preview',
      shot: { kind: 'solo', cam: c2 },
    });
    s = await ob.state(roomId);
    check(
      s.program.shot?.cam === c1 && s.preview?.cam === c2,
      'program CAM 1, preview CAM 2',
    );
    check(
      s.cams[0].tally === 'program' && s.cams[1].tally === 'preview',
      'tally program / preview',
    );
    await ob.operate(roomId, {
      op: 'take',
      transition: { type: 'dissolve', durationMs: 600 },
    });
    s = await ob.state(roomId);
    check(
      s.program.transition?.type === 'dissolve',
      'take → dissolve in flight',
    );
    await sleep(800);
    s = await ob.state(roomId);
    check(
      s.program.shot?.cam === c2 && s.program.transition === null,
      'dissolve settled on CAM 2',
    );
    check(s.preview?.cam === c1, 'take swapped preview');
    await ob.operate(roomId, { op: 'cut' });
    s = await ob.state(roomId);
    check(s.program.shot?.cam === c1, 'cut back to CAM 1');
    await ob.operate(roomId, {
      op: 'shot',
      shot: { kind: 'pip', main: c1, inset: c2, corner: 'br', size: 'M' },
      mode: 'take',
    });
    await ob.operate(roomId, {
      op: 'fx',
      effects: { grade: 'warm', spotlight: true },
    });
    await ob.control(roomId, 'go_live');
    await ob.operate(roomId, { op: 'lower_third', camId: c1, ms: 4000 });
    await ob.operate(roomId, { op: 'segment', action: 'next' });
    s = await ob.state(roomId);
    check(s.phase === 'on-air', 'on air');
    check(s.lowerThird?.name === DEMO_CAMS[0].talent, 'lower third = talent');
    check(s.titleBug.segment === 'Keynote', 'title bug segment from rundown');
    check(s.effects.grade === 'warm', 'grade warm');

    console.log('auto pilot on simulated speech');
    await ob.operate(roomId, {
      op: 'shot',
      shot: { kind: 'solo', cam: c1 },
      mode: 'cut',
    });
    await ob.operate(roomId, { op: 'auto', enabled: true });
    // The operator cut paused the pilot for resumeAfterMs (6 s).
    s = await ob.state(roomId);
    check(
      s.autoPilot.on && s.autoPilot.pausedUntilMs == null,
      'auto on (re-enabling clears the pause)',
    );
    const t0 = Date.now();
    let autoEntry = null;
    while (Date.now() - t0 < 20_000 && !autoEntry) {
      await ob.simulate(roomId, c2, speech(true));
      await ob.simulate(roomId, c1, speech(false));
      await sleep(100);
      autoEntry = events
        .flatMap((e) => (e.type === 'ob_log' ? e.entries : []))
        .find(
          (e) =>
            e.source === 'auto' && (e.kind === 'auto' || e.kind === 'take'),
        );
    }
    check(
      !!autoEntry,
      'ob_log entry with source auto',
      autoEntry ? '' : 'none within 20 s',
    );
    if (autoEntry)
      log('auto:', autoEntry.text, JSON.stringify(autoEntry.reasons ?? []));
    check((autoEntry?.reasons ?? []).length > 0, 'auto cut carries reasons');
    s = await ob.state(roomId);
    log(
      'program after auto:',
      JSON.stringify(s.program.shot),
      'source',
      s.program.source,
    );
    check(s.program.source === 'auto', 'program source auto');

    console.log('operator cut pauses auto');
    await ob.operate(roomId, {
      op: 'shot',
      shot: { kind: 'solo', cam: c1 },
      mode: 'cut',
    });
    s = await ob.state(roomId);
    check(
      s.autoPilot.pausedUntilMs != null &&
        s.autoPilot.pausedUntilMs > Date.now(),
      'auto paused',
    );
    await ob.operate(roomId, { op: 'auto', enabled: false });

    console.log('replay');
    const rp = await ob.tryOperate(roomId, { op: 'replay', camId: c1 });
    check(rp.status === 200, 'replay accepted', JSON.stringify(rp.body));
    const replayOn = await waitFor(
      async () => (await ob.state(roomId)).replay,
      { timeoutMs: 15_000, label: 'replay' },
    ).catch(() => null);
    check(!!replayOn, 'replay window up');
    const busy = await ob.tryOperate(roomId, { op: 'replay', camId: c1 });
    check(
      busy.status === 409 && busy.body.code === 'replay_busy',
      'second replay → 409 replay_busy',
    );

    console.log('record 10 s');
    const rec = await api('POST', `/room/${roomId}/record/start`, {});
    await sleep(10_000);
    const stopped = await api('POST', `/room/${roomId}/record/stop`, {});
    log('recording', stopped.fileName);
    check(!!stopped.fileName, 'recording file', JSON.stringify(rec));

    console.log('refusals');
    const r1 = await ob.tryOperate(roomId, {
      op: 'preview',
      shot: { kind: 'solo', cam: 'nope' },
    });
    check(
      r1.status === 404 && r1.body.code === 'unknown_cam',
      'unknown cam → 404',
      JSON.stringify(r1),
    );
    const r2 = await ob.tryOperate(roomId, {
      op: 'shot',
      shot: { kind: 'split', cams: [c1, c1] },
      mode: 'cut',
    });
    check(
      r2.status === 400 && r2.body.code === 'invalid_shot',
      'split of one cam → 400 invalid_shot',
    );
    const r3 = await ob.tryOperate(roomId, { op: 'bogus' });
    check(r3.status === 400, 'unknown op → 400 (schema)');
    const phoneCam = (await ob.state(roomId)).cams.find(
      (c) => c.kind === 'whip',
    );
    const r4 = await ob.tryOperate(roomId, {
      op: 'shot',
      shot: { kind: 'solo', cam: phoneCam.id },
      mode: 'cut',
    });
    check(
      r4.status === 400 && r4.body.code === 'cam_not_live',
      'phone without stream → cam_not_live',
    );
    const r5 = await call('POST', `/room/${roomId}/ob-van/ruleset`, {
      ruleset: { rules: [{ nope: 1 }] },
    });
    check(
      r5.status === 422 && r5.body.code === 'invalid_ruleset',
      'bad ruleset → 422',
    );
    const r6 = await call('POST', `/room/${roomId}/ob-van/ruleset`, {
      ruleset: { name: 'Mine', rules: [] },
    });
    check(
      r6.status === 200 && r6.body.ruleset?.name === 'Mine',
      'ruleset applied',
      JSON.stringify(r6.body).slice(0, 200),
    );
    const r7 = await call('POST', `/room/${roomId}/ob-van/control`, {
      action: 'go_live',
    });
    check(r7.status === 200, 'go_live while on air is a no-op');
    sock.send({ type: 'ob_operator_cmd', cmd: { op: 'take' } });
    await sleep(300);
    const r8 = await call('GET', `/room/${roomId}/ob-van/llm/status`);
    check(
      r8.status === 200 && typeof r8.body.status?.available === 'boolean',
      'llm status route',
    );

    console.log('wrap');
    await ob.control(roomId, 'wrap');
    s = await ob.state(roomId);
    check(
      s.phase === 'wrap' && s.stats.cuts > 0,
      `wrap stats · ${s.stats.cuts} cuts`,
      JSON.stringify(s.stats),
    );
    const r9 = await call('POST', `/room/${roomId}/ob-van/control`, {
      action: 'go_live',
    });
    check(
      r9.status === 409 && r9.body.code === 'bad_phase',
      'go_live after wrap → 409 bad_phase',
    );
    const rooms = await api('GET', '/rooms');
    const me = (rooms.rooms ?? []).find((r) => r.roomId === roomId);
    check(
      me?.activeGame === 'ob-van',
      'room list says ob-van',
      JSON.stringify(me ?? null).slice(0, 200),
    );
  } finally {
    sock?.close();
    phone?.close();
    await deleteRoom(roomId);
  }
  const f = failureCount();
  console.log(f ? `\n${f} check(s) FAILED` : '\nall checks passed');
  process.exit(f ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
