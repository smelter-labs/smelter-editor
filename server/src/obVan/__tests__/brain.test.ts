import { describe, expect, it } from 'vitest';
import type { ObRule, ObRuleset, ObShot } from '@smelter-editor/types';
import { obPresetRuleset, obShotCams } from '@smelter-editor/types';
import { attentionFor } from '../attention';
import {
  createBrainMemory,
  createObBrain,
  effectivePacing,
  stepBrain,
} from '../brain';
import type { ObBrainContext, ObDecision } from '../contracts';
import { mainCamOf } from '../rules';
import {
  Show,
  cam,
  context,
  program,
  scoringOnly,
  sig,
  solo,
  talking,
  type Script,
} from './ob-brain-fixtures';

const T0 = 1_000_000;
const person = (x: number, w = 0.12) => ({ x, y: 0.2, w, h: 0.5, conf: 0.9 });
const main = (shot: ObShot) => mainCamOf(shot);

function stepAll(ctxs: ObBrainContext[]): (ObDecision | null)[] {
  let memory = createBrainMemory();
  return ctxs.map((ctx) => {
    const out = stepBrain(ctx, memory, 1);
    memory = out.memory;
    return out.decision;
  });
}

// ── TALK ─────────────────────────────────────────────────────────────────

describe('TALK', () => {
  const cams = [
    cam(1, 'speaker', { name: 'Anna', talent: 'Anna Kowalska' }),
    cam(2, 'guest', { name: 'Ben', talent: 'Ben Smith' }),
    cam(3, 'wide'),
  ];
  const turns =
    (turnMs: number): Script =>
    (camId, airMs) => {
      // Everyone quiet for the first 4 s, then the turns start (A first).
      const t = airMs - T0 - 4000;
      const speaker =
        t < 0 ? null : Math.floor(t / turnMs) % 2 === 0 ? 'c1' : 'c2';
      return {
        audio: { speech: camId === speaker },
        video: {
          persons:
            camId === 'c3' ? [person(0.2), person(0.6)] : [person(0.4, 0.3)],
          motion: 0.05,
        },
      };
    };

  it('two speakers alternating every 4 s: cuts follow the speaker, never before min hold, anticipating the onset', () => {
    const show = new Show(obPresetRuleset('talk'), cams, {
      startAir: T0,
      initial: solo('c3'),
    });
    show.run(turns(4000), 44_000);
    const changes = show.changes;
    expect(changes.length).toBeGreaterThanOrEqual(6);
    for (const [a, b] of changes.slice(1).map((c, i) => [changes[i], c])) {
      expect(b.atAirMs - a.atAirMs).toBeGreaterThanOrEqual(2500);
    }
    // Every turn from 8 s on is picked up within 1 s of the first syllable.
    for (let onset = T0 + 8000; onset < T0 + 40_000; onset += 4000) {
      const speaker =
        Math.floor((onset - T0 - 4000) / 4000) % 2 === 0 ? 'c1' : 'c2';
      const cut = changes.find(
        (c) => c.atAirMs >= onset - 400 && c.atAirMs <= onset + 1000,
      );
      expect(cut, `turn at +${onset - T0} ms`).toBeDefined();
      expect(main(cut!.shot)).toBe(speaker);
    }
    const anticipated = changes.filter((c) =>
      /anticipated −200 ms/.test(c.decision.reason),
    );
    expect(anticipated.length).toBeGreaterThan(0);
    for (const c of anticipated) expect((c.atAirMs - T0) % 4000).toBe(3800);
    for (const e of show.events)
      expect(e.decision.atAirMs).toBeGreaterThanOrEqual(e.nowAir);
  });

  it('a fast back-and-forth (1.5 s turns) becomes a split of the two speakers', () => {
    const show = new Show(obPresetRuleset('talk'), cams, {
      startAir: T0,
      initial: solo('c1'),
    });
    show.run(turns(1500), 15_000);
    const split = show.changes.find((c) => c.shot.kind === 'split');
    expect(split).toBeDefined();
    expect(obShotCams(split!.shot).sort()).toEqual(['c1', 'c2']);
    expect(split!.decision.ruleId).toBe('dialogue');
  });

  it('25 s of silence ends in a max-hold cut', () => {
    const show = new Show(obPresetRuleset('talk'), cams, {
      startAir: T0,
      initial: solo('c3'),
    });
    show.run(
      () => ({ audio: { speech: false }, video: { persons: [person(0.3)] } }),
      25_000,
    );
    // Nothing moves before max hold (wide already on air holds `silence-wide`)…
    expect(show.changes[0].decision.source).toBe('maxHold');
    expect(show.changes[0].atAirMs - T0).toBeGreaterThanOrEqual(20_000);
    expect(show.changes[0].atAirMs - T0).toBeLessThan(20_300);
    expect(show.changes[0].decision.reason).toMatch(/max hold/);
    // …then the silence rule takes the wide back as soon as min hold allows.
    expect(show.changes[1]?.shot).toEqual(solo('c3'));
    expect(show.changes[1]?.decision.ruleId).toBe('silence-wide');
  });

  it('keyword "slide" → speaker-slides with the speaking camera', () => {
    const talkCams = [...cams, cam(4, 'slides')];
    const show = new Show(obPresetRuleset('talk'), talkCams, {
      startAir: T0,
      initial: solo('c1'),
    });
    const script: Script = (camId) => ({
      audio: camId === 'c4' ? null : { speech: camId === 'c1' },
      video: { persons: [person(0.4)] },
    });
    show.run(script, 6000);
    const before = show.events.length;
    show.transcript('c1', 'As you can see on this slide, latency drops.');
    show.run(script, 1000);
    const cut = show.events
      .slice(before)
      .find((e) => e.decision.shot?.kind === 'speaker-slides');
    expect(cut?.decision.shot).toEqual({
      kind: 'speaker-slides',
      speaker: 'c1',
      slides: 'c4',
    });
    expect(cut?.decision.ruleId).toBe('slides-kw');
    // A keyword is heard at air time (captions are not ahead): cut right away, not at the lookahead edge.
    expect(cut!.decision.atAirMs - cut!.nowAir).toBeLessThanOrEqual(1000);
  });

  it('keyword "roll the tape" → fullscreen tape cam, hard cut', () => {
    const talkCams = [...cams, cam(4, 'slides'), cam(5, 'tape')];
    const show = new Show(obPresetRuleset('talk'), talkCams, {
      startAir: T0,
      initial: solo('c1'),
    });
    const script: Script = (camId) => ({
      audio:
        camId === 'c4' || camId === 'c5' ? null : { speech: camId === 'c1' },
      video: { persons: [person(0.4)] },
    });
    show.run(script, 6000);
    const before = show.events.length;
    show.transcript('c1', "Don't take my word for it. Roll the tape.");
    show.run(script, 1000);
    const cut = show.events
      .slice(before)
      .find((e) => e.decision.ruleId === 'tape-kw');
    expect(cut?.decision.shot).toEqual({ kind: 'solo', cam: 'c5' });
    expect(cut?.decision.transition?.type).toBe('cut');
  });

  it('tape keyword without a tape cam fires nothing', () => {
    const show = new Show(obPresetRuleset('talk'), cams, {
      startAir: T0,
      initial: solo('c1'),
    });
    const script: Script = (camId) => ({
      audio: { speech: camId === 'c1' },
      video: { persons: [person(0.4)] },
    });
    show.run(script, 6000);
    const before = show.events.length;
    show.transcript('c1', 'Roll the tape.');
    show.run(script, 2000);
    const tapeCut = show.events
      .slice(before)
      .find((e) => e.decision.ruleId === 'tape-kw');
    expect(tapeCut).toBeUndefined();
  });

  it('a new voice gets a lower third on the trigger camera, anticipated, with a readable reason', () => {
    const T = T0 + 20_000;
    const ctx = context({
      ruleset: obPresetRuleset('talk'),
      nowAir: T - 3000,
      lookaheadMs: 3000,
      cams,
      signals: {
        c1: sig('c1', T, { speechShare10s: 0.5 }),
        c2: talking('c2', T, T - 1600, {
          speechShare10s: 0.2,
          people: { count: 1, largest: null, centroid: null, tracks: [] },
        }),
        c3: sig('c3', T),
      },
      program: program({
        shot: solo('c1'),
        sinceAirMs: T - 12_000,
        history: [{ shot: solo('c1'), atAirMs: T - 12_000 }],
      }),
    });
    const d = stepBrain(ctx, createBrainMemory()).decision;
    expect(d?.ruleId).toBe('lt-new-voice');
    expect(d?.shot).toEqual(solo('c2'));
    expect(d?.lowerThird).toEqual({
      camId: 'c2',
      mode: 'talent',
      holdMs: 5000,
    });
    expect(d?.atAirMs).toBe(T - 1600 - 200);
    expect(d?.reason).toBe(
      'CAM 2 Ben · speech 1.6 s · faces 1 · held CAM 1 Anna 12 s · rule lt-new-voice · anticipated −200 ms',
    );
    expect(d?.reasons).toContain('Lower third on a new voice');
  });

  it('a split ends when one side talks alone for 8 s (dialogueSplit)', () => {
    const T = T0 + 50_000;
    const split: ObShot = { kind: 'split', cams: ['c1', 'c2'] };
    const ctx = context({
      ruleset: obPresetRuleset('talk'),
      nowAir: T,
      cams,
      signals: {
        c1: talking('c1', T, T - 8500),
        c2: sig('c2', T),
        c3: sig('c3', T),
      },
      program: program({ shot: split, sinceAirMs: T - 12_000 }),
    });
    const d = stepBrain(ctx, createBrainMemory()).decision;
    expect(d?.shot).toEqual(solo('c1'));
    expect(d?.source).toBe('behaviour');
    expect(d?.reason).toMatch(/dialogue over/);
  });
});

