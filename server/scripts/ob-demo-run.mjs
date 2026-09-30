#!/usr/bin/env node
// OB Van demo — one command from prepped clips to a directed show, for
// repeatable screen-capture sessions. Reads data/mp4s/<dir>/cams.json (written
// by ob-prep-takes.mjs; edit roles / talent / brief there) and, when present,
// timing.json from the conductor (rundown segments at their show times).
//
//   OB_API=http://localhost:3121 node scripts/ob-demo-run.mjs --dir ob-demo/panel
//       set the room up and leave it for the editor host (GO LIVE / AUTO yourself)
//   … --live [--record] [--run-s 150] [--check]
//       go live, auto pilot on, rundown segments on time, log every decision
//       next to the script line on air; Ctrl-C stops (and deletes the room
//       unless --keep). --check asserts the TALK beats (lower thirds, slides,
//       split, wide) after one pass of the clip.
//
// cams.json:
//   { "eventName", "presetId", "captions", "audio": {"mode":"mix"} | {"mode":"master","cam":"<role|file>"},
//     "brief", "firstShot": "<role|file>", "ruleOverrides": {"<rule id>": {…fields}},
//     "config": {…any ObConfigPatch}, "resumeAfterMs": 20000,
//     "rundown": [{id,title,atS?}] (else timing.json),
//     "checks": {"soloRoles": ["tape"]} (extra --check beats: a solo cut to that role),
//     "cams": [{"file","role","name","talent","subtitle","optional"}] }
//
// Captions on = 8 s side-channel delay: decisions land 8 s after the worker
// hears the line; the show clock printed here is the on-air media time.
// The last stdout line is JSON: {roomId, recording, decisions}.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  API,
  api,
  call,
  check,
  createRoom,
  deleteRoom,
  failureCount,
  ob,
  openSocket,
  sleep,
  waitFor,
} from './lib/ob-api.mjs';
import { MP4_DIR, fmtTime } from './lib/ob-media.mjs';

const { values: opt } = parseArgs({
  options: {
    dir: { type: 'string', default: 'ob-demo/panel' },
    live: { type: 'boolean', default: false },
    record: { type: 'boolean', default: false },
    'run-s': { type: 'string' },
    keep: { type: 'boolean', default: false },
    check: { type: 'boolean', default: false },
    'no-captions': { type: 'boolean', default: false },
    editor: {
      type: 'string',
      default: process.env.OB_EDITOR ?? 'http://localhost:3000',
    },
    'signals-timeout-s': { type: 'string', default: '150' },
  },
});

const log = (...a) =>
  console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

function fail(msg) {
  console.error(`ob-demo-run: ${msg}`);
  process.exit(1);
}

function loadManifest() {
  const dir = opt.dir.replace(/^\/+|\/+$/g, '');
  const abs = path.join(MP4_DIR, dir);
  const camsPath = path.join(abs, 'cams.json');
  if (!existsSync(camsPath))
    fail(`no ${camsPath} — run ob-prep-takes.mjs first (it writes a template)`);
  const m = JSON.parse(readFileSync(camsPath, 'utf8'));
  const timingPath = path.join(abs, 'timing.json');
  const timing = existsSync(timingPath)
    ? JSON.parse(readFileSync(timingPath, 'utf8'))
    : null;
  const cams = [];
  for (const c of m.cams ?? []) {
    const onDisk = path.join(abs, c.file);
    if (!existsSync(onDisk)) {
      if (c.optional) {
        console.warn(`skipping optional ${c.role} cam: ${c.file} not found`);
        continue;
      }
      fail(`${onDisk} not found`);
    }
    cams.push({ ...c, fileName: `${dir}/${c.file}` });
  }
  if (!cams.length) fail('cams.json lists no cameras');
  const rundown = (m.rundown ?? timing?.rundown ?? []).map((r, i) => ({
    id: String(r.id ?? `seg-${i + 1}`).slice(0, 40),
    title: String(r.title ?? '').slice(0, 60),
    atS: typeof r.atS === 'number' ? r.atS : null,
  }));
  return { m, timing, cams, rundown };
}

/** A cams.json reference (role, file or name) → camId. */
function resolveCam(ref, cams) {
  if (!ref) return null;
  const hit =
    cams.find((c) => c.role === ref) ??
    cams.find((c) => c.file === ref || c.fileName === ref) ??
    cams.find((c) => c.name?.toLowerCase() === String(ref).toLowerCase());
  return hit?.camId ?? null;
}

/** The script line on air at show time `t` (timing.json events). */
function lineAt(timing, t) {
  if (!timing) return null;
  let cur = null;
  for (const e of timing.events)
    if (
      (e.kind === 'line' || e.kind === 'all') &&
      e.startS <= t &&
      t < (e.endS ?? e.startS)
    )
      cur = e;
  return cur;
}

