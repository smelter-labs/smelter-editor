#!/usr/bin/env node
// Derive Touchline's ground-truth `events.json` for an Alfheim clip from the
// telemetry sidecars written by alfheim-telemetry.mjs (ball.json in pitch
// metres, zxy.json in the same frame): the "plays" the football game fires as
// AI EVENTS (chance / shot / corner / goal candidate / goal_kick / sprint /
// attack) plus the kick-off. Same envelope as the basketball ground truth
// (`tMs` = clip media ms) so fb-clip-window.mjs can remap it onto demo windows.
//
//   node scripts/alfheim-events.mjs --clip fb/pano-2013-11-28/pano.mp4 [--out <events.json>] \
//        [--attacks-left auto|A|B] [--kickoff-s -221] [--inject goal@184.5,shot@200] \
//        [--sprints-max 40] [--keep-goal-candidates]
//
// The ball track is a single per-frame pixel, so a ball in the air unprojects
// to a wild pitch position (hundreds of m/s, "beyond the far touchline"):
// samples off the pitch by > 5 m or faster than 40 m/s are treated as gaps.
// Rules (pitch metres; X 0..105 left→right goal line in the panorama, Y 0..68
// far→near touchline):
//   chance    ball enters a penalty box from open play (≥ 3 m/s, from ≥ 2 m outside,
//             not from behind the goal line) and stays ≥ 0.8 s (refractory 12 s per box)
//   shot      ≥ 4 consecutive samples at 9–35 m/s within 25° of the goal centre, started
//             ≤ 35 m from the goal line, and the ball gets within 6 m of that goal line
//             (or crosses it) inside 2 s; `onTarget` when it reaches the mouth (refractory 4 s)
//   goal      ball ≥ 1 m behind a goal line between the posts for ≥ 0.4 s after moving
//             toward the goal at ≥ 6 m/s; kept only when a kick-off follows within 90 s
//             (this footage has no goals) unless --keep-goal-candidates
//   corner    ball still (≤ 1.5 m over 1.5 s) within 2.5 m of a corner flag (refractory 20 s)
//   goal_kick ball still within the goal area (refractory 20 s per side)
//   kickoff   ball still within 2 m of the centre spot, then leaves at > 3 m/s
//   out       ball > 2.5 m outside the pitch for ≥ 1.5 s (ledger only; refractory 6 s)
//   sprint    from zxy.json (≥ 7 m/s for ≥ 1 s), top --sprints-max by speed
//   attack    Tromsø centroid in the attacking third for ≥ 3 s (refractory 15 s)
// Sides → teams: Tromsø (A) attacks the goal opposite its own half at the start
// (auto from ZXY); B the other one. --kickoff-s puts the real kick-off relative
// to clip start (negative = the clip begins mid-half; the 2013-11-28 panorama
// starts at match clock 03:41 → -221) so the on-air clock shows the match minute.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PITCH,
  ema,
  fmtClock,
  median3,
  onPitch,
  readAlfheimSidecar,
} from './lib/alfheim.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MP4S = path.join(here, '..', 'data', 'mp4s');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);
const clipRel = opt('clip', null);
if (!clipRel) {
  console.error(
    'usage: alfheim-events.mjs --clip <mp4 under data/mp4s> [--out events.json] [--attacks-left auto|A|B] [--kickoff-s N] [--inject kind@s,…] [--sprints-max 40] [--keep-goal-candidates]',
  );
  process.exit(2);
}
const clipPath = path.join(MP4S, clipRel);
const dir = path.dirname(clipPath);
const sidecar = readAlfheimSidecar(clipPath);
const outFile = opt('out', path.join(dir, 'events.json'));
const sprintsMax = Number(opt('sprints-max', '40'));
const attacksLeftArg = opt('attacks-left', 'auto');
const kickoffArg = opt('kickoff-s', null);
const keepGoalCandidates = flag('keep-goal-candidates');
const inject = opt('inject', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [kind, at] = s.split('@');
    return { kind, tMs: Math.round(Number(at) * 1000) };
  });
if (!sidecar) {
  console.error(`no .alfheim.json next to ${clipPath}`);
  process.exit(1);
}
const readJson = (f) =>
  fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