// ── MATCH ────────────────────────────────────────────────────────────────

describe('MATCH', () => {
  const cams = [
    cam(1, 'wide'),
    cam(2, 'goal-left'),
    cam(3, 'goal-right'),
    cam(4, 'audience'),
  ];

  it('ball on the wide → virtual camera on the ball; ball lost → back to the wide', () => {
    const show = new Show(obPresetRuleset('match'), cams, {
      startAir: T0,
      initial: solo('c1'),
    });
    const script =
      (ball: boolean): Script =>
      (camId, airMs) => ({
        audio: { rms: -30 },
        video:
          camId === 'c1'
            ? {
                motion: 0.3,
                persons: [person(0.2), person(0.5), person(0.7)],
                ball: ball
                  ? {
                      x: 0.3 + ((airMs - T0) % 10_000) / 20_000,
                      y: 0.5,
                      w: 0.02,
                      h: 0.03,
                      conf: 0.6,
                    }
                  : null,
              }
            : { motion: 0.05, persons: [person(0.5)] },
      });
    show.run(script(true), 10_000);
    const follow = show.changes.find(
      (c) => c.decision.ruleId === 'follow-ball',
    );
    expect(follow?.shot).toEqual({
      kind: 'virtual',
      cam: 'c1',
      target: 'ball',
      zoom: 'normal',
    });
    expect(follow!.atAirMs - T0).toBeLessThan(4000);
    const n = show.changes.length;
    show.run(script(false), 8000);
    const lost = show.changes
      .slice(n)
      .find((c) => c.decision.ruleId === 'lost-wide');
    expect(lost?.shot).toEqual(solo('c1'));
    expect(lost?.decision.transition).toEqual({
      type: 'dissolve',
      durationMs: 500,
    });
  });

  it('a burst that calms down triggers the replay rule on that camera', () => {
    const show = new Show(obPresetRuleset('match'), cams, {
      startAir: T0,
      initial: solo('c1'),
    });
    const script: Script = (camId, airMs) => {
      const t = airMs - T0;
      const busy = camId === 'c2' && t >= 5000 && t < 6500;
      return {
        audio: { rms: -30 },
        video: { motion: busy ? 0.8 : 0.05, persons: [person(0.5)] },
      };
    };
    show.run(script, 14_000);
    const replay = show.events.find((e) => e.decision.replay);
    expect(replay?.decision.ruleId).toBe('burst-replay');
    expect(replay?.decision.replay).toEqual({
      camId: 'c2',
      beforeMs: 4000,
      afterMs: 1000,
    });
    expect(replay?.decision.transition).toEqual({
      type: 'wipe',
      durationMs: 300,
    });
    expect(replay!.decision.atAirMs - T0).toBeGreaterThanOrEqual(6500 + 1500);
  });

  it('burstReplay behaviour replays even when the rule is gone', () => {
    const rs = obPresetRuleset('match');
    rs.rules = rs.rules.filter((r) => r.id !== 'burst-replay');
    const show = new Show(rs, cams, { startAir: T0, initial: solo('c1') });
    show.run((camId, airMs) => {
      const t = airMs - T0;
      return {
        audio: { rms: -30 },
        video: { motion: camId === 'c3' && t >= 3000 && t < 4000 ? 0.8 : 0.05 },
      };
    }, 12_000);
    const replay = show.events.find((e) => e.decision.replay);
    expect(replay?.decision.source).toBe('behaviour');
    expect(replay?.decision.replay?.camId).toBe('c3');
  });
});

