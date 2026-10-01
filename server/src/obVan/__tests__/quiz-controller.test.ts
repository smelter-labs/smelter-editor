import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomEvent } from '@smelter-editor/types';
import {
  OB_PRESET_RULESETS,
  OB_QUIZ_CELEBRATE_MS,
  parseObRuleset,
} from '@smelter-editor/types';
import type { ObHudState } from '../../app/store';
import {
  NULL_BRAIN,
  NULL_ATTENTION,
  ObNullSignals,
  ObVanController,
  type ObControllerDeps,
} from '../ObVanController';
import { parseObCommand } from '../commands';

const ROOM = 'room-quiz';
const T0 = 1_000_000;

class SpySignals extends ObNullSignals {
  quizTurns: (string | null)[] = [];
  setQuizTurn(camId: string | null): void {
    this.quizTurns.push(camId);
  }
}

function harness() {
  const events: RoomEvent[] = [];
  const hud: (ObHudState | null)[] = [];
  const connected = new Set<string>();
  const sfxRegs: { kind: string; offsetMs: number }[] = [];
  const sfxUnregs: string[] = [];
  const signals = new SpySignals();

  const deps: ObControllerDeps = {
    broadcast: (e) => events.push(e),
    sendTo: () => {},
    removeInput: async (inputId) => {
      connected.delete(inputId);
    },
    layoutTiles: async () => {},
    runInputTransition: () => {},
    setInputVolume: () => {},
    isInputConnected: (inputId) => connected.has(inputId),
    isInputLive: (inputId) => connected.has(inputId),
    getResolution: () => ({ width: 1280, height: 720 }),
    publishHud: (s) => hud.push(s),
    registerJoinQr: async (url) => `ob-qr-${url.length}`,
    registerGameCam: async () => {
      throw new Error('not used');
    },
    getSideChannelDelayMs: () => 3000,
    getFileClock: () => null,
    registerReplayClip: async () => null,
    unregisterReplayClip: () => {},
    registerQuizSfx: async (kind, offsetMs) => {
      sfxRegs.push({ kind, offsetMs });
      return `ob-sfx-${sfxRegs.length}`;
    },
    unregisterQuizSfx: (inputId) => sfxUnregs.push(inputId),
    getPipelineTimeMs: () => 50_000,
  };

  const controller = new ObVanController(ROOM, deps, {
    createSignals: () => signals,
    createBrain: () => NULL_BRAIN,
    attention: NULL_ATTENTION,
  });

  const attach = (n: number, role: 'speaker' | 'guest', talent?: string) => {
    const inputId = `mp4-${n}`;
    connected.add(inputId);
    const r = controller.attachFileCam({
      role,
      inputId,
      fileName: `ob-demo/clip${n}.mp4`,
      width: 1920,
      height: 1080,
      talent: talent ?? null,
    });
    if (!r.ok) throw new Error(r.message);
    return r.camId;
  };

  const lastHudQuiz = () => {
    for (let i = hud.length - 1; i >= 0; i--) {
      const h = hud[i];
      if (h) return h.quiz;
    }
    return null;
  };

  return { controller, signals, events, hud, sfxRegs, attach, lastHudQuiz };
}