const zxy = readJson(path.join(dir, 'zxy.json'));
const ball = readJson(path.join(dir, 'ball.json'));
const durationMs = Math.round(
  (sidecar.output?.durationS ?? sidecar.t1Utc - sidecar.t0Utc) * 1000,
);
const L = PITCH.length;
const W = PITCH.width;
const BOX_DEPTH = 16.5;
const BOX_Y0 = 13.85;
const BOX_Y1 = 54.15;
const GA_DEPTH = 5.5;
const GA_Y0 = 24.85;
const GA_Y1 = 43.15;
const POST_Y0 = 30.34;
const POST_Y1 = 37.66;
const r1 = (v) => Math.round(v * 10) / 10;

// ── Which goal does Tromsø (A) attack? ──────────────────────────────────
let aAttacksLeft = null;
let tromsoMeanX = null;
if (zxy && zxy.frame === 'pano') {
  let sx = 0;
  let sn = 0;
  const first = Math.min(120000, durationMs);
  for (const tag of zxy.tags) {
    for (let i = 0; i < tag.x.length; i++) {
      const t = (i * 1000) / zxy.hz;
      if (t > first) break;
      const x = tag.x[i];
      const y = tag.y[i];
      if (x == null || y == null || !onPitch(x, y)) continue;
      sx += x;
      sn++;
    }
  }
  if (sn > 0) {
    tromsoMeanX = sx / sn;
    aAttacksLeft = tromsoMeanX > L / 2; // own half on the right → attacks left
  }
}
if (attacksLeftArg === 'A' || attacksLeftArg === 'B')
  aAttacksLeft = attacksLeftArg === 'A';
if (aAttacksLeft == null) {
  console.warn(
    'cannot tell which goal Tromsø attacks (no pano-frame zxy.json) — pass --attacks-left A|B; assuming A attacks LEFT',
  );
  aAttacksLeft = true;
}
const teamAttacking = (side) =>
  (side === 'left') === aAttacksLeft ? 'A' : 'B';
console.log(
  `Tromsø (A) attacks the ${aAttacksLeft ? 'LEFT' : 'RIGHT'} goal of the panorama in this clip${tromsoMeanX != null ? ` (mean X ${tromsoMeanX.toFixed(1)} m over the first 2 min)` : ''}`,
);

const events = [];
const push = (e) => events.push(e);

// ── Ball-derived events ─────────────────────────────────────────────────
let kickoffMs =
  kickoffArg != null ? Math.round(Number(kickoffArg) * 1000) : null;