// ── STAGE ────────────────────────────────────────────────────────────────

describe('STAGE', () => {
  const cams = [cam(1, 'wide'), cam(2, 'stage-left'), cam(3, 'stage-right')];
  const monologue: Script = (camId, airMs) => {
    const t = airMs - T0;
    const entrance = camId === 'c2' && t >= 20_000 && t < 20_600;
    return {
      audio: { speech: camId === 'c1' },
      video: {
        motion: entrance ? 0.7 : 0.03,
        persons:
          camId === 'c1'
            ? [person(0.3, 0.2), person(0.7, 0.1)]
            : entrance
              ? [person(0.5)]
              : [],
      },
    };
  };

  it('a monologue: pushes in on the speaking actor, then never cuts away', () => {
    const show = new Show(obPresetRuleset('stage'), cams, {
      startAir: T0,
      initial: solo('c1'),
    });
    show.run(monologue, 30_000);
    expect(show.changes).toHaveLength(1);
    const zoom = show.changes[0];
    expect(zoom.decision.ruleId).toBe('monologue-zoom');
    expect(zoom.shot).toEqual({
      kind: 'virtual',
      cam: 'c1',
      target: 'speaker',
      zoom: 'tight',
    });
    expect(zoom.decision.effects).toEqual({ spotlight: true });
    expect(zoom.decision.transition).toEqual({
      type: 'dissolve',
      durationMs: 1200,
    });
    expect(zoom.atAirMs - T0).toBeGreaterThanOrEqual(6000); // STAGE min hold from the start
  });

  const withoutZoom = (
    patch: (rules: ObRule[]) => ObRule[] = (r) => r,
  ): ObRuleset => {
    const rs = obPresetRuleset('stage');
    rs.rules = patch(rs.rules.filter((r) => r.id !== 'monologue-zoom'));
    return rs;
  };

  it('monologueLock blocks an entrance cut below priority 80', () => {
    const show = new Show(withoutZoom(), cams, {
      startAir: T0,
      initial: solo('c1'),
    });
    show.run(monologue, 30_000);
    expect(show.events).toEqual([]);

    const unlocked = withoutZoom();
    unlocked.behaviours = { monologueLock: false };
    const control = new Show(unlocked, cams, {
      startAir: T0,
      initial: solo('c1'),
    });
    control.run(monologue, 30_000);
    expect(control.changes.map((c) => c.decision.ruleId)).toContain(
      'entrance-left',
    );
  });

  it('a rule at priority ≥ 80 cuts through the monologue', () => {
    const rs = withoutZoom((rules) =>
      rules.map((r) => (r.id === 'entrance-left' ? { ...r, priority: 85 } : r)),
    );
    const show = new Show(rs, cams, { startAir: T0, initial: solo('c1') });
    show.run(monologue, 30_000);
    expect(show.changes[0].shot).toEqual(solo('c2'));
    expect(show.changes[0].decision.ruleId).toBe('entrance-left');
    expect(show.changes[0].atAirMs - T0).toBeGreaterThanOrEqual(20_000);
    // …and back to the actor once the entrance shot has been held.
    expect(show.changes[1]?.shot).toEqual(solo('c1'));
  });
});

