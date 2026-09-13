#!/usr/bin/env node
// Convert the APIDIS basketball dataset's manual quarter annotations
// (all/metadata/20080409Quarter{N}.events.xml) into the Blacktop ground-truth
// format consumed by scripts/basketball-bench.mjs and the replay mode:
//
//   { t0Utc, quarter, teams: { A: { attacks: 'left' }, B: { attacks: 'right' } },
//     events: [ { tMs, kind: 'throw', made, points, team, shotType, basket, ... }, ... ] }
//
// `tMs` is media time in ms = (event UTC − t0Utc) × 1000, where t0Utc is the
// same anchor scripts/apidis-prep.mjs uses for frame 0 of the clips, so one
// events.json serves every camera of the quarter. No npm deps (regex XML).
//
//   node scripts/apidis-events.mjs --archive ~/…/pzpn/archive --quarter 2 \
//        --out data/mp4s/apidis/q2/events.json
//
// Dataset: APIDIS (UCLouvain, 2008) — non-commercial research use, please
// credit the APIDIS project. http://www.apidis.org/Dataset

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : def;
};
const archive = opt('archive', process.env.APIDIS_DIR);
const quarter = Number(opt('quarter', '2'));
const game = opt('game', '20080409');
const outFile = opt('out', null);
if (!archive || !(quarter >= 1 && quarter <= 4)) {
  console.error(
    'usage: apidis-events.mjs --archive <dir> --quarter 1..4 [--t0 <utcSec|ISO>] [--out events.json]',
  );
  process.exit(2);
}

const xmlPath = path.join(
  archive,
  'all',
  'metadata',
  `${game}Quarter${quarter}.events.xml`,
);
const xml = fs.readFileSync(xmlPath, 'utf8');