const goalCandidates = [];
if (ball && ball.samples.length && ball.samples[0].length >= 5) {
  const S = ball.samples;
  const n = S.length;
  const t = S.map((s) => s[0]);
  const rawX = S.map((s) => s[3]);
  const rawY = S.map((s) => s[4]);
  const X = ema(median3(rawX), 0.4);
  const Y = ema(median3(rawY), 0.4);
  const vx = new Array(n).fill(0);
  const vy = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 2);
    const b = Math.min(n - 1, i + 2);
    const dt = (t[b] - t[a]) / 1000 || 0.16;
    vx[i] = (X[b] - X[a]) / dt;
    vy[i] = (Y[b] - Y[a]) / dt;
  }
  const speed = vx.map((v, i) => Math.hypot(v, vy[i]));
  // plausibility: on the pitch (5 m margin) and not absurdly fast
  const valid = new Array(n);
  for (let i = 0; i < n; i++)
    valid[i] = onPitch(rawX[i], rawY[i], 5) && speed[i] <= 40;
  // stationary: stays within 1.5 m over the next 1.5 s (needs ≥ 20 valid samples)
  const still = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (!valid[i]) continue;
    let j = i;
    let ok = 0;
    while (j < n && t[j] - t[i] <= 1500) {
      if (!valid[j] || Math.hypot(X[j] - X[i], Y[j] - Y[i]) > 1.5) break;
      ok++;
      j++;
    }
    still[i] = ok >= 20 && j < n && t[j - 1] - t[i] >= 1400;
  }
  const inBox = (i, side) =>
    Y[i] >= BOX_Y0 &&
    Y[i] <= BOX_Y1 &&
    (side === 'left'
      ? X[i] >= -0.5 && X[i] <= BOX_DEPTH
      : X[i] >= L - BOX_DEPTH && X[i] <= L + 0.5);
  // Goal kicks are placed on the goal-area line; the camera model is ~1 m off
  // at the ends, so accept the goal area with a 3 m margin.
  const inGoalArea = (i, side) =>
    Y[i] >= GA_Y0 - 3 &&
    Y[i] <= GA_Y1 + 3 &&
    (side === 'left'
      ? X[i] >= -2 && X[i] <= GA_DEPTH + 3
      : X[i] >= L - GA_DEPTH - 3 && X[i] <= L + 2);
  const behindGoal = (i, side) =>
    Y[i] >= POST_Y0 &&
    Y[i] <= POST_Y1 &&
    (side === 'left' ? X[i] < -1.0 : X[i] > L + 1.0);
  const distToGoalLine = (i, side) => (side === 'left' ? X[i] : L - X[i]);

  // kick-off(s): still near the centre spot, then leaves fast
  const kickoffs = [];
  for (let i = 0; i < n; i++) {
    if (!still[i] || Math.hypot(X[i] - L / 2, Y[i] - W / 2) > 2.0) continue;
    let j = i;
    while (j < n && still[j]) j++;
    let k = j;
    while (k < n && t[k] - t[j] < 1000) {
      if (valid[k] && speed[k] > 3) {
        if (!kickoffs.length || t[k] - kickoffs[kickoffs.length - 1] > 60000)
          kickoffs.push(t[k]);
        break;
      }
      k++;
    }
    i = Math.max(i, k);
  }
  for (const k of kickoffs) push({ tMs: k, kind: 'kickoff' });
  if (kickoffMs == null && kickoffs.length) kickoffMs = kickoffs[0];

  for (const side of ['left', 'right']) {
    // chance
    let enteredAt = null;
    let lastChance = -Infinity;
    let fired = null;
    for (let i = 1; i < n; i++) {
      if (!valid[i]) {
        enteredAt = null;
        continue;
      }
      const inside = inBox(i, side);
      if (inside && enteredAt == null) {
        // entry from open play: came from ≥ 2 m outside the box within the last 0.5 s, not from behind the line
        let from = i - 1;
        while (from > 0 && t[i] - t[from] < 500) from--;
        const fromOutside =
          valid[from] &&
          !inBox(from, side) &&
          distToGoalLine(from, side) >= BOX_DEPTH + 2 &&
          speed[i] >= 3;
        enteredAt = fromOutside ? t[i] : null;
        if (!fromOutside) {
          // wait until the ball leaves the box again
          while (i < n && (inBox(i, side) || !valid[i])) i++;
          continue;
        }
      }
      if (
        inside &&
        enteredAt != null &&
        fired == null &&
        t[i] - enteredAt >= 800 &&
        t[i] - lastChance >= 12000
      ) {
        fired = {
          tMs: enteredAt,
          startMs: enteredAt,
          endMs: null,
          kind: 'chance',
          side,
          team: teamAttacking(side),
          ballPx: [S[i][1], S[i][2]],
          ballM: [r1(X[i]), r1(Y[i])],
        };
        push(fired);
        lastChance = t[i];
      }
      if (!inside && enteredAt != null) {
        if (fired) fired.endMs = t[i];
        fired = null;
        enteredAt = null;
      }
    }
    // goal candidates
    let lastGoal = -Infinity;
    for (let i = 10; i < n; i++) {
      if (!valid[i] || !behindGoal(i, side)) continue;
      let j = i;
      while (j < n && valid[j] && behindGoal(j, side)) j++;
      const dwell = t[j - 1] - t[i];
      // approach: moving toward the goal at ≥ 6 m/s somewhere in the previous 0.6 s
      let approach = false;
      for (let k = i - 1; k >= 0 && t[i] - t[k] <= 600; k--) {
        if (
          valid[k] &&
          speed[k] >= 6 &&
          (side === 'left' ? vx[k] < 0 : vx[k] > 0)
        )
          approach = true;
      }
      if (dwell >= 400 && approach && t[i] - lastGoal >= 10000) {
        goalCandidates.push({
          tMs: t[i],
          kind: 'goal',
          side,
          team: teamAttacking(side),
          candidate: true,
          ballM: [r1(X[i]), r1(Y[i])],
          dwellMs: Math.round(dwell),
        });
        lastGoal = t[i];
      }
      i = j;
    }
    // goal kicks (ball still inside the goal area)
    let lastGk = -Infinity;
    for (let i = 0; i < n; i++) {
      if (still[i] && inGoalArea(i, side) && t[i] - lastGk >= 20000) {
        push({
          tMs: t[i],
          kind: 'goal_kick',
          side,
          team: teamAttacking(side) === 'A' ? 'B' : 'A',
        });
        lastGk = t[i];
      }
    }
  }

  // shots
  let lastShot = -Infinity;
  for (let i = 0; i < n - 4; i++) {
    if (!valid[i] || speed[i] < 9 || speed[i] > 35 || t[i] - lastShot < 4000)
      continue;
    const side = vx[i] < 0 ? 'left' : 'right';
    const gx = side === 'left' ? 0 : L;
    if (distToGoalLine(i, side) > 35 || distToGoalLine(i, side) < 0) continue;
    // 4 consecutive samples heading at the goal centre
    let okRun = true;
    for (let k = i; k < i + 4; k++) {
      if (!valid[k] || speed[k] < 9 || speed[k] > 35) {
        okRun = false;
        break;
      }
      const toGoal = Math.atan2(W / 2 - Y[k], gx - X[k]);
      let ang = Math.abs(Math.atan2(vy[k], vx[k]) - toGoal);
      if (ang > Math.PI) ang = 2 * Math.PI - ang;
      if (ang > (25 * Math.PI) / 180) {
        okRun = false;
        break;
      }
    }
    if (!okRun) continue;
    // must get near the goal line within 2 s
    let nearest = Infinity;
    let nearestY = null;
    let crossed = false;
    for (let k = i; k < n && t[k] - t[i] <= 2000; k++) {
      if (!valid[k]) continue;
      const dd = distToGoalLine(k, side);
      if (dd < nearest) {
        nearest = dd;
        nearestY = Y[k];
      }
      if (dd <= 0) {
        crossed = true;
        nearestY = Y[k];
        break;
      }
    }
    if (!(crossed || nearest <= 6)) continue;
    const onTarget =
      nearestY != null &&
      nearestY >= POST_Y0 - 0.5 &&
      nearestY <= POST_Y1 + 0.5;
    push({
      tMs: t[i],
      kind: 'shot',
      side,
      team: teamAttacking(side),
      speedMs: r1(speed[i]),
      onTarget,
      yAtLine: nearestY != null ? r1(nearestY) : null,
      ballM: [r1(X[i]), r1(Y[i])],
    });
    lastShot = t[i];
  }

  // corners
  const corners = {
    nearLeft: [0, W],
    farLeft: [0, 0],
    farRight: [L, 0],
    nearRight: [L, W],
  };
  let lastCorner = -Infinity;
  for (let i = 0; i < n; i++) {
    if (!still[i] || t[i] - lastCorner < 20000) continue;
    for (const [name, [cxm, cym]] of Object.entries(corners)) {
      if (Math.hypot(X[i] - cxm, Y[i] - cym) < 4) {
        const side = cxm === 0 ? 'left' : 'right';
        push({
          tMs: t[i],
          kind: 'corner',
          side,
          corner: name,
          team: teamAttacking(side),
        });
        lastCorner = t[i];
        break;
      }
    }
  }

  // out of play
  let outSince = null;
  let lastOut = -Infinity;
  for (let i = 0; i < n; i++) {
    const off = valid[i] && !onPitch(rawX[i], rawY[i], 2.5);
    if (off) {
      if (outSince == null) outSince = t[i];
      if (t[i] - outSince >= 1500 && t[i] - lastOut >= 6000) {
        const edge =
          Y[i] < 0 ? 'far' : Y[i] > W ? 'near' : X[i] < 0 ? 'left' : 'right';
        push({ tMs: outSince, kind: 'out', edge });
        lastOut = t[i];
      }
    } else if (valid[i]) outSince = null;
  }
}

