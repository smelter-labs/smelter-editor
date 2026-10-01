import { describe, expect, it } from 'vitest';
import type { ObCondition } from '@smelter-editor/types';
import {
  OB_PRESET_IDS,
  OB_PRESET_RULESETS,
  obPresetRuleset,
  parseObRuleset,
} from '@smelter-editor/types';
import type { ObBrainCam, ObSignalState } from '../contracts';
import {
  type ObRuleEnv,
  type ObSinceMemory,
  compareValue,
  evalCondition,
  mainCamOf,
  resolveCam,
  resolveShot,
} from '../rules';
import { cam, sig, talking } from './ob-brain-fixtures';

const T = 500_000;

function env(
  cams: ObBrainCam[],
  signals: ObSignalState[],
  patch: Partial<ObRuleEnv> = {},
): ObRuleEnv {
  return {
    T,
    nowAir: T - 3000,
    cams,
    signals: Object.fromEntries(signals.map((s) => [s.camId, s])),
    programCams: [],
    programMain: null,
    holdMs: Infinity,
    segment: null,
    dialogue: null,
    scores: {},
    ...patch,
  };
}

function evaluate(e: ObRuleEnv, cond: ObCondition, since: ObSinceMemory = {}) {
  return evalCondition(e, cond, 'r', { since, touched: new Set() });
}

const CAMS = [
  cam(1, 'speaker'),
  cam(2, 'guest'),
  cam(3, 'wide'),
  cam(4, 'slides'),
];

describe('camera selectors', () => {
  const e = env(CAMS, [sig('c1', T), sig('c2', T), sig('c3', T)], {
    programCams: ['c1'],
    programMain: 'c1',
    scores: { c1: 2, c2: 1.5, c3: 0.4, c4: 0.9 },
  });

  it('roles, id: and cam: name one camera', () => {
    expect(resolveCam(e, 'wide', null)).toBe('c3');
    expect(resolveCam(e, 'slides', null)).toBe('c4'); // not analysed, still proposable
    expect(resolveCam(e, 'id:c2', null)).toBe('c2');
    expect(resolveCam(e, 'cam:3', null)).toBe('c3');
    expect(resolveCam(e, 'audience', null)).toBeNull();
    expect(resolveCam(e, 'cam:7', null)).toBeNull();
  });

  it('program / not-program / any / trigger', () => {
    expect(resolveCam(e, 'program', null)).toBe('c1');
    expect(resolveCam(e, 'not-program', null)).toBe('c2');
    expect(resolveCam(e, 'any', null)).toBe('c1');
    expect(resolveCam(e, 'trigger', 'c3')).toBe('c3');
    expect(resolveCam(e, 'trigger', null)).toBeNull();
  });

  it('never resolves a dead or offline camera', () => {
    const cams = [
      cam(1, 'speaker'),
      cam(2, 'wide', { live: false }),
      cam(3, 'wide'),
    ];
    const e2 = env(cams, [sig('c1', T), sig('c3', T, { offline: true })], {
      scores: { c1: 1, c2: 5, c3: 9 },
    });
    expect(resolveCam(e2, 'wide', null)).toBeNull();
    expect(resolveCam(e2, 'any', null)).toBe('c1');
    expect(resolveCam(e2, 'id:c2', null)).toBeNull();
  });

  it('shots: templates resolve, repeated / missing cameras fail', () => {
    expect(
      resolveShot(
        e,
        { kind: 'speaker-slides', speaker: 'trigger', slides: 'slides' },
        'c2',
      ),
    ).toEqual({
      kind: 'speaker-slides',
      speaker: 'c2',
      slides: 'c4',
    });
    expect(
      resolveShot(e, { kind: 'split', cams: ['program', 'trigger'] }, 'c1'),
    ).toBeNull();
    expect(
      resolveShot(e, { kind: 'split', cams: ['program', 'trigger'] }, 'c2'),
    ).toEqual({ kind: 'split', cams: ['c1', 'c2'] });
    expect(resolveShot(e, { kind: 'solo', cam: 'audience' }, null)).toBeNull();
    expect(
      resolveShot(
        e,
        { kind: 'virtual', cam: 'wide', target: 'ball', zoom: 'tight' },
        null,
      ),
    ).toEqual({
      kind: 'virtual',
      cam: 'c3',
      target: 'ball',
      zoom: 'tight',
    });
    expect(resolveShot(e, { kind: 'grid', cams: [] }, null)).toEqual({
      kind: 'grid',
      cams: [],
    });
    expect(
      mainCamOf({ kind: 'speaker-slides', speaker: 'c2', slides: 'c4' }),
    ).toBe('c2');
  });
});

