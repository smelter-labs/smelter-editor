#!/usr/bin/env node
// Benchmark the basketball-scorer against annotated ground truth: play a clip
// as the hoop file cam through the real pipeline, collect the AI makes, and
// match them (by clip media time) to the made throws in an events.json
// (scripts/apidis-events.mjs format). Prints precision / recall / F1, timing
// bias and team-attribution accuracy; writes a JSON report.
//
// Needs the API on :3001 with the Python sidecars enabled (no SKIP_PYTHON).
//
//   node scripts/basketball-bench.mjs apidis/q2/cam7.mp4 --events apidis/q2/events.json \
//        --basket left --from-s 0 --to-s 600 --detector yolo --teams '#62611e,#151711'
//   node scripts/basketball-bench.mjs bb-synth.mp4 --events bb-synth.events.json --detector hsv
//
// Flags: --basket left|right|both (default both) · --tolerance-s 4 ·
//   --from-s/--to-s (media window: the clip is cut to it with ffmpeg into
//   data/mp4s/bb-bench/ and played from 0 — the engine cannot seek a clip
//   beyond the pipeline's age; --no-cut seeks via mp4-cam/sync instead) ·
//   --seconds (wall budget, default window + 8) · --court <clip> (optional second file cam) ·
//   --rim cx,cy,rx,ry (default: the clip's .apidis.json suggestion) ·
//   --teams '#a,#b' · --team-map A=A,B=B (GT letter → ledger team) ·
//   --arc-points 1|2 · --detector auto|yolo|hsv · --imgsz · --ball-conf ·
//   --weights · --analysis-fps · --shot-frames · --min-recall · --min-precision
//   · --max-fp · --report-dir data/bb-bench · --no-report

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  api,
  createRoom,
  deleteRoom,
  fmtShot,
  getState,
  openSpectator,
  parseArgs,
  sleep,
  waitFor,
} from './lib/bb-api.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(here, '..', 'data');
const { positional, opt, flag } = parseArgs(process.argv);
const clip = positional[0];
const eventsFile = opt('events', null);
if (!clip || !eventsFile) {
  console.error(
    'usage: basketball-bench.mjs <clip.mp4> --events <events.json> [flags]',
  );
  process.exit(2);
}

// ── ground truth + defaults from the clip's sidecar ──────────────────────
const gt = JSON.parse(
  fs.readFileSync(path.join(DATA, 'mp4s', eventsFile), 'utf8'),
);
const sidecarPath = path.join(
  DATA,
  'mp4s',
  clip.replace(/\.mp4$/i, '.apidis.json'),
);
const rimPath = path.join(DATA, 'mp4s', clip.replace(/\.mp4$/i, '.rim.json'));
const sidecar = fs.existsSync(sidecarPath)
  ? JSON.parse(fs.readFileSync(sidecarPath, 'utf8'))
  : fs.existsSync(rimPath)
    ? { rim: JSON.parse(fs.readFileSync(rimPath, 'utf8')) }
    : null;
if (sidecar?.timing === 'nominal') {
  console.error(
    `${clip} was converted with nominal timing (--mode naive); ground truth cannot line up. Re-run apidis-prep.mjs in cfr mode.`,
  );
  process.exit(2);
}
const rimDefault = sidecar?.rim
  ? [sidecar.rim.cx, sidecar.rim.cy, sidecar.rim.rx, sidecar.rim.ry].join(',')
  : '0.5,0.35,0.06,0.02';
const [cx, cy, rx, ry] = opt('rim', rimDefault).split(',').map(Number);
const teamsDefault =
  sidecar?.dataset === 'APIDIS' ? '#62611e,#151711' : '#2ee06a,#1f7bff';
const [colorA, colorB] = opt('teams', teamsDefault).split(',');
const teamMap = Object.fromEntries(
  opt('team-map', 'A=A,B=B')
    .split(',')
    .map((kv) => kv.split('=').map((s) => s.trim().toUpperCase())),
);
const basket = opt('basket', 'both');
const tolMs = Number(opt('tolerance-s', '4')) * 1000;
const fromMs = Math.round(Number(opt('from-s', '0')) * 1000);
const detector = opt('detector', 'auto');
const imgsz = Number(opt('imgsz', '640'));
const ballConf = Number(opt('ball-conf', '0.2'));
const weights = opt('weights', 'auto');
const analysisFps = Number(opt('analysis-fps', '20'));
const arcPoints = Number(opt('arc-points', '2'));
const court = opt('court', null);
const minRecall = opt('min-recall', null);
const minPrecision = opt('min-precision', null);
const maxFp = opt('max-fp', null);
const reportDir = opt('report-dir', path.join(DATA, 'bb-bench'));