// ── GIG ──────────────────────────────────────────────────────────────────

describe('GIG', () => {
  const cams = [
    cam(1, 'wide'),
    cam(2, 'stage-left'),
    cam(3, 'stage-right'),
    cam(4, 'audience'),
  ];
  const band: Script = (camId, airMs) => ({
    audio:
      camId === 'c4' ? null : { rms: -20, onset: (airMs - T0) % 500 === 0 },
    video: { motion: camId === 'c4' ? 0.1 : 0.2, persons: [person(0.4)] },
  });

  it('onsets every 500 ms: cuts land on the beat grid (±60 ms) and rotate through the cameras', () => {
    const show = new Show(obPresetRuleset('gig'), cams, {
      startAir: T0,
      initial: solo('c1'),
    });
    show.run(band, 30_000);
    const changes = show.changes;
    expect(changes.length).toBeGreaterThanOrEqual(8);
    for (const c of changes) {
      const off = (c.atAirMs - T0) % 500;
      expect(
        Math.min(off, 500 - off),
        `cut at +${c.atAirMs - T0}`,
      ).toBeLessThanOrEqual(60);
      expect(c.decision.reason).toMatch(/beat \+0 ms/);
    }
    const used = new Set(changes.map((c) => main(c.shot)));
    expect(used.size).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < changes.length; i++)
      expect(main(changes[i].shot)).not.toBe(main(changes[i - 1].shot));
  });

  it('the loud part goes wide and neon', () => {
    const show = new Show(obPresetRuleset('gig'), cams, {
      startAir: T0,
      initial: solo('c2'),
    });
    show.run(
      (camId, airMs) => ({
        audio:
          camId === 'c4' ? null : { rms: -8, onset: (airMs - T0) % 400 === 0 },
        video: { motion: 0.2 },
      }),
      8000,
    );
    const loud = show.changes.find((c) => c.decision.ruleId === 'loud-wide');
    expect(loud?.shot).toEqual(solo('c1'));
    expect(loud?.decision.effects).toEqual({ grade: 'neon' });
  });
});

