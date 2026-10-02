import { describe, expect, it } from 'vitest';
import {
  OB_DEFAULT_CONFIG,
  obPresetRuleset,
  type ObOperatorCommand,
  type ObState,
} from '@smelter-editor/types';
import { commandEchoed, pendingKeyOf } from '../pending';

function makeState(patch: Partial<ObState> = {}): ObState {
  return {
    roomId: 'r',
    phase: 'on-air',
    config: structuredClone(OB_DEFAULT_CONFIG),
    ruleset: obPresetRuleset('talk'),
    cams: [],
    program: {
      shot: { kind: 'solo', cam: 'a' },
      sinceMs: 100,
      source: 'operator',
      transition: null,
    },
    preview: null,
    autoPilot: {
      on: false,
      pausedUntilMs: null,
      next: null,
      lastDecisionAtMs: null,
    },
    effects: { grade: 'none', spotlight: false, softBackground: true },
    lowerThird: null,
    titleBug: { event: 'X', segment: null, visible: true },
    audio: { mode: 'follow' },
    replay: null,
    rundown: { items: [], index: 0 },
    operator: null,
    overrides: { pacing: null, preferCam: null },
    host: {
      camId: null,
      trackId: null,
      confidence: 0,
      sinceMs: null,
      status: 'off',
      lastGesture: null,
    },
    quiz: null,
    llm: {
      available: false,
      model: null,
      analyst: false,
      intervalS: 30,
      busy: false,
      runs: 0,
      tokensIn: 0,
      tokensOut: 0,
      estCostUsd: 0,
      lastRunAtMs: null,
      lastNote: null,
      backoffUntilMs: null,
      error: null,
    },
    stats: {
      startedAtMs: null,
      endedAtMs: null,
      cuts: 0,
      bySource: { operator: 0, auto: 0, llm: 0, system: 0 },
      onAirMsByCam: {},
      avgHoldMs: 0,
    },
    wrapNotes: null,
    isRecording: false,
    log: [],
    ...patch,
  };
}

describe('pending keys', () => {
  it('same press = same key; take and cut share one', () => {
    const p2: ObOperatorCommand = {
      op: 'preview',
      shot: { kind: 'solo', cam: 'b' },
    };
    const p3: ObOperatorCommand = {
      op: 'preview',
      shot: { kind: 'solo', cam: 'c' },
    };
    expect(pendingKeyOf(p2)).toBe(pendingKeyOf({ ...p2 }));
    expect(pendingKeyOf(p2)).not.toBe(pendingKeyOf(p3));
    expect(pendingKeyOf({ op: 'take' })).toBe(pendingKeyOf({ op: 'cut' }));
    expect(pendingKeyOf({ op: 'lower_third', clear: true })).toBe(
      'lower_third:clear',
    );
  });
});