// goals need a restart (kick-off) within 90 s
const allKickoffs = events
  .filter((e) => e.kind === 'kickoff')
  .map((e) => e.tMs);
for (const g of goalCandidates) {
  const restart = allKickoffs.some((k) => k > g.tMs && k - g.tMs <= 90000);
  if (restart || keepGoalCandidates)
    push({ ...g, confirmedByRestart: restart });
}

// ── ZXY-derived events ──────────────────────────────────────────────────
if (zxy) {
  const top = [...zxy.sprints]
    .sort((a, b) => b.topKmh - a.topKmh)
    .slice(0, sprintsMax);
  for (const s of top)
    push({
      tMs: s.tMs,
      startMs: s.startMs,
      endMs: s.endMs,
      kind: 'sprint',
      team: 'A',
      tag: s.tag,
      topKmh: s.topKmh,
      meters: s.meters,
    });
  if (zxy.frame === 'pano') {
    const attackX = aAttacksLeft ? [0, L / 3] : [(2 * L) / 3, L];
    const step = 1000 / zxy.hz;
    const len = Math.max(...zxy.tags.map((t) => t.x.length));
    let since = null;
    let lastAttack = -Infinity;
    for (let i = 0; i < len; i++) {
      let sx = 0;
      let sn = 0;
      for (const tag of zxy.tags) {
        const x = tag.x[i];
        const y = tag.y[i];
        if (x == null || y == null || !onPitch(x, y)) continue;
        sx += x;
        sn++;
      }
      const tMs = i * step;
      const inThird = sn >= 6 && sx / sn >= attackX[0] && sx / sn <= attackX[1];
      if (inThird) {
        if (since == null) since = tMs;
        if (
          since !== Infinity &&
          tMs - since >= 3000 &&
          tMs - lastAttack >= 15000
        ) {
          push({
            tMs: since,
            kind: 'attack',
            side: aAttacksLeft ? 'left' : 'right',
            team: 'A',
          });
          lastAttack = tMs;
          since = Infinity; // once per stay in the third
        }
      } else since = null;
    }
  }
}