// ── Scoring, gates, overrides ────────────────────────────────────────────

describe('brain core', () => {
  const cams = [cam(1, 'speaker'), cam(2, 'guest'), cam(3, 'wide')];
  const T = T0 + 60_000;
  const quiet = { c1: sig('c1', T), c2: sig('c2', T), c3: sig('c3', T) };
  const onAir = program({ shot: solo('c1'), sinceAirMs: T - 10_000 });

  it('prefer-cam wins the scoring', () => {
    const base = context({
      ruleset: scoringOnly('talk'),
      nowAir: T,
      cams,
      signals: quiet,
      program: onAir,
    });
    expect(stepBrain(base, createBrainMemory()).decision).toBeNull();
    const preferred = {
      ...base,
      overrides: {
        preferCam: { camId: 'c3', untilAirMs: T + 10_000, boost: 1 },
      },
    };
    const d = stepBrain(preferred, createBrainMemory()).decision;
    expect(d?.shot).toEqual(solo('c3'));
    expect(d?.source).toBe('score');
    expect(d?.reason).toMatch(/score \d\.\d\d vs \d\.\d\d/);
    const expired = {
      ...base,
      overrides: { preferCam: { camId: 'c3', untilAirMs: T - 1, boost: 1 } },
    };
    expect(stepBrain(expired, createBrainMemory()).decision).toBeNull();
  });

  it('hysteresis: a small lead does not switch, a clear one does', () => {
    const signals = {
      ...quiet,
      c2: talking('c2', T, T - 300, { speechShare10s: 0 }),
    };
    const d = stepBrain(
      context({
        ruleset: scoringOnly('talk'),
        nowAir: T,
        cams,
        signals,
        program: onAir,
      }),
      createBrainMemory(),
    ).decision;
    expect(d?.shot).toEqual(solo('c2'));
    const weak = { ...quiet, c2: sig('c2', T, { speechShare10s: 0.3 }) };
    expect(
      stepBrain(
        context({
          ruleset: scoringOnly('talk'),
          nowAir: T,
          cams,
          signals: weak,
          program: onAir,
        }),
        createBrainMemory(),
      ).decision,
    ).toBeNull();
  });

  it('gates: pending cut, operator pause, rule hold, min hold', () => {
    const signals = { ...quiet, c2: talking('c2', T, T - 300) };
    const ctx = context({
      ruleset: scoringOnly('talk'),
      nowAir: T,
      cams,
      signals,
      program: onAir,
    });
    expect(stepBrain(ctx, createBrainMemory()).decision).not.toBeNull();
    const gated = [
      program({ ...onAir, pending: true }),
      program({ ...onAir, manualUntilAirMs: T + 5000 }),
      program({ ...onAir, holdUntilAirMs: T + 1 }),
      program({ ...onAir, sinceAirMs: T - 1000 }),
    ];
    for (const p of gated)
      expect(
        stepBrain({ ...ctx, program: p }, createBrainMemory()).decision,
      ).toBeNull();
    const resumed = program({
      ...onAir,
      manualUntilAirMs: T - 1,
      holdUntilAirMs: T,
    });
    expect(
      stepBrain({ ...ctx, program: resumed }, createBrainMemory()).decision,
    ).not.toBeNull();
  });

  it('never proposes a dead or offline camera, nor the shot already on air', () => {
    const deadCams = [
      cam(1, 'speaker'),
      cam(2, 'guest', { live: false }),
      cam(3, 'wide'),
    ];
    const signals = {
      c1: sig('c1', T),
      c2: talking('c2', T, T - 300),
      c3: talking('c3', T, T - 300, { offline: true }),
    };
    const ctx = context({
      ruleset: scoringOnly('talk'),
      nowAir: T,
      cams: deadCams,
      signals,
      program: onAir,
    });
    const d = stepBrain(ctx, createBrainMemory()).decision;
    expect(d === null || !['c2', 'c3'].includes(main(d.shot!) ?? '')).toBe(
      true,
    );
    // A rule whose shot is on air holds instead of re-deciding.
    const rs: ObRuleset = {
      ...scoringOnly('talk'),
      rules: [
        {
          id: 'keep',
          name: 'keep',
          priority: 50,
          when: { signal: 'hold', op: '>', value: 0 },
          then: { shot: { kind: 'solo', cam: 'speaker' } },
        },
      ],
    };
    const held = context({
      ruleset: rs,
      nowAir: T,
      cams,
      signals: { ...quiet, c2: talking('c2', T, T - 300) },
      program: onAir,
    });
    expect(stepBrain(held, createBrainMemory()).decision).toBeNull();
  });

  it('with nothing on air, the best camera goes up at once', () => {
    const signals = { ...quiet, c2: talking('c2', T, T - 300) };
    const d = stepBrain(
      context({ ruleset: scoringOnly('talk'), nowAir: T, cams, signals }),
      createBrainMemory(),
    ).decision;
    expect(d?.shot).toEqual(solo('c2'));
    expect(d?.atAirMs).toBeGreaterThanOrEqual(T);
  });

  it('forMs and cooldown', () => {
    const rule: ObRule = {
      id: 'busy-wide',
      name: 'Busy wide',
      priority: 50,
      cooldownMs: 5000,
      when: { signal: 'motion', cam: 'wide', op: '>', value: 0.5, forMs: 1000 },
      then: { shot: { kind: 'solo', cam: 'wide' } },
    };
    const rs: ObRuleset = {
      ...scoringOnly('talk', {
        weights: {
          speech: 0,
          motion: 0,
          people: 0,
          ball: 0,
          novelty: 0,
          stay: 0,
        },
      }),
      rules: [rule],
    };
    const at = (t: number) =>
      context({
        ruleset: rs,
        nowAir: t,
        cams,
        signals: { c1: sig('c1', t), c3: sig('c3', t, { motionEma: 0.8 }) },
        program: program({ shot: solo('c1'), sinceAirMs: t - 10_000 }),
      });
    const out = stepAll([
      at(T),
      at(T + 900),
      at(T + 1000),
      at(T + 3000),
      at(T + 6100),
    ]);
    expect(out.map((d) => d?.ruleId ?? null)).toEqual([
      null,
      null,
      'busy-wide',
      null,
      'busy-wide',
    ]);
  });

  it('is deterministic and never mutates its input memory', () => {
    const signals = {
      ...quiet,
      c2: talking('c2', T, T - 300),
      c3: sig('c3', T, { motionEma: 0.4 }),
    };
    const ctx = context({
      ruleset: obPresetRuleset('talk'),
      nowAir: T,
      lookaheadMs: 2000,
      cams,
      signals,
      program: onAir,
    });
    const memory = createBrainMemory();
    const frozen = JSON.stringify(memory);
    const a = stepBrain(ctx, memory, 7);
    const b = stepBrain(ctx, memory, 7);
    expect(a).toEqual(b);
    expect(JSON.stringify(memory)).toBe(frozen);
  });

  it('pacing factor scales min hold', () => {
    const signals = { ...quiet, c2: talking('c2', T, T - 300) };
    const ctx = context({
      ruleset: scoringOnly('talk'),
      nowAir: T,
      cams,
      signals,
      program: program({ shot: solo('c1'), sinceAirMs: T - 3000 }),
    });
    expect(stepBrain(ctx, createBrainMemory()).decision).not.toBeNull();
    expect(
      stepBrain({ ...ctx, pacingFactor: 1.6 }, createBrainMemory()).decision,
    ).toBeNull();
    expect(
      stepBrain(
        { ...ctx, overrides: { pacing: { minHoldMs: 5000 } } },
        createBrainMemory(),
      ).decision,
    ).toBeNull();
  });

  it('createObBrain keeps memory between steps and resets it on a new ruleset', () => {
    const rule: ObRule = {
      id: 'wide-once',
      name: 'wide',
      priority: 50,
      cooldownMs: 60_000,
      when: { signal: 'hold', op: '>', value: 0 },
      then: { shot: { kind: 'solo', cam: 'wide' } },
    };
    const rs: ObRuleset = { ...scoringOnly('talk'), rules: [rule] };
    const brain = createObBrain(rs);
    const ctx = context({
      ruleset: rs,
      nowAir: T,
      cams,
      signals: quiet,
      program: onAir,
    });
    expect(brain.step(ctx)?.ruleId).toBe('wide-once');
    expect(brain.step({ ...ctx, nowAir: T + 100 })).toBeNull(); // cooling down
    brain.reset();
    expect(brain.step({ ...ctx, nowAir: T + 200 })?.ruleId).toBe('wide-once');
    const renamed = { ...rs, name: 'other' };
    brain.step({ ...ctx, ruleset: renamed, nowAir: T + 300 });
    brain.setRuleset(rs);
    expect(brain.step({ ...ctx, nowAir: T + 400 })?.ruleId).toBe('wide-once');
  });

  it('a pacing-only rule changes the pacing the brain holds to', () => {
    const rs = obPresetRuleset('gig');
    const quietBand = Object.fromEntries(
      cams.map((c) => [c.camId, sig(c.camId, T, { rmsDb: -45 })]),
    );
    const at = (t: number) =>
      context({
        ruleset: rs,
        nowAir: t,
        cams,
        signals: quietBand,
        program: program({ shot: solo('c1'), sinceAirMs: T - 5000 }),
      });
    let memory = createBrainMemory();
    const first = stepBrain(at(T), memory);
    memory = first.memory;
    expect(first.decision).toBeNull();
    expect(effectivePacing(at(T), memory, T).minHoldMs).toBe(1200);
    const quiet = stepBrain(at(T + 4000), memory);
    expect(quiet.decision?.ruleId).toBe('quiet');
    expect(quiet.decision?.pacing).toEqual({
      minHoldMs: 4000,
      transition: 'dissolve',
      transitionMs: 800,
    });
    expect(quiet.decision?.effects).toEqual({ grade: 'none' });
    expect(quiet.decision?.shot).toBeUndefined();
    const held = effectivePacing(at(T + 5000), quiet.memory, T + 5000);
    expect(held).toMatchObject({
      minHoldMs: 4000,
      transition: 'dissolve',
      transitionMs: 800,
      maxHoldMs: 8000,
    });
    // The patch lasts max(cooldown, 10 s), then GIG's own pacing is back.
    expect(
      effectivePacing(at(T + 14_001), quiet.memory, T + 14_001).minHoldMs,
    ).toBe(1200);
  });
});