async function main() {
  const { m, timing, cams, rundown } = loadManifest();
  log('API', API, '·', cams.length, 'cams from', opt.dir);
  const { roomId } = await createRoom({ width: 1920, height: 1080 });
  log('room', roomId);

  let sock = null;
  let recording = false;
  let stopping = false;
  const decisions = [];
  let t0 = 0;
  let loopMs = 0;
  const showNow = () => {
    if (!t0) return 0;
    const ms = Date.now() - t0;
    return (ms >= 0 && loopMs ? ms % loopMs : ms) / 1000;
  };

  const finish = async (code) => {
    if (stopping) return;
    stopping = true;
    let file = null;
    try {
      if (recording) {
        const stop = await api('POST', `/room/${roomId}/record/stop`, {});
        file = stop?.fileName ?? stop?.file ?? null;
        log('recording saved', file);
      }
    } catch (err) {
      console.warn('record/stop failed', err.message);
    }
    sock?.close();
    if (!opt.keep && opt.live) await deleteRoom(roomId);
    console.log(JSON.stringify({ roomId, recording: file, decisions }));
    process.exit(code || (failureCount() ? 1 : 0));
  };
  process.on('SIGINT', () => void finish(0));

  try {
    const captions = opt['no-captions'] ? false : (m.captions ?? true);
    await ob.config(roomId, {
      eventName: m.eventName ?? timing?.title ?? 'OB VAN DEMO',
      presetId: m.presetId ?? 'talk',
      captions,
      brief: m.brief ?? '',
      rundown: rundown.map(({ id, title }) => ({ id, title })),
      autoPilot: false,
      resumeAfterMs: 0,
      titleBugVisible: true,
      ...(m.audio?.mode === 'mix' || m.audio?.mode === 'follow'
        ? { audio: { mode: m.audio.mode } }
        : {}),
      ...(m.config ?? {}),
    });

    const overrides = Object.entries(m.ruleOverrides ?? {});
    if (overrides.length) {
      const { ruleset } = await ob.state(roomId);
      for (const [id, patch] of overrides) {
        const rule = ruleset.rules.find((r) => r.id === id);
        if (rule) Object.assign(rule, patch);
        else console.warn(`ruleOverrides: no rule "${id}" in ${ruleset.name}`);
      }
      const r = await call('POST', `/room/${roomId}/ob-van/ruleset`, {
        ruleset,
      });
      if (r.status >= 300) fail(`ruleset rejected: ${JSON.stringify(r.body)}`);
      log(
        'rules',
        overrides.map(([id, p]) => `${id} ${JSON.stringify(p)}`).join(' · '),
      );
    }

    for (const c of cams) {
      const r = await ob.mp4Cam(roomId, {
        role: c.role,
        fileName: c.fileName,
        name: c.name,
        talent: c.talent ?? null,
        subtitle: c.subtitle ?? null,
      });
      c.camId = r.camId;
    }
    let state = await ob.state(roomId);
    for (const c of cams)
      c.number = state.cams.find((s) => s.id === c.camId)?.number;
    log(
      'cams',
      cams
        .map((c) => `${c.number}:${c.role}${c.talent ? ` (${c.talent})` : ''}`)
        .join('  '),
    );

    if (m.audio?.mode === 'master') {
      const camId = resolveCam(m.audio.cam, cams);
      if (!camId)
        fail(`audio master cam "${m.audio.cam}" is not one of the cams`);
      await ob.config(roomId, { audio: { mode: 'master', cam: camId } });
    }

    const firstCam =
      resolveCam(m.firstShot, cams) ??
      resolveCam('wide', cams) ??
      resolveCam('slides', cams) ??
      cams[0].camId;
    const hostUrl = `${opt.editor}/ob-van/${roomId}`;
    const panelUrl = `${opt.editor}/ob-van/panel/${roomId}?server=${encodeURIComponent(API)}`;

    if (!opt.live) {
      await ob.sync(roomId, 0);
      await ob.config(roomId, { resumeAfterMs: m.resumeAfterMs ?? 20000 });
      log(
        'ready. Open the host, GO LIVE, then RESTART CLIPS 0:00 (the show airs from the top',
      );
      log('after the side-channel delay) and AUTO (A):');
      console.log(
        `  host   ${hostUrl}   (editor needs SMELTER_EDITOR_SERVER_URL=${API})`,
      );
      console.log(`  panel  ${panelUrl}`);
      console.log(
        JSON.stringify({
          roomId,
          hostUrl,
          panelUrl,
          cams: cams.map(({ number, role, camId, fileName }) => ({
            number,
            role,
            camId,
            fileName,
          })),
        }),
      );
      return;
    }

    let signals = {};
    const seen = new Set();
    sock = await openSocket(roomId, (ev) => {
      if (ev.type === 'ob_signals') signals = ev.signals;
      if (ev.type !== 'ob_log') return;
      for (const e of ev.entries) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        if (!t0 || e.source === 'operator') continue;
        const t = showNow();
        const line = lineAt(timing, t + 0.3);
        decisions.push({
          t: Number(t.toFixed(1)),
          source: e.source,
          kind: e.kind,
          label: e.label,
          text: e.text,
          reasons: e.reasons ?? [],
        });
        log(
          `${fmtTime(t)}  [${e.source}] ${e.label} ${e.text}`,
          e.reasons?.length
            ? `\n              why: ${e.reasons.join(' | ')}`
            : '',
          line
            ? `\n              on air: ${line.who} "${line.text.slice(0, 70)}"`
            : '',
        );
      }
    });
    sock.send({ type: 'ob_spectate' });

    // Roles the worker never analyses produce no signals — don't wait on them.
    const analysed = cams.filter(
      (c) => c.role !== 'slides' && c.role !== 'tape',
    );
    log(
      `waiting for the signal worker on ${analysed.length} cams${captions ? ' (captions warm-up is slow)' : ''}…`,
    );
    await waitFor(
      () => analysed.every((c) => signals[c.camId] && !signals[c.camId].stale),
      {
        timeoutMs: Number(opt['signals-timeout-s']) * 1000,
        label: 'signals from every analysed cam',
        pollMs: 500,
      },
    );

    await ob.control(roomId, 'go_live');
    await ob.operate(roomId, {
      op: 'shot',
      shot: { kind: 'solo', cam: firstCam },
      mode: 'cut',
    });
    state = await ob.state(roomId);
    const delayMs = Math.max(
      0,
      ...state.cams.filter((c) => c.kind === 'file').map((c) => c.delayMs ?? 0),
    );
    // The first segment is on before the clips air: rules look a side-channel
    // delay ahead, so the opening lines already count as its content.
    if (rundown.length)
      await ob.tryOperate(roomId, { op: 'segment', action: 'goto', index: 0 });
    const syncAt = Date.now();
    const synced = await ob.sync(roomId, 0);
    // The clips air from media 0 once the side-channel delay has passed.
    t0 = synced.mediaZeroAirMs ?? syncAt + delayMs + 500;
    loopMs = timing?.durationS ? timing.durationS * 1000 : 0;
    await ob.config(roomId, {
      autoPilot: true,
      resumeAfterMs: m.resumeAfterMs ?? 20000,
    });
    log(
      `auto pilot on · clips restarted · the show airs in ${((t0 - Date.now()) / 1000).toFixed(1)} s (side-channel delay ${delayMs} ms)`,
    );
    console.log(`  host   ${hostUrl}\n  panel  ${panelUrl}`);
    await sleep(Math.max(0, t0 - Date.now()));
    if (opt.record) {
      await api('POST', `/room/${roomId}/record/start`, {});
      recording = true;
    }
    log(
      `ON AIR${loopMs ? ` · the clips loop every ${fmtTime(loopMs / 1000)}` : ''}${opt.record ? ' · recording' : ''}`,
    );

    const runS = opt['run-s']
      ? Number(opt['run-s'])
      : opt.check && loopMs
        ? loopMs / 1000 - 1
        : Infinity;
    let segIndex = rundown.length ? 0 : -1;
    while (!stopping && (Date.now() - t0) / 1000 < runS) {
      const t = showNow();
      let want = 0;
      rundown.forEach((r, i) => {
        if (r.atS != null && r.atS <= t) want = i;
      });
      if (rundown.length && want !== segIndex) {
        segIndex = want;
        await ob.tryOperate(roomId, {
          op: 'segment',
          action: 'goto',
          index: want,
        });
      }
      await sleep(250);
    }

    if (opt.check) {
      state = await ob.state(roomId);
      const auto = decisions.filter((d) => d.source === 'auto');
      const cams1 = state.cams;
      const wide = cams1.find((c) => c.role === 'wide');
      check(
        auto.some((d) => d.kind === 'lower_third'),
        `lower thirds on new voices (${auto.filter((d) => d.kind === 'lower_third').length})`,
      );
      if (cams1.some((c) => c.role === 'slides'))
        check(
          auto.some((d) => /^SLIDES ·/.test(d.text)),
          'speaker + slides on the keyword',
        );
      check(
        auto.some((d) => /^SPLIT ·/.test(d.text)),
        'split on the back-and-forth',
      );
      if (wide)
        check(
          auto.some((d) => d.text.startsWith(`SOLO · CAM ${wide.number}`)),
          'wide in the silence',
        );
      for (const role of m.checks?.soloRoles ?? []) {
        const cam = cams1.find((c) => c.role === role);
        if (cam)
          check(
            auto.some((d) => d.text.startsWith(`SOLO · CAM ${cam.number}`)),
            `${role} fullscreen on the keyword`,
          );
      }
      check(
        auto.every(
          (d) =>
            d.kind !== 'auto' || d.reasons.length > 0 || d.text === 'resumed',
        ),
        'every auto cut carries reasons',
      );
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    await finish(1);
  }
  if (opt.live) await finish(0);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
