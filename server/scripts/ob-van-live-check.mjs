#!/usr/bin/env node
// OB Van live check: records ~30 s of program output while a script drives
// the desk at known times (dissolve, PiP, lower third, fade, split, dip,
// grade + virtual camera, zoom punch), then prints the recording path and
// the offsets to pull frames at. Needs the two demo clips in
// data/mp4s/ob-demo/ (speaker.mp4, wide.mp4).
//
//   OB_API=http://localhost:3111 caffeinate -i node scripts/ob-van-live-check.mjs
//   ffmpeg -ss <T> -i data/recordings/<file> -frames:v 1 frame.png
//
// The last stdout line is JSON: {"file": …, "marks": [{"label", "t"}]}.

import {
  API,
  DEMO_CAMS,
  api,
  createRoom,
  deleteRoom,
  ob,
  sleep,
} from './lib/ob-api.mjs';

const log = (...a) =>
  console.log(`[${new Date().toISOString().slice(11, 23)}]`, ...a);

async function main() {
  log('API', API);
  const { roomId } = await createRoom({ width: 1280, height: 720 });
  log('room', roomId);
  try {
    await ob.config(roomId, {
      eventName: 'Smelter Conf',
      rundown: [{ id: 'k', title: 'Keynote' }],
      transition: { type: 'cut', durationMs: 0 },
      joinUrls: {
        cam: `http://localhost:3000/ob-van/cam?room=${roomId}&server=${API}`,
      },
    });
    const cams = [];
    for (const c of DEMO_CAMS) cams.push((await ob.mp4Cam(roomId, c)).camId);
    const [c1, c2] = cams;
    await ob.sync(roomId, 60_000);
    await ob.operate(roomId, {
      op: 'shot',
      shot: { kind: 'solo', cam: c1 },
      mode: 'cut',
    });
    // Let the side-channel delay pass so both pictures are playing.
    await sleep(5000);

    await api('POST', `/room/${roomId}/record/start`, {});
    const t0 = Date.now();
    const marks = [];
    const mark = (label, offsetMs = 0) => {
      const t = (Date.now() - t0 + offsetMs) / 1000;
      marks.push({ label, t: Math.round(t * 100) / 100 });
      log(`mark ${label} @ ${t.toFixed(2)} s`);
    };
    const at = async (sec) => {
      const wait = t0 + sec * 1000 - Date.now();
      if (wait > 0) await sleep(wait);
    };
    const op = (cmd) => ob.operate(roomId, cmd);

    await at(0.8);
    mark('setup-slate');
    await at(1.2);
    await ob.control(roomId, 'go_live');
    await op({ op: 'segment', action: 'next' });
    await at(2);
    mark('solo-cam1');
    await at(3);
    await op({ op: 'preview', shot: { kind: 'solo', cam: c2 } });
    await op({
      op: 'take',
      transition: { type: 'dissolve', durationMs: 1600 },
    });
    mark('mid-dissolve', 800);
    await at(6);
    mark('solo-cam2');
    await at(7);
    await op({
      op: 'shot',
      shot: { kind: 'pip', main: c2, inset: c1, corner: 'br', size: 'M' },
      mode: 'cut',
    });
    await at(8.5);
    mark('pip');
    await at(10);
    await op({ op: 'lower_third', camId: c1, ms: 3500 });
    mark('lower-third', 1000);
    await at(14);
    await op({ op: 'shot', shot: { kind: 'solo', cam: c1 }, mode: 'preview' });
    await op({ op: 'take', transition: { type: 'fade', durationMs: 1400 } });
    mark('fade-black', 700);
    await at(17);
    await op({
      op: 'shot',
      shot: { kind: 'split', cams: [c1, c2] },
      mode: 'cut',
    });
    await op({ op: 'fx', effects: { spotlight: true } });
    await at(18.5);
    mark('split');
    await at(20);
    await op({ op: 'dip', holdMs: 1000 });
    mark('dip-black', 700);
    await at(23);
    await op({ op: 'fx', effects: { grade: 'mono', spotlight: true } });
    await op({
      op: 'shot',
      shot: { kind: 'virtual', cam: c2, target: 'speaker', zoom: 'tight' },
      mode: 'cut',
    });
    await at(25);
    mark('virtual-mono-spotlight');
    await at(26.5);
    await op({ op: 'fx', effects: { grade: 'none', spotlight: false } });
    await op({ op: 'shot', shot: { kind: 'solo', cam: c1 }, mode: 'preview' });
    await op({
      op: 'take',
      transition: { type: 'zoom-punch', durationMs: 900 },
    });
    mark('zoom-punch-start', 150);
    await at(29);
    mark('after-punch');
    await at(31);
    await ob.control(roomId, 'wrap');
    await at(32.5);
    mark('wrap-card');
    await at(33.5);
    const stopped = await api('POST', `/room/${roomId}/record/stop`, {});
    const file = `data/recordings/${stopped.fileName}`;
    log('recording', file);
    console.log(JSON.stringify({ file, marks }));
  } finally {
    await deleteRoom(roomId);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