// ── clip length + window ──────────────────────────────────────────────────
const { durationMs } = await api(
  'GET',
  `/suggestions/mp4-duration?fileName=${encodeURIComponent(clip)}`,
);
const toMs = Math.min(
  Math.round(Number(opt('to-s', String(durationMs / 1000))) * 1000),
  durationMs,
);
if (!(toMs > fromMs)) {
  console.error(`bad window ${fromMs}..${toMs} (clip ${durationMs} ms)`);
  process.exit(2);
}
const budgetS = Number(opt('seconds', String((toMs - fromMs) / 1000 + 8)));

// ── cut the window out of the clip (the engine cannot seek past the pipeline age)
function cutWindow(name) {
  if (flag('no-cut') || (fromMs === 0 && toMs >= durationMs))
    return { name, offsetMs: 0 };
  const slug = name.replace(/\.mp4$/i, '').replace(/[^A-Za-z0-9_-]+/g, '_');
  const cutName = `bb-bench/${slug}_${Math.round(fromMs / 1000)}-${Math.round(toMs / 1000)}.mp4`;
  const cutPath = path.join(DATA, 'mp4s', cutName);
  if (!fs.existsSync(cutPath)) {
    fs.mkdirSync(path.dirname(cutPath), { recursive: true });
    const encoders = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], {
      encoding: 'utf8',
    });
    const enc = /h264_videotoolbox/.test(encoders)
      ? [
          '-c:v',
          'h264_videotoolbox',
          '-b:v',
          '6M',
          '-allow_sw',
          '1',
          '-profile:v',
          'high',
        ]
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20'];
    console.log(
      `cutting ${name} ${(fromMs / 1000).toFixed(1)}–${(toMs / 1000).toFixed(1)} s → ${cutName}`,
    );
    execFileSync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-y',
        '-ss',
        String(fromMs / 1000),
        '-to',
        String(toMs / 1000),
        '-i',
        path.join(DATA, 'mp4s', name),
        '-an',
        ...enc,
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        cutPath + '.tmp.mp4',
      ],
      { stdio: 'inherit' },
    );
    fs.renameSync(cutPath + '.tmp.mp4', cutPath);
  }
  return { name: cutName, offsetMs: fromMs };
}
const hoopClip = cutWindow(clip);
const courtClip = court ? cutWindow(court) : null;
// Media time of the played clip → media time of the source clip.
const mediaOffsetMs = hoopClip.offsetMs;
const playFromMs = flag('no-cut') ? fromMs : 0;

const gtThrows = gt.events.filter(
  (e) =>
    e.kind === 'throw' &&
    (basket === 'both' || e.basket === basket) &&
    e.tMs >= fromMs &&
    e.tMs <= toMs,
);
const gtMakes = gtThrows.filter((e) => e.made);
console.log(
  `clip ${clip} (${(durationMs / 1000).toFixed(1)} s), window ${(fromMs / 1000).toFixed(1)}–${(toMs / 1000).toFixed(1)} s, basket=${basket}: ${gtThrows.length} GT throws, ${gtMakes.length} made · rim ${[cx, cy, rx, ry].join(',')} · detector ${detector} · teams ${colorA},${colorB}`,
);