// "1,207,758,672.350000s" → 1207758672.35
const parseT = (s) => {
  if (!s) return null;
  const v = Number(String(s).replace(/,/g, '').replace(/s$/, ''));
  return Number.isFinite(v) ? v : null;
};
const parseAttrs = (s) => {
  const out = {};
  for (const m of s.matchAll(/([\w-]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
};
const teamOf = (s) => {
  const m = /team\s*([AB])/i.exec(s ?? '');
  return m ? m[1].toUpperCase() : null;
};

const root = parseAttrs(/<Video\b([^>]*)>/.exec(xml)?.[1] ?? '');
const qStart = parseT(root['Start-time']);
const qEnd = parseT(root['End-time']);
if (qStart == null || qEnd == null) {
  console.error('could not read Start-time/End-time from', xmlPath);
  process.exit(1);
}
const t0Raw = opt('t0', null);
const t0Utc =
  t0Raw == null
    ? Math.floor(qStart / 60) * 60
    : /^\d+(\.\d+)?$/.test(t0Raw)
      ? Number(t0Raw)
      : Date.parse(t0Raw) / 1000;
if (!Number.isFinite(t0Utc)) {
  console.error('bad --t0', t0Raw);
  process.exit(1);
}
const ms = (t) => Math.round((t - t0Utc) * 1000);

// Which basket each team attacks. Verified against the 3D ball ground truth
// (all/ball/GroundTruth_Ball_184700_3min): Team A's 16:47:16 layup and
// 16:49:52 three land at the hoop at court x≈2640 cm ("right", seen by
// cam3/cam6), Team B's 16:49:33 layup at x≈157 cm ("left", seen by
// cam7/cam5/cam1). Halves swap sides. (Best-camera-view in the XML is not a
// camera number in this sense — do not derive sides from it.)
const firstHalf = quarter <= 2;
const attacks = firstHalf ? { A: 'right', B: 'left' } : { A: 'left', B: 'right' };

const CHILD_KIND = {
  Throw: 'throw',
  Rebound: 'rebound',
  Foul: 'foul',
  Violation: 'violation',
  'Lost-ball': 'lost_ball',
  'Ball-out-of-bound': 'out_of_bounds',
  'Ball-back-to-court': 'back_to_court',
  'Player-exchange': 'exchange',
};
const shotTypeOf = (a) =>
  a['Free-throw'] === 'YES'
    ? 'free'
    : a['Three-point-field-goal'] === 'YES'
      ? 'three'
      : a['Layup'] === 'YES'
        ? 'layup'
        : a['Jump-shot'] === 'YES'
          ? 'jump'
          : 'unknown';

const events = [];
let unknownChildren = 0;

// Possession periods (may be self-closing).
for (const m of xml.matchAll(
  /<Ball-possession-period\b([^>]*?)(\/>|>([\s\S]*?)<\/Ball-possession-period>)/g,
)) {
  const a = parseAttrs(m[1]);
  const start = parseT(a['Start-time']);
  const end = parseT(a['End-time']);
  const body = m[3] ?? '';
  const firstEv = /<Clock-event\b([^>]*)/.exec(body);
  const team = firstEv ? teamOf(parseAttrs(firstEv[1])['Ball-possession-team']) : null;
  if (start != null) {
    events.push({
      tMs: ms(start),
      endMs: end != null ? ms(end) : null,
      kind: 'possession',
      team,
    });
  }
}

for (const m of xml.matchAll(
  /<Clock-event\b([^>]*?)(\/>|>([\s\S]*?)<\/Clock-event>)/g,
)) {
  const a = parseAttrs(m[1]);
  const body = m[3] ?? '';
  const t = parseT(a['Timestamp']) ?? parseT(a['End-time']) ?? parseT(a['Start-time']);
  if (t == null) continue;
  const team = teamOf(a['Ball-possession-team']);
  const bestCam = Number(a['Best-camera-view']);
  const playerNo = (a['Player-no'] ?? '').split(',')[0]?.trim() || null;
  const base = {
    tMs: ms(t),
    startMs: ms(parseT(a['Start-time']) ?? t),
    endMs: ms(parseT(a['End-time']) ?? t),
    team,
    playerNo,
    bestCam: Number.isFinite(bestCam) && bestCam > 0 ? bestCam : null,
  };
  for (const c of body.matchAll(/<([A-Za-z-]+)\b([^>]*?)\/?>/g)) {
    const kind = CHILD_KIND[c[1]];
    const ca = parseAttrs(c[2]);
    if (!kind) {
      unknownChildren++;
      continue;
    }
    if (kind === 'throw') {
      const points = Number(ca.Score ?? 0) || 0;
      events.push({
        ...base,
        kind,
        made: points > 0,
        points,
        shotType: shotTypeOf(ca),
        basket: team ? attacks[team] : null,
        assistPlayerNo: ca['Assist-player-no'] || null,
      });
    } else {
      const subtype =
        Object.keys(ca).find((k) => ca[k] === 'YES') ?? null;
      events.push({ ...base, kind, ...(subtype ? { subtype } : {}) });
    }
  }
}

// A free-throw event in the XML spans the foul and every free throw of the
// sequence (`Timestamp` = the foul, `End-time` = the last throw), so its
// `tMs` is not a make and its `Score` counts every made throw. Where the
// footage was checked the made throws are re-timed here (media ms of the
// ball dropping through the net; `xmlTMs` keeps the annotated time) and a
// multi-point event becomes one 1-point event per made throw.
const FREE_THROW_FIXES = {
  20080409: {
    2: [
      { tMs: 588300, team: 'A', madeAtMs: [612000, 623300], timedFrom: 'cam6 offline trace (eval.py --mode trace), 2026-09-11' },
      // B's two free throws: the first drops right at the annotated time, the
      // second 23.6 s later (cam7 offline trace + the live pipeline both fire).
      { tMs: 420650, team: 'B', madeAtMs: [420600, 444200], timedFrom: 'cam7 offline trace + live bench on demo/left-3-loop, 2026-09-12' },
    ],
    // A's 53.75 s event (Score 1) spans the foul and the series; the one made
    // throw drops through 21 s later. A's 685.0 s event (Score 1) keeps its XML
    // time — the cam7 trace reads all three attempts in that span as misses.
    4: [
      { tMs: 53750, team: 'A', madeAtMs: [74880], timedFrom: 'cam7 offline trace (eval.py --mode trace) + frame check, 2026-09-12' },
    ],
  },
};
for (const fix of FREE_THROW_FIXES[game]?.[quarter] ?? []) {
  const i = events.findIndex(
    (e) => e.kind === 'throw' && e.shotType === 'free' && e.team === fix.team && e.tMs === fix.tMs,
  );
  if (i < 0) {
    console.warn(`free-throw fix ${fix.team}@${fix.tMs} ms: no matching event`);
    continue;
  }
  const src = events[i];
  events.splice(
    i,
    1,
    ...fix.madeAtMs.map((t) => ({
      ...src,
      tMs: t,
      made: true,
      points: 1,
      xmlTMs: src.tMs,
      timedFrom: fix.timedFrom,
    })),
  );
}

events.sort((x, y) => x.tMs - y.tMs || x.kind.localeCompare(y.kind));

const out = {
  source: `APIDIS ${game} quarter ${quarter}`,
  license:
    'APIDIS dataset — non-commercial research only; credit the APIDIS project (http://www.apidis.org/Dataset)',
  quarter,
  t0Utc,
  t0Iso: new Date(t0Utc * 1000).toISOString(),
  quarterStartMs: ms(qStart),
  quarterEndMs: ms(qEnd),
  teams: { A: { attacks: attacks.A }, B: { attacks: attacks.B } },
  baskets: {
    left: { cams: [7, 5, 1, 2], courtX: 157 },
    right: { cams: [3, 6, 4], courtX: 2640 },
  },
  events,
};

// Summary (compare with the annotation totals: Q1 A17–B24, Q2 A13–B18,
// Q3 A15–B18, Q4 A24–B10).
const throws = events.filter((e) => e.kind === 'throw');
const sum = { A: { throws: 0, made: 0, points: 0 }, B: { throws: 0, made: 0, points: 0 } };
for (const e of throws) {
  if (!e.team) continue;
  sum[e.team].throws++;
  if (e.made) {
    sum[e.team].made++;
    sum[e.team].points += e.points;
  }
}
const byBasket = { left: 0, right: 0 };
for (const e of throws) if (e.basket && e.made) byBasket[e.basket]++;
console.log(
  `quarter ${quarter}: ${out.t0Iso} (t0Utc ${t0Utc}), span ${(out.quarterStartMs / 1000).toFixed(1)}s → ${(out.quarterEndMs / 1000).toFixed(1)}s`,
);
console.log(
  `  throws ${throws.length} (A ${sum.A.throws}, B ${sum.B.throws}); makes A ${sum.A.made} / B ${sum.B.made}; points A ${sum.A.points} – B ${sum.B.points}`,
);
console.log(
  `  makes by basket: left ${byBasket.left} (A attacks ${attacks.A}), right ${byBasket.right}; other events ${events.length - throws.length}${unknownChildren ? `; unknown child tags ${unknownChildren}` : ''}`,
);

if (outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
  console.log(`wrote ${outFile}`);
} else {
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}