describe('echo detection', () => {
  const before = makeState();

  it('preview echoes when the preview shot matches', () => {
    const cmd: ObOperatorCommand = {
      op: 'preview',
      shot: { kind: 'solo', cam: 'b' },
    };
    expect(commandEchoed(cmd, before, before)).toBe(false);
    expect(
      commandEchoed(
        cmd,
        before,
        makeState({ preview: { kind: 'solo', cam: 'b' } }),
      ),
    ).toBe(true);
  });

  it('take echoes when the program changes', () => {
    expect(commandEchoed({ op: 'take' }, before, makeState())).toBe(false);
    const after = makeState({ program: { ...before.program, sinceMs: 200 } });
    expect(commandEchoed({ op: 'take' }, before, after)).toBe(true);
  });

  it('auto / fx / transition / segment', () => {
    expect(
      commandEchoed(
        { op: 'auto', enabled: true },
        before,
        makeState({ autoPilot: { ...before.autoPilot, on: true } }),
      ),
    ).toBe(true);
    expect(
      commandEchoed({ op: 'fx', effects: { grade: 'mono' } }, before, before),
    ).toBe(false);
    expect(
      commandEchoed(
        { op: 'fx', effects: { grade: 'mono' } },
        before,
        makeState({ effects: { ...before.effects, grade: 'mono' } }),
      ),
    ).toBe(true);
    const cfg = {
      ...before.config,
      transition: { type: 'wipe' as const, durationMs: 400 },
    };
    expect(
      commandEchoed(
        { op: 'transition', transition: { type: 'wipe' } },
        before,
        makeState({ config: cfg }),
      ),
    ).toBe(true);
    expect(
      commandEchoed(
        { op: 'segment', action: 'goto', index: 2 },
        before,
        makeState({ rundown: { items: [], index: 2 } }),
      ),
    ).toBe(true);
    expect(
      commandEchoed({ op: 'segment', action: 'next' }, before, before),
    ).toBe(false);
  });

  it('lower third: a new start or a clear', () => {
    const lt = {
      name: 'A',
      subtitle: null,
      durationMs: null,
      camId: 'a',
      startedAtMs: 5,
      untilMs: null,
    };
    expect(
      commandEchoed(
        { op: 'lower_third', camId: 'a' },
        before,
        makeState({ lowerThird: lt }),
      ),
    ).toBe(true);
    const withLt = makeState({ lowerThird: lt });
    expect(
      commandEchoed({ op: 'lower_third', camId: 'a' }, withLt, withLt),
    ).toBe(false);
    expect(
      commandEchoed({ op: 'lower_third', clear: true }, withLt, before),
    ).toBe(true);
  });

  it('quiz: each action waits for its own echo in state.quiz', () => {
    const quiz = (patch: Partial<NonNullable<ObState['quiz']>> = {}) =>
      makeState({
        quiz: {
          phase: 'idle',
          players: [],
          questionsLeft: 3,
          current: null,
          hint: null,
          ...patch,
        },
      });
    const current = {
      questionId: 'q1',
      number: 1,
      forCamId: 'g1',
      q: 'Q?',
      answers: ['a', 'b', 'c', 'd'] as [string, string, string, string],
      correct: 'B' as const,
      shownAtMs: null as number | null,
      lockedLetter: null as 'A' | 'B' | 'C' | 'D' | null,
      lockedAtMs: null,
      verdict: null,
      revealedAtMs: null,
      delta: 0,
    };
    const assign = { op: 'quiz', action: 'assign', camId: 'g1' } as const;
    expect(commandEchoed(assign, before, quiz())).toBe(false);
    expect(
      commandEchoed(assign, before, quiz({ phase: 'assigned', current })),
    ).toBe(true);
    expect(
      commandEchoed({ op: 'quiz', action: 'show_board' }, before, quiz()),
    ).toBe(false);
    expect(
      commandEchoed(
        { op: 'quiz', action: 'show_board' },
        before,
        quiz({ phase: 'board', current: { ...current, shownAtMs: 5 } }),
      ),
    ).toBe(true);
    expect(
      commandEchoed(
        { op: 'quiz', action: 'lock', letter: 'C' },
        before,
        quiz({
          phase: 'locked',
          current: { ...current, shownAtMs: 5, lockedLetter: 'C' },
        }),
      ),
    ).toBe(true);
    expect(
      commandEchoed(
        { op: 'quiz', action: 'reveal' },
        before,
        quiz({ phase: 'revealed', current }),
      ),
    ).toBe(true);
    expect(
      commandEchoed(
        { op: 'quiz', action: 'lifeline' },
        before,
        quiz({
          phase: 'board',
          current,
          hint: {
            forCamId: 'g1',
            questionId: 'q1',
            status: 'pending',
            letter: null,
            text: null,
            requestedAtMs: 1,
            untilMs: null,
            canned: false,
          },
        }),
      ),
    ).toBe(true);
    expect(commandEchoed({ op: 'quiz', action: 'skip' }, before, quiz())).toBe(
      true,
    );
    // Off-preset state (quiz null): clear immediately, nothing to wait for.
    expect(
      commandEchoed({ op: 'quiz', action: 'reveal' }, before, before),
    ).toBe(true);
  });

  it('quiz pending keys: one per action, letters are distinct presses', () => {
    expect(pendingKeyOf({ op: 'quiz', action: 'lock', letter: 'A' })).not.toBe(
      pendingKeyOf({ op: 'quiz', action: 'lock', letter: 'B' }),
    );
    expect(pendingKeyOf({ op: 'quiz', action: 'assign', camId: 'x' })).toBe(
      pendingKeyOf({ op: 'quiz', action: 'assign', camId: 'y' }),
    );
    expect(pendingKeyOf({ op: 'quiz', action: 'reveal' })).toBe('quiz:reveal');
  });
});