// ── run ───────────────────────────────────────────────────────────────────
const roomId = await createRoom();
console.log(`room ${roomId}`);
const ai = new Map(); // shot.id → latest BbShotEvent (from 'made' + later edits)
const ws = await openSpectator(roomId, (ev) => {
  if (ev.type !== 'bb_shot') return;
  if (ev.kind === 'made' || ai.has(ev.shot.id)) ai.set(ev.shot.id, ev.shot);
  if (ev.kind !== 'warmup') console.log(fmtShot(ev.kind, ev.shot));
});
const polls = { samples: 0, tracked: 0, connected: 0 };
let finalState = null;
try {
  await api('POST', `/room/${roomId}/basketball-game/config`, {
    teams: {
      A: { name: 'TEAM A', color: colorA },
      B: { name: 'TEAM B', color: colorB },
    },
    rim: { cx, cy, rx, ry },
    detector: {
      ballDetector: detector,
      imgsz,
      ballConf,
      yoloWeights: weights,
      analysisFps,
    },
    shotFrames: flag('shot-frames'),
    autoAssignMinConf: 0.6,
    arcPoints,
    durationMs: 1_800_000,
  });
  const hoop = await api('POST', `/room/${roomId}/basketball-game/mp4-cam`, {
    role: 'hoop',
    fileName: hoopClip.name,
  });
  console.log(`hoop cam input ${hoop.inputId} (${hoopClip.name})`);
  if (courtClip) {
    const c = await api('POST', `/room/${roomId}/basketball-game/mp4-cam`, {
      role: 'court',
      fileName: courtClip.name,
    });
    console.log(`court cam input ${c.inputId} (${courtClip.name})`);
  }
  await waitFor(async () => (await getState(roomId)).cams.hoop.clip != null, {
    label: 'hoop clip clock',
    timeoutMs: 60_000,
  });
  // The scorer arming reconnects the hoop clip (playhead → 0); the sync
  // queues behind it on the room mutex, so issue it after the clock shows up.
  await api('POST', `/room/${roomId}/basketball-game/mp4-cam/sync`, {
    playFromMs,
  });
  await waitFor(
    async () => {
      const h = (await getState(roomId)).cams.hoop;
      return (
        h.camConnected &&
        h.clip &&
        Math.abs(h.clip.playFromMs - playFromMs) < 1500
      );
    },
    { label: `playhead at ${playFromMs} ms`, timeoutMs: 60_000 },
  );
  {
    const h = (await getState(roomId)).cams.hoop;
    if (Math.abs(h.clip.playFromMs - playFromMs) >= 1500) {
      throw new Error(
        `clip plays from ${h.clip.playFromMs} ms, not ${playFromMs} ms — the engine cannot seek beyond the pipeline age (drop --no-cut)`,
      );
    }
  }
  await api('POST', `/room/${roomId}/basketball-game/match`, {
    action: 'start',
  });
  const startedAt = Date.now();

  let lastLog = 0;
  let lastMedia = -1;
  for (;;) {
    await sleep(1000);
    const st = await getState(roomId);
    const h = st.cams.hoop;
    polls.samples++;
    if (h.ballTracked) polls.tracked++;
    if (h.camConnected) polls.connected++;
    const media = h.clip ? h.clip.mediaMs + mediaOffsetMs : -1;
    const elapsed = (Date.now() - startedAt) / 1000;
    if (Date.now() - lastLog > 10_000) {
      lastLog = Date.now();
      console.log(
        `  ${elapsed.toFixed(0)}s wall · media ${(media / 1000).toFixed(1)}s · cam=${h.camConnected ? 'live' : 'dark'} ball=${h.ballTracked ? 'tracked' : '-'} · A=${st.teams.A.score} B=${st.teams.B.score} pending=${st.pending.length} misses=${st.teams.A.attempts + st.teams.B.attempts + st.unattributedMisses - st.teams.A.makes - st.teams.B.makes}`,
      );
    }
    const wrapped = lastMedia >= 0 && media >= 0 && media < lastMedia - 5000;
    lastMedia = media;
    if (media >= toMs + 2000 || wrapped || elapsed > budgetS) break;
  }
  finalState = await getState(roomId);
} finally {
  ws.close();
  await deleteRoom(roomId);
}

// ── scoring ───────────────────────────────────────────────────────────────
// Shots carry the played clip's media time; map it back onto the source clip.
const aiMakes = [...ai.values()]
  .filter((s) => s.status !== 'voided' && s.mediaMs != null)
  .map((s) => ({ ...s, mediaMs: s.mediaMs + mediaOffsetMs }))
  .filter((s) => s.mediaMs >= fromMs - tolMs && s.mediaMs <= toMs + tolMs);
const pairs = [];
for (const g of gtMakes)
  for (const a of aiMakes) {
    const d = a.mediaMs - g.tMs;
    if (Math.abs(d) <= tolMs) pairs.push({ g, a, d });
  }
pairs.sort((x, y) => Math.abs(x.d) - Math.abs(y.d));
const matchedG = new Set();
const matchedA = new Set();
const matches = [];
for (const p of pairs) {
  if (matchedG.has(p.g) || matchedA.has(p.a)) continue;
  matchedG.add(p.g);
  matchedA.add(p.a);
  matches.push(p);
}
const tp = matches.length;
const fp = aiMakes.filter((a) => !matchedA.has(a));
const fn = gtMakes.filter((g) => !matchedG.has(g));
const precision = aiMakes.length ? tp / aiMakes.length : 0;
const recall = gtMakes.length ? tp / gtMakes.length : 0;
const f1 =
  precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