describe('attention', () => {
  const T = T0;
  const tracks = [
    { x: 0.1, y: 0.2, w: 0.1, h: 0.3, id: 1 },
    { x: 0.5, y: 0.1, w: 0.2, h: 0.6, id: 2, conf: 0.8 },
  ];
  const people = {
    count: 2,
    largest: tracks[1],
    centroid: { x: 0.4, y: 0.4 },
    tracks,
  };

  it('speaker = largest person while speaking', () => {
    expect(
      attentionFor(talking('c1', T, T - 500, { people }), 'speaker'),
    ).toEqual({ x: 0.5, y: 0.1, w: 0.2, h: 0.6, conf: 0.8 });
    expect(attentionFor(sig('c1', T, { people }), 'speaker')).toBeNull();
    expect(attentionFor(sig('c1', T, { people }), 'largest')).toEqual({
      x: 0.5,
      y: 0.1,
      w: 0.2,
      h: 0.6,
      conf: 0.8,
    });
  });

  it('centroid / motion frame everyone; ball frames the ball', () => {
    const box = attentionFor(sig('c1', T, { people }), 'centroid');
    expect(box?.x).toBeCloseTo(0.1);
    expect(box?.w).toBeCloseTo(0.6);
    expect(box?.h).toBeCloseTo(0.6);
    expect(attentionFor(sig('c1', T, { people }), 'motion')).toBeNull();
    expect(
      attentionFor(sig('c1', T, { people, motionEma: 0.3 }), 'motion'),
    ).toEqual(box);
    expect(
      attentionFor(
        sig('c1', T, { ball: { x: 0.5, y: 0.5, conf: 0.6, ageMs: 100 } }),
        'ball',
      ),
    ).toEqual({ x: 0.48, y: 0.48, w: 0.04, h: 0.04, conf: 0.6 });
  });

  it('no picture → no attention', () => {
    expect(attentionFor(undefined, 'largest')).toBeNull();
    expect(
      attentionFor(sig('c1', T, { people, staleVideo: true }), 'largest'),
    ).toBeNull();
  });
});