/** Quiz preset, host + two contestants, on air, roster synced. */
async function onAirQuiz(h: ReturnType<typeof harness>) {
  h.controller.setConfig({ presetId: 'quiz', audio: { mode: 'mix' } });
  const host = h.attach(1, 'speaker', 'Max');
  const g1 = h.attach(2, 'guest', 'Alice');
  const g2 = h.attach(3, 'guest', 'Bob');
  expect(h.controller.control('go_live').ok).toBe(true);
  await vi.advanceTimersByTimeAsync(150); // one tick: quizStep seats players
  return { host, g1, g2 };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('QUIZ preset plumbing', () => {
  it('the preset ruleset parses with no warnings and sane priorities', () => {
    const quiz = OB_PRESET_RULESETS.quiz;
    const parsed = parseObRuleset(quiz, quiz);
    expect(parsed.ruleset).not.toBeNull();
    expect(parsed.warnings).toEqual([]);
    const byId = Object.fromEntries(
      parsed.ruleset!.rules.map((r) => [r.id, r.priority]),
    );
    expect(byId['quiz-think-solo']).toBeGreaterThan(byId['quiz-question-split']);
    expect(byId['quiz-question-split']).toBeGreaterThanOrEqual(80);
    expect(byId['default-grid']).toBeLessThan(byId['quiz-host-solo']);
  });

  it('parseObCommand round-trips every quiz field and rejects junk', () => {
    expect(
      parseObCommand({ op: 'quiz', action: 'assign', camId: 'cam-7' }),
    ).toEqual({ op: 'quiz', action: 'assign', camId: 'cam-7' });
    expect(parseObCommand({ op: 'quiz', action: 'lock', letter: 'C' })).toEqual(
      { op: 'quiz', action: 'lock', letter: 'C' },
    );
    expect(
      parseObCommand({ op: 'quiz', action: 'reveal', verdict: 'wrong' }),
    ).toEqual({ op: 'quiz', action: 'reveal', verdict: 'wrong' });
    expect(parseObCommand({ op: 'quiz', action: 'nope' })).toBeNull();
    expect(
      parseObCommand({ op: 'quiz', action: 'lock', letter: 'E' }),
    ).toEqual({ op: 'quiz', action: 'lock' });
  });
});

describe('ObVanController · quiz', () => {
  it('refuses the quiz op off-preset and off-air (reset excepted)', async () => {
    const h = harness();
    h.attach(1, 'guest');
    const offPreset = h.controller.operate({
      op: 'quiz',
      action: 'assign',
      camId: 'x',
    });
    expect(offPreset).toMatchObject({ ok: false, code: 'bad_action' });
    h.controller.setConfig({ presetId: 'quiz' });
    const offAir = h.controller.operate({ op: 'quiz', action: 'show_board' });
    expect(offAir).toMatchObject({ ok: false, code: 'bad_phase' });
    expect(h.controller.operate({ op: 'quiz', action: 'reset' }).ok).toBe(true);
  });

  it('seats guests as players and exposes quiz state + HUD on air', async () => {
    const h = harness();
    await onAirQuiz(h);
    const s = h.controller.stateSnapshot();
    expect(s.quiz?.players.map((p) => p.name)).toEqual(['Alice', 'Bob']);
    const hudQuiz = h.lastHudQuiz();
    expect(hudQuiz?.players).toHaveLength(2);
    expect(hudQuiz?.splash).toBe(true);
    expect(h.sfxRegs.map((r) => r.kind)).toEqual(['intro']);
  });

  it('assign raises the quizTurn signal and a lower third; the board never leaks the answer', async () => {
    const h = harness();
    const { g1 } = await onAirQuiz(h);
    expect(
      h.controller.operate({ op: 'quiz', action: 'assign', camId: g1 }).ok,
    ).toBe(true);
    expect(h.signals.quizTurns.at(-1)).toBe(g1);
    const s = h.controller.stateSnapshot();
    expect(s.quiz?.phase).toBe('assigned');
    expect(s.lowerThird?.camId).toBe(g1);
    expect(
      h.controller.operate({ op: 'quiz', action: 'show_board' }).ok,
    ).toBe(true);
    const board = h.lastHudQuiz()?.board;
    expect(board).not.toBeNull();
    expect(board && 'correct' in board).toBe(false);
    expect(board?.reveal).toBeNull();
  });

  it('reveal cuts solo to the contestant, moves the money and clears the signal', async () => {
    const h = harness();
    const { g1 } = await onAirQuiz(h);
    h.controller.operate({ op: 'quiz', action: 'assign', camId: g1 });
    h.controller.operate({ op: 'quiz', action: 'show_board' });
    const correct = h.controller.stateSnapshot().quiz!.current!.correct;
    h.controller.operate({ op: 'quiz', action: 'lock', letter: correct });
    expect(h.controller.operate({ op: 'quiz', action: 'reveal' }).ok).toBe(
      true,
    );
    const s = h.controller.stateSnapshot();
    expect(s.quiz?.phase).toBe('revealed');
    expect(s.quiz?.players[0].amount).toBe(1_500_000);
    expect(s.program.shot).toMatchObject({ kind: 'solo' });
    expect(h.signals.quizTurns.at(-1)).toBeNull();
    expect(h.sfxRegs.map((r) => r.kind)).toContain('win');
    const reveal = h.lastHudQuiz()?.board?.reveal;
    expect(reveal?.verdict).toBe('correct');
    expect(reveal?.correct).toBe(correct);
    expect(reveal?.delta).toBe(500_000);
    // Celebration expires back to idle on the tick clock.
    await vi.advanceTimersByTimeAsync(OB_QUIZ_CELEBRATE_MS + 200);
    expect(h.controller.stateSnapshot().quiz?.phase).toBe('idle');
  });

  it('leaving the quiz preset resets the game and the signal', async () => {
    const h = harness();
    const { g1 } = await onAirQuiz(h);
    h.controller.operate({ op: 'quiz', action: 'assign', camId: g1 });
    h.controller.setConfig({ presetId: 'talk' });
    expect(h.signals.quizTurns.at(-1)).toBeNull();
    expect(h.controller.stateSnapshot().quiz).toBeNull();
    // Back to quiz: a fresh game.
    h.controller.setConfig({ presetId: 'quiz' });
    await vi.advanceTimersByTimeAsync(150);
    expect(h.controller.stateSnapshot().quiz?.phase).toBe('idle');
    expect(h.controller.stateSnapshot().quiz?.questionsLeft).toBeGreaterThan(0);
  });

  it('the lifeline lands as a canned hint without an LLM', async () => {
    const h = harness();
    const { g1 } = await onAirQuiz(h);
    h.controller.operate({ op: 'quiz', action: 'assign', camId: g1 });
    expect(h.controller.operate({ op: 'quiz', action: 'lifeline' }).ok).toBe(
      true,
    );
    const hint = h.controller.stateSnapshot().quiz?.hint;
    expect(hint?.status).toBe('done');
    expect(hint?.canned).toBe(true);
    expect(hint?.letter).toBeNull();
    expect(h.lastHudQuiz()?.hint?.text).toBeTruthy();
  });
});