for (const inj of inject) {
  const side = aAttacksLeft ? 'left' : 'right';
  push({
    tMs: inj.tMs,
    kind: inj.kind,
    side,
    team: teamAttacking(side),
    candidate: inj.kind === 'goal',
    injected: true,
  });
}

events.sort((a, b) => a.tMs - b.tMs || a.kind.localeCompare(b.kind));
const out = {
  source: `alfheim ${sidecar.session} ${sidecar.match}`,
  license:
    'Alfheim dataset (Simula) — non-commercial research only; cite Pettersen et al., "Soccer video and player position dataset", ACM MMSys 2014',
  clip: clipRel,
  session: sidecar.session,
  t0Utc: sidecar.t0Utc,
  t0Iso: sidecar.t0Iso,
  durationMs,
  teams: {
    A: {
      name: sidecar.homeTeam ?? 'Tromsø',
      tagged: true,
      attacks: aAttacksLeft ? 'left' : 'right',
    },
    B: {
      name: sidecar.awayTeam ?? 'Away',
      tagged: false,
      attacks: aAttacksLeft ? 'right' : 'left',
    },
  },
  kickoffMs,
  period: 1,
  events,
};
const counts = {};
for (const e of events) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
console.log(
  `events: ${events.length} —`,
  counts,
  `goal candidates dropped: ${goalCandidates.length - events.filter((e) => e.kind === 'goal' && !e.injected).length}`,
);
for (const e of events) {
  if (e.kind === 'sprint' || e.kind === 'out') continue;
  console.log(
    `  ${fmtClock(e.tMs).padStart(6)}  ${e.kind.padEnd(9)} ${(e.side ?? '').padEnd(5)} ${e.team ?? ''} ${e.onTarget != null ? (e.onTarget ? 'ON TARGET' : 'off') : ''} ${e.speedMs ? `${e.speedMs} m/s` : ''}`,
  );
}
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${outFile}`);