describe('conditions', () => {
  it('a bare leaf binds the best matching camera as trigger', () => {
    const e = env(CAMS, [
      talking('c1', T, T - 500, { speechProb: 0.7 }),
      talking('c2', T, T - 500, { speechProb: 0.9 }),
      sig('c3', T),
    ]);
    expect(evaluate(e, { signal: 'speech' })).toEqual({
      ok: true,
      trigger: 'c2',
    });
  });

  it('not-program only looks off air', () => {
    const e = env(
      CAMS,
      [talking('c1', T, T - 500), sig('c2', T), sig('c3', T)],
      { programCams: ['c1'], programMain: 'c1' },
    );
    expect(evaluate(e, { signal: 'speech', cam: 'not-program' }).ok).toBe(
      false,
    );
    expect(evaluate(e, { signal: 'speech', cam: 'program' }).ok).toBe(true);
  });

  it('all: `trigger` leaves must hold for the camera the binding leaf proposed', () => {
    const cond: ObCondition = {
      all: [
        { signal: 'speech', cam: 'any' },
        { signal: 'people', cam: 'trigger', op: '>=', value: 2 },
      ],
    };
    const people = (n: number) => ({
      count: n,
      largest: null,
      centroid: null,
      tracks: [],
    });
    const e = env(CAMS, [
      talking('c1', T, T - 500, { speechProb: 0.99, people: people(1) }),
      talking('c2', T, T - 500, { speechProb: 0.8, people: people(3) }),
      sig('c3', T, { people: people(5) }),
    ]);
    expect(evaluate(e, cond)).toEqual({ ok: true, trigger: 'c2' });
    const e2 = env(CAMS, [
      talking('c1', T, T - 500, { people: people(1) }),
      sig('c3', T, { people: people(5) }),
    ]);
    expect(evaluate(e2, cond).ok).toBe(false);
  });

  it('any / not', () => {
    const e = env(CAMS, [sig('c1', T), sig('c3', T, { motionEma: 0.6 })]);
    expect(
      evaluate(e, {
        any: [
          { signal: 'speech' },
          { signal: 'motion', cam: 'wide', op: '>', value: 0.5 },
        ],
      }),
    ).toEqual({
      ok: true,
      trigger: 'c3',
    });
    expect(evaluate(e, { not: { signal: 'speech' } })).toEqual({
      ok: true,
      trigger: null,
    });
    expect(
      evaluate(e, {
        not: { signal: 'motion', cam: 'wide', op: '>', value: 0.5 },
      }).ok,
    ).toBe(false);
  });

  it('a role that no camera has makes its leaf false', () => {
    const e = env(CAMS, [sig('c1', T)]);
    expect(
      evaluate(e, { signal: 'motion', cam: 'audience', op: '<', value: 1 }).ok,
    ).toBe(false);
  });

  it('keyword has <group> — recent hits only, whole show when no camera is named', () => {
    const kw = (airMs: number) => [{ word: 'slide', group: 'slides', airMs }];
    const e = env(CAMS, [
      sig('c1', T, { keywords: kw(T - 3000 - 1000) }),
      sig('c2', T),
    ]);
    expect(
      evaluate(e, { signal: 'keyword', op: 'has', value: 'slides' }).ok,
    ).toBe(true);
    expect(
      evaluate(e, { signal: 'keyword', op: 'has', value: 'audience' }).ok,
    ).toBe(false);
    expect(
      evaluate(e, {
        signal: 'keyword',
        cam: 'guest',
        op: 'has',
        value: 'slides',
      }).ok,
    ).toBe(false);
    const old = env(CAMS, [sig('c1', T, { keywords: kw(T - 3000 - 5000) })]);
    expect(
      evaluate(old, { signal: 'keyword', op: 'has', value: 'slides' }).ok,
    ).toBe(false);
  });

  it('forMs: speech uses the worker onset time, other leaves the first tick seen', () => {
    const e = env(CAMS, [talking('c1', T, T - 1000)]);
    expect(evaluate(e, { signal: 'speech', forMs: 1500 }).ok).toBe(false);
    expect(
      evaluate({ ...e, T: T + 600 }, { signal: 'speech', forMs: 1500 }).ok,
    ).toBe(true);

    const since: ObSinceMemory = {};
    const loud = (t: number) =>
      env(CAMS, [sig('c1', t, { rmsDb: -10 })], { T: t });
    const cond: ObCondition = {
      signal: 'rms',
      op: '>',
      value: -14,
      forMs: 1500,
    };
    expect(evaluate(loud(T), cond, since).ok).toBe(false);
    expect(evaluate(loud(T + 1400), cond, since).ok).toBe(false);
    expect(evaluate(loud(T + 1500), cond, since).ok).toBe(true);
    // A dip resets the timer.
    expect(
      evaluate(
        env(CAMS, [sig('c1', T + 1600, { rmsDb: -30 })], { T: T + 1600 }),
        cond,
        since,
      ).ok,
    ).toBe(false);
    expect(evaluate(loud(T + 1700), cond, since).ok).toBe(false);
  });

  it('silence (no camera): every heard camera is quiet, timed from the latest to go quiet', () => {
    const e = env(CAMS, [
      sig('c1', T, { silenceSinceAirMs: T - 7000 }),
      sig('c2', T, { silenceSinceAirMs: T - 6500 }),
    ]);
    expect(evaluate(e, { signal: 'silence', forMs: 6000 }).ok).toBe(true);
    expect(evaluate(e, { signal: 'silence', forMs: 7000 }).ok).toBe(false);
    const talk = env(CAMS, [sig('c1', T), talking('c2', T, T - 100)]);
    expect(evaluate(talk, { signal: 'silence' }).ok).toBe(false);
  });

  it('stale streams make their leaves false', () => {
    const e = env(CAMS, [
      talking('c1', T, T - 5000, { staleAudio: true }),
      sig('c3', T, { staleVideo: true, motionEma: 0.9 }),
    ]);
    expect(evaluate(e, { signal: 'speech' }).ok).toBe(false);
    expect(evaluate(e, { signal: 'motion', op: '>', value: 0.5 }).ok).toBe(
      false,
    );
  });

  it('hold, segment, dialogue', () => {
    const e = env(CAMS, [sig('c1', T), sig('c2', T)], {
      holdMs: 3000,
      segment: { index: 2, title: 'Q&A' },
      dialogue: { cams: ['c1', 'c2'], partner: 'c2', switches: 3 },
    });
    expect(evaluate(e, { signal: 'hold', op: '>', value: 2500 }).ok).toBe(true);
    expect(evaluate(e, { signal: 'segment', op: '==', value: 2 }).ok).toBe(
      true,
    );
    expect(evaluate(e, { signal: 'segment', value: 'q&a' }).ok).toBe(true);
    expect(evaluate(e, { signal: 'dialogue', op: '==', value: true })).toEqual({
      ok: true,
      trigger: 'c2',
    });
    expect(
      evaluate(
        { ...e, dialogue: null },
        { signal: 'dialogue', op: '==', value: true },
      ).ok,
    ).toBe(false);
  });

  it('ballAge of a lost ball is infinite; ball leaf needs a ball', () => {
    const e = env(CAMS, [sig('c3', T)]);
    expect(
      evaluate(e, { signal: 'ballAge', cam: 'wide', op: '>', value: 2000 }).ok,
    ).toBe(true);
    expect(evaluate(e, { signal: 'ball', cam: 'wide' }).ok).toBe(false);
  });
});