const deltas = matches.map((m) => m.d).sort((a, b) => a - b);
const median = deltas.length ? deltas[Math.floor(deltas.length / 2)] : null;
const meanAbs = deltas.length
  ? deltas.reduce((s, d) => s + Math.abs(d), 0) / deltas.length
  : null;
const withTeam = matches.filter((m) => m.g.team && teamMap[m.g.team]);
const teamRawOk = withTeam.filter(
  (m) => m.a.aiTeam === teamMap[m.g.team],
).length;
const teamFinalOk = withTeam.filter(
  (m) => m.a.team === teamMap[m.g.team],
).length;

console.log('\nPER GT SHOT');
for (const g of gtThrows) {
  const m = matches.find((x) => x.g === g);
  const tag = `${(g.tMs / 1000).toFixed(2).padStart(8)}s ${(g.shotType ?? '?').padEnd(6)} ${g.team ?? '-'} ${g.points}pt ${g.made ? 'MADE' : 'miss'}`;
  if (m)
    console.log(
      `  ${tag} → AI #${m.a.index} Δ=${(m.d / 1000).toFixed(2)}s ai=${m.a.aiTeam ?? '-'}@${m.a.aiConfidence.toFixed(2)} → ${m.a.team ?? 'pending'}`,
    );
  else console.log(`  ${tag}${g.made ? '   MISSED' : ''}`);
}
if (fp.length) {
  console.log('FALSE POSITIVES');
  for (const a of fp)
    console.log(
      `  AI #${a.index} media=${(a.mediaMs / 1000).toFixed(2)}s ai=${a.aiTeam ?? '-'}@${a.aiConfidence.toFixed(2)} ${a.status}`,
    );
}
const metrics = {
  gtMakes: gtMakes.length,
  gtThrows: gtThrows.length,
  aiMakes: aiMakes.length,
  tp,
  fp: fp.length,
  fn: fn.length,
  precision: +precision.toFixed(3),
  recall: +recall.toFixed(3),
  f1: +f1.toFixed(3),
  medianDeltaMs: median,
  meanAbsDeltaMs: meanAbs != null ? Math.round(meanAbs) : null,
  teamAccuracyRaw: withTeam.length
    ? +(teamRawOk / withTeam.length).toFixed(3)
    : null,
  teamAccuracyFinal: withTeam.length
    ? +(teamFinalOk / withTeam.length).toFixed(3)
    : null,
  pending: finalState?.pending.length ?? null,
  aiMisses: finalState
    ? finalState.teams.A.attempts +
      finalState.teams.B.attempts +
      finalState.unattributedMisses -
      finalState.teams.A.makes -
      finalState.teams.B.makes
    : null,
  gtMisses: gtThrows.length - gtMakes.length,
  ballTrackedPolls: `${polls.tracked}/${polls.samples}`,
  camConnectedPolls: `${polls.connected}/${polls.samples}`,
};
console.log('\nRESULT', metrics);

let failed = false;
if (minRecall != null && recall < Number(minRecall)) {
  console.log(`recall ${recall.toFixed(3)} < ${minRecall}`);
  failed = true;
}
if (minPrecision != null && precision < Number(minPrecision)) {
  console.log(`precision ${precision.toFixed(3)} < ${minPrecision}`);
  failed = true;
}
if (maxFp != null && fp.length > Number(maxFp)) {
  console.log(`fp ${fp.length} > ${maxFp}`);
  failed = true;
}
if (failed) process.exitCode = 1;

if (!flag('no-report')) {
  fs.mkdirSync(reportDir, { recursive: true });
  const slug = clip.replace(/\.mp4$/i, '').replace(/[^A-Za-z0-9_-]+/g, '_');
  const file = path.join(
    reportDir,
    `${slug}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        clip,
        playedClip: hoopClip.name,
        eventsFile,
        court,
        window: { fromMs, toMs },
        basket,
        tolMs,
        config: {
          rim: { cx, cy, rx, ry },
          detector,
          imgsz,
          ballConf,
          weights,
          analysisFps,
          teams: { A: colorA, B: colorB },
          teamMap,
          arcPoints,
        },
        metrics,
        matches: matches.map((m) => ({
          gtTMs: m.g.tMs,
          gtTeam: m.g.team,
          gtType: m.g.shotType,
          aiIndex: m.a.index,
          aiMediaMs: m.a.mediaMs,
          deltaMs: m.d,
          aiTeam: m.a.aiTeam,
          aiConfidence: m.a.aiConfidence,
          team: m.a.team,
          sourceT: m.a.sourceT,
        })),
        falsePositives: fp,
        missed: fn,
        gtThrows,
        aiMakes,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`report ${file}`);
}