describe('compareValue', () => {
  it('operators and defaults', () => {
    expect(compareValue(3, '>=', 3)).toBe(true);
    expect(compareValue(3, '!=', 3)).toBe(false);
    expect(compareValue(0.2, undefined, undefined)).toBe(true);
    expect(compareValue(0, undefined, undefined)).toBe(false);
    expect(compareValue(true, undefined, undefined)).toBe(true);
    expect(compareValue(false, '==', 'false')).toBe(true);
    expect(compareValue(['slides'], 'has', 'slides')).toBe(true);
    expect(compareValue(['slides'], 'has', 'Slides')).toBe(true);
    expect(compareValue(['slides'], '!=', 'slides')).toBe(false);
    expect(compareValue(2, 'has', 2)).toBe(false);
    expect(compareValue(2, '>', 'abc')).toBe(false);
  });
});

describe('parseObRuleset repairs (LLM-style input)', () => {
  const talk = obPresetRuleset('talk');

  it('a partial roleBias overlays the fallback instead of replacing it', () => {
    const parsed = parseObRuleset(
      { rules: [], weights: { roleBias: { speaker: 0.5 } } },
      talk,
    );
    expect(parsed.ruleset?.weights.roleBias).toMatchObject({
      speaker: 0.5,
      slides: talk.weights.roleBias?.slides,
      tape: talk.weights.roleBias?.tape,
    });
  });

  it('behaviours merge over the fallback', () => {
    const parsed = parseObRuleset(
      { rules: [], behaviours: { monologueLock: true } },
      talk,
    );
    expect(parsed.ruleset?.behaviours).toEqual({
      ...talk.behaviours,
      monologueLock: true,
    });
  });

  it('a keyword rule whose group changed case is re-pointed at the group', () => {
    const parsed = parseObRuleset(
      {
        rules: [
          {
            id: 'tape-kw',
            priority: 85,
            when: { all: [{ signal: 'keyword', op: 'has', value: 'tape' }] },
            then: { shot: { kind: 'solo', cam: 'tape' } },
          },
        ],
        keywords: { Tape: ['roll the tape'] },
      },
      talk,
    );
    const rule = parsed.ruleset?.rules[0];
    const leaf = rule && 'all' in rule.when ? rule.when.all[0] : null;
    expect(leaf?.value).toBe('Tape');
    expect(parsed.warnings.some((w) => w.includes('case fixed'))).toBe(true);
  });

  it('a dropped keyword group still referenced by a rule is restored from the fallback', () => {
    const raw = structuredClone(OB_PRESET_RULESETS.talk) as {
      keywords?: Record<string, string[]>;
    };
    raw.keywords = { slides: ['slide'] }; // the LLM "forgot" tape and audience
    const parsed = parseObRuleset(raw, talk);
    expect(parsed.ruleset?.keywords?.tape).toEqual(talk.keywords?.tape);
    expect(
      parsed.warnings.some((w) => w.includes('restored from the preset')),
    ).toBe(true);
  });

  it('warns when a keyword group cannot be restored from anywhere', () => {
    const parsed = parseObRuleset(
      {
        rules: [
          {
            id: 'ghost',
            when: { signal: 'keyword', op: 'has', value: 'zzz' },
            then: { shot: { kind: 'solo', cam: 'wide' } },
          },
        ],
      },
      talk,
    );
    expect(parsed.ruleset?.rules).toHaveLength(1);
    expect(
      parsed.warnings.some((w) => w.includes('may never fire')),
    ).toBe(true);
  });

  it('holdMs on a rule that changes no picture is dropped with a warning', () => {
    const parsed = parseObRuleset(
      {
        rules: [
          {
            id: 'fx-spam',
            when: { signal: 'speech', cam: 'any' },
            then: { effects: { spotlight: true } },
            holdMs: 8000,
          },
        ],
      },
      talk,
    );
    expect(parsed.ruleset?.rules[0]?.holdMs).toBeUndefined();
    expect(parsed.warnings.some((w) => w.includes('holdMs ignored'))).toBe(
      true,
    );
  });
});

describe('presets', () => {
  it.each(OB_PRESET_IDS)(
    '%s parses with zero warnings and round-trips',
    (id) => {
      const parsed = parseObRuleset(
        OB_PRESET_RULESETS[id],
        obPresetRuleset('talk'),
      );
      expect(parsed.errors).toEqual([]);
      expect(parsed.warnings).toEqual([]);
      expect(parsed.ruleset?.rules.map((r) => r.id)).toEqual(
        [...OB_PRESET_RULESETS[id].rules]
          .sort((a, b) => b.priority - a.priority)
          .map((r) => r.id),
      );
    },
  );
});
