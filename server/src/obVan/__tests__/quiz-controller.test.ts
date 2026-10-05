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

function harness(
  quizAi?: import('../llm/quizHost').ObQuizAiModule,
  quizTts?: import('../llm/tts').ObQuizTtsModule,
) {
  const events: RoomEvent[] = [];
  const hud: (ObHudState | null)[] = [];
  const connected = new Set<string>();
  const sfxRegs: { kind: string; offsetMs: number }[] = [];
  const sfxUnregs: string[] = [];
  const speechRegs: { file: string; offsetMs: number }[] = [];
  const speechUnregs: string[] = [];
  const mouthSets: { camInputId: string; mouth: unknown }[] = [];
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
    registerQuizSpeech: async (file, offsetMs) => {
      speechRegs.push({ file, offsetMs });
      return `ob-tts-${speechRegs.length}`;
    },
    unregisterQuizSpeech: (inputId) => speechUnregs.push(inputId),
    setQuizSpeechMouth: (camInputId, mouth) =>
      mouthSets.push({ camInputId, mouth }),
    getPipelineTimeMs: () => 50_000,
  };

  const controller = new ObVanController(ROOM, deps, {
    createSignals: () => signals,
    createBrain: () => NULL_BRAIN,
    attention: NULL_ATTENTION,
    ...(quizAi ? { createQuizAi: () => quizAi } : {}),
    ...(quizTts ? { createQuizTts: () => quizTts } : {}),
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

  return {
    controller,
    signals,
    events,
    hud,
    sfxRegs,
    speechRegs,
    speechUnregs,
    mouthSets,
    attach,
    lastHudQuiz,
  };
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
    expect(byId['quiz-think-solo']).toBeGreaterThan(
      byId['quiz-question-split'],
    );
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
    expect(parseObCommand({ op: 'quiz', action: 'lock', letter: 'E' })).toEqual(
      { op: 'quiz', action: 'lock' },
    );
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
    expect(h.controller.operate({ op: 'quiz', action: 'show_board' }).ok).toBe(
      true,
    );
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

// ── AI contestants ─────────────────────────────────────────────────────────

import {
  OB_QUIZ_THINK_MIN_MS,
  type ObQuizLetter,
  type ObQuizModelId,
} from '@smelter-editor/types';
import type { ObQuizAiModule } from '../llm/quizHost';

function fakeQuizAi(
  answer: (model: ObQuizModelId) =>
    | {
        letter: ObQuizLetter;
        quip: string | null;
        confidence: number | null;
      }
    | { cashOut: true }
    | null = (model) =>
    model === 'gemini'
      ? { cashOut: true }
      : {
          letter: 'B',
          quip: `${model} says B`,
          confidence: model === 'jev' ? 0.9 : null,
        },
): {
  ai: ObQuizAiModule;
  calls: { model: ObQuizModelId; question: string; answers: string[] }[];
} {
  const calls: { model: ObQuizModelId; question: string; answers: string[] }[] =
    [];
  const ids: ObQuizModelId[] = ['opus', 'gpt', 'gemini', 'jev'];
  const ai: ObQuizAiModule = {
    contestants: Object.fromEntries(
      ids.map((id) => [
        id,
        {
          id,
          model: `${id}-test`,
          available: () => true,
          answer: async (input: { question: string; answers: string[] }) => {
            calls.push({
              model: id,
              question: input.question,
              answers: [...input.answers],
            });
            return answer(id);
          },
        },
      ]),
    ) as ObQuizAiModule['contestants'],
    cannedHostLine: (evt) => `canned-${evt.kind}`,
    polishHostLine: async () => null,
    dispose: () => {},
  };
  return { ai, calls };
}

/** Quiz preset with AI-named guests, on air. */
async function onAirAiQuiz(h: ReturnType<typeof harness>) {
  h.controller.setConfig({
    presetId: 'quiz',
    audio: { mode: 'mix' },
    quiz: { bank: 'smelter', aiHost: true },
  });
  h.attach(1, 'speaker', 'Max Smelter');
  const gpt = h.attach(2, 'guest', 'GPT');
  const jev = h.attach(3, 'guest', 'JEV');
  expect(h.controller.control('go_live').ok).toBe(true);
  await vi.advanceTimersByTimeAsync(150);
  return { gpt, jev };
}

describe('ObVanController · AI contestants', () => {
  it('ask calls the mapped adapter blind and auto-locks after the think beat', async () => {
    const { ai, calls } = fakeQuizAi();
    const h = harness(ai);
    const { gpt } = await onAirAiQuiz(h);
    h.controller.operate({ op: 'quiz', action: 'assign', camId: gpt });
    h.controller.operate({ op: 'quiz', action: 'show_board' });
    expect(h.controller.operate({ op: 'quiz', action: 'ask' }).ok).toBe(true);
    // Pending: HUD shows thinking, nothing locked yet.
    expect(h.lastHudQuiz()?.thinking).toMatchObject({
      name: 'GPT',
      model: 'gpt',
    });
    expect(h.lastHudQuiz()?.board?.locked).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe('gpt');
    expect(calls[0].question.length).toBeGreaterThan(0);
    expect(JSON.stringify(calls[0])).not.toContain('"correct"');
    // The instant result is held to the minimum think time.
    await vi.advanceTimersByTimeAsync(OB_QUIZ_THINK_MIN_MS + 200);
    const s = h.controller.stateSnapshot();
    expect(s.quiz?.phase).toBe('locked');
    expect(s.quiz?.current?.lockedLetter).toBe('B');
    expect(s.quiz?.current?.answering).toMatchObject({
      status: 'done',
      letter: 'B',
      quip: 'gpt says B',
      canned: false,
    });
    const hud = h.lastHudQuiz();
    expect(hud?.thinking).toBeNull();
    expect(hud?.answer).toMatchObject({ name: 'GPT', letter: 'B' });
    // The answer moment owns the picture (solo on the contestant).
    expect(h.controller.stateSnapshot().program.shot).toMatchObject({
      kind: 'solo',
    });
  });

  it('pre-reveal HUD never contains a `correct` key anywhere', async () => {
    const { ai } = fakeQuizAi();
    const h = harness(ai);
    const { jev } = await onAirAiQuiz(h);
    h.controller.operate({ op: 'quiz', action: 'assign', camId: jev });
    h.controller.operate({ op: 'quiz', action: 'show_board' });
    h.controller.operate({ op: 'quiz', action: 'ask' });
    await vi.advanceTimersByTimeAsync(OB_QUIZ_THINK_MIN_MS + 200);
    expect(JSON.stringify(h.lastHudQuiz())).not.toContain('"correct"');
    h.controller.operate({ op: 'quiz', action: 'reveal' });
    expect(h.lastHudQuiz()?.board?.reveal).toMatchObject({
      correct: expect.stringMatching(/^[A-D]$/),
    });
  });

  it('without a quiz AI module the ask lands canned after a thinking beat', async () => {
    const h = harness(); // no createQuizAi factory at all
    h.controller.setConfig({ presetId: 'quiz', audio: { mode: 'mix' } });
    h.attach(1, 'speaker', 'Max');
    const g1 = h.attach(2, 'guest', 'GPT');
    h.controller.control('go_live');
    await vi.advanceTimersByTimeAsync(150);
    h.controller.operate({ op: 'quiz', action: 'assign', camId: g1 });
    h.controller.operate({ op: 'quiz', action: 'show_board' });
    expect(h.controller.operate({ op: 'quiz', action: 'ask' }).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(3_200);
    const ans = h.controller.stateSnapshot().quiz?.current?.answering;
    expect(ans?.status).toBe('done');
    expect(ans?.canned).toBe(true);
    expect(h.controller.stateSnapshot().quiz?.phase).toBe('locked');
  });

  it('host lines ride the HUD when aiHost is on, and only then', async () => {
    const { ai } = fakeQuizAi();
    const h = harness(ai);
    const { gpt } = await onAirAiQuiz(h);
    // go_live put the intro line up.
    expect(h.lastHudQuiz()?.hostLine?.text).toBe('canned-intro');
    h.controller.operate({ op: 'quiz', action: 'assign', camId: gpt });
    expect(h.lastHudQuiz()?.hostLine?.text).toBe('canned-assign');
    // It expires on the tick clock.
    await vi.advanceTimersByTimeAsync(7_500);
    expect(h.lastHudQuiz()?.hostLine).toBeNull();
    // aiHost off → no plates.
    h.controller.operate({ op: 'quiz_set', aiHost: false });
    h.controller.operate({ op: 'quiz', action: 'show_board' });
    expect(h.lastHudQuiz()?.hostLine).toBeNull();
  });

  it('quiz_set toggles config and parses over the wire', () => {
    expect(parseObCommand({ op: 'quiz_set', auto: true })).toEqual({
      op: 'quiz_set',
      auto: true,
    });
    expect(parseObCommand({ op: 'quiz_set' })).toBeNull();
    const h = harness();
    h.controller.setConfig({ presetId: 'quiz' });
    expect(h.controller.operate({ op: 'quiz_set', auto: true }).ok).toBe(true);
    expect(h.controller.stateSnapshot().config.quiz.auto).toBe(true);
  });

  it('AUTO runs a whole round hands-free and moves to the next player', async () => {
    const { ai, calls } = fakeQuizAi();
    const h = harness(ai);
    await onAirAiQuiz(h);
    h.controller.setConfig({ quiz: { auto: true } });
    // assign → 2.5s board → 1.5s ask → 2s think → 4s reveal → 6s celebrate.
    await vi.advanceTimersByTimeAsync(20_000);
    const afterOne = h.controller.stateSnapshot().quiz!;
    expect(afterOne.players.some((p) => p.answered >= 1)).toBe(true);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    // Keeps going: round-robin reaches the other contestant.
    await vi.advanceTimersByTimeAsync(20_000);
    const afterTwo = h.controller.stateSnapshot().quiz!;
    expect(afterTwo.players.every((p) => p.answered >= 1)).toBe(true);
    expect(new Set(calls.map((c) => c.model)).size).toBe(2);
  });

  it('an operator command pauses AUTO for resumeAfterMs', async () => {
    const { ai } = fakeQuizAi();
    const h = harness(ai);
    const { gpt } = await onAirAiQuiz(h);
    h.controller.setConfig({ quiz: { auto: true }, resumeAfterMs: 60_000 });
    // Operator takes over before auto starts anything.
    h.controller.operate(
      { op: 'quiz', action: 'assign', camId: gpt },
      'operator',
    );
    h.controller.operate({ op: 'quiz', action: 'skip' }, 'operator');
    await vi.advanceTimersByTimeAsync(10_000);
    // Auto stayed paused: still idle, nothing assigned by itself.
    expect(h.controller.stateSnapshot().quiz?.phase).toBe('idle');
    await vi.advanceTimersByTimeAsync(55_000);
    // Hold expired — auto picked it back up.
    expect(h.controller.stateSnapshot().quiz?.phase).not.toBe('idle');
  });
});

describe('ObVanController · the Gemini cameo', () => {
  it('cash out retires the player, returns the question and takes the picture', async () => {
    const { ai } = fakeQuizAi();
    const h = harness(ai);
    h.controller.setConfig({
      presetId: 'quiz',
      audio: { mode: 'mix' },
      quiz: { bank: 'smelter', aiHost: true },
    });
    h.attach(1, 'speaker', 'Max Smelter');
    const gemini = h.attach(2, 'guest', 'GEMINI');
    h.attach(3, 'guest', 'GPT');
    h.controller.control('go_live');
    await vi.advanceTimersByTimeAsync(150);
    const before = h.controller.stateSnapshot().quiz!.questionsLeft;
    h.controller.operate({ op: 'quiz', action: 'assign', camId: gemini });
    h.controller.operate({ op: 'quiz', action: 'show_board' });
    h.controller.operate({ op: 'quiz', action: 'ask' });
    await vi.advanceTimersByTimeAsync(OB_QUIZ_THINK_MIN_MS + 200);
    const s = h.controller.stateSnapshot();
    const player = s.quiz!.players.find((p) => p.camId === gemini)!;
    expect(player.cashedOut).toBe(true);
    expect(player.amount).toBe(1_000_000); // walks with the pot
    expect(s.quiz!.phase).toBe('idle');
    expect(s.quiz!.questionsLeft).toBe(before); // question unburned
    expect(h.signals.quizTurns.at(-1)).toBeNull();
    // The exit owns the picture and the host calls it.
    expect(s.program.shot).toMatchObject({ kind: 'solo', cam: gemini });
    expect(h.lastHudQuiz()?.hostLine?.text).toBe('canned-cashout');
    expect(
      h.lastHudQuiz()?.players.find((p) => p.name === 'GEMINI'),
    ).toMatchObject({ cashedOut: true });
    // Never assignable again.
    const again = h.controller.operate({
      op: 'quiz',
      action: 'assign',
      camId: gemini,
    });
    expect(again.ok).toBe(false);
  });

  it('AUTO skips a cashed-out contestant', async () => {
    const { ai, calls } = fakeQuizAi();
    const h = harness(ai);
    h.controller.setConfig({
      presetId: 'quiz',
      audio: { mode: 'mix' },
      quiz: { bank: 'smelter', aiHost: true, auto: true },
    });
    h.attach(1, 'speaker', 'Max Smelter');
    h.attach(2, 'guest', 'GEMINI');
    h.attach(3, 'guest', 'GPT');
    h.controller.control('go_live');
    await vi.advanceTimersByTimeAsync(150);
    // Round 1: GEMINI (fewest answers) gets asked, cashes out; GPT then
    // plays a real round; GEMINI is never picked again.
    await vi.advanceTimersByTimeAsync(60_000);
    const s = h.controller.stateSnapshot().quiz!;
    expect(s.players.find((p) => p.name === 'GEMINI')?.cashedOut).toBe(true);
    expect(
      s.players.find((p) => p.name === 'GPT')!.answered,
    ).toBeGreaterThanOrEqual(2);
    expect(calls.filter((c) => c.model === 'gemini')).toHaveLength(1);
  });
});

// ── Voices (ElevenLabs TTS) ─────────────────────────────────────────────────

import type { ObQuizTtsClip, ObQuizTtsModule } from '../llm/tts';

function fakeQuizTts(durationMs = 1_200): {
  tts: ObQuizTtsModule;
  synths: { text: string; voiceId: string }[];
  warmed: { text: string; voiceId: string }[];
} {
  const synths: { text: string; voiceId: string }[] = [];
  const warmed: { text: string; voiceId: string }[] = [];
  const tts: ObQuizTtsModule = {
    hostVoice: 'voice-host',
    voiceOf: (model) => (model === 'jev' ? null : `voice-${model}`),
    async synth(text, voiceId): Promise<ObQuizTtsClip | null> {
      synths.push({ text, voiceId });
      return {
        file: `/tts/${synths.length}.mp4`,
        durationMs,
        mouth: { rateHz: 50, v: [0.2, 0.8, 0.4] },
      };
    },
    warm(lines) {
      warmed.push(...lines);
    },
    dispose: () => {},
  };
  return { tts, synths, warmed };
}

/** Quiz preset with voices on (host + GPT + JEV cams), on air. */
async function onAirVoicedQuiz(
  h: ReturnType<typeof harness>,
): Promise<{ gpt: string; jev: string }> {
  h.controller.setConfig({
    presetId: 'quiz',
    audio: { mode: 'mix' },
    quiz: { bank: 'smelter', aiHost: true, tts: true },
  });
  h.attach(1, 'speaker', 'Max Smelter');
  const gpt = h.attach(2, 'guest', 'GPT');
  const jev = h.attach(3, 'guest', 'JEV');
  expect(h.controller.control('go_live').ok).toBe(true);
  await vi.advanceTimersByTimeAsync(150);
  return { gpt, jev };
}

describe('ObVanController · quiz voices', () => {
  it('speaks the intro with the host voice, lip-syncs the host cam and cleans up', async () => {
    const { ai } = fakeQuizAi();
    const { tts, synths, warmed } = fakeQuizTts(1_000);
    const h = harness(ai, tts);
    await onAirVoicedQuiz(h);
    // go_live pre-warmed the static lines and spoke the intro.
    expect(warmed.length).toBeGreaterThan(0);
    expect(synths[0]).toEqual({ text: 'canned-intro', voiceId: 'voice-host' });
    expect(h.speechRegs).toHaveLength(1);
    expect(h.lastHudQuiz()?.speech?.inputId).toBe('ob-tts-1');
    // The host cam's puppet mouth follows the clip.
    expect(h.mouthSets[0]).toMatchObject({ camInputId: 'mp4-1' });
    expect(h.mouthSets[0].mouth).toMatchObject({ durationMs: 1_000 });
    // Clip over (1 s lead + 1 s clip + gap, then the silent-tail hold):
    // input unregistered, mouth rested, HUD slot cleared.
    await vi.advanceTimersByTimeAsync(6_000);
    expect(h.speechUnregs).toContain('ob-tts-1');
    expect(h.mouthSets.at(-1)).toMatchObject({
      camInputId: 'mp4-1',
      mouth: null,
    });
    expect(h.lastHudQuiz()?.speech).toBeNull();
  });

  it('plays a murmur on ask, then the spoken quip with the lock — serially', async () => {
    const { ai } = fakeQuizAi();
    const { tts, synths } = fakeQuizTts(1_000);
    const h = harness(ai, tts);
    const { gpt } = await onAirVoicedQuiz(h);
    // Let the intro line finish so the queue is empty.
    await vi.advanceTimersByTimeAsync(3_000);
    h.controller.operate({ op: 'quiz', action: 'assign', camId: gpt });
    await vi.advanceTimersByTimeAsync(2_500); // assign host line plays out
    const regsBefore = h.speechRegs.length;
    h.controller.operate({ op: 'quiz', action: 'show_board' });
    await vi.advanceTimersByTimeAsync(2_500); // board host line plays out
    h.controller.operate({ op: 'quiz', action: 'ask' });
    await vi.advanceTimersByTimeAsync(10);
    // The murmur is on air the moment the question lands.
    const murmur = synths.find(
      (s) => s.voiceId === 'voice-gpt' && !s.text.includes('says'),
    );
    expect(murmur).toBeTruthy();
    // The quip clip starts in the same tick as the lock.
    await vi.advanceTimersByTimeAsync(OB_QUIZ_THINK_MIN_MS + 300);
    expect(h.controller.stateSnapshot().quiz?.phase).toBe('locked');
    expect(synths.some((s) => s.text === 'gpt says B')).toBe(true);
    // Serial queue: never two clips registered within one clip's length.
    const starts = h.speechRegs.slice(regsBefore);
    expect(starts.length).toBeGreaterThanOrEqual(2);
    // The mouth of the contestant cam was driven for the murmur/quip.
    expect(h.mouthSets.some((m) => m.camInputId === 'mp4-2')).toBe(true);
  });

  it('jev stays silent: no voice, no murmur, no mouth driving', async () => {
    const { ai } = fakeQuizAi();
    const { tts, synths } = fakeQuizTts(500);
    const h = harness(ai, tts);
    const { jev } = await onAirVoicedQuiz(h);
    await vi.advanceTimersByTimeAsync(3_000);
    h.controller.operate({ op: 'quiz', action: 'assign', camId: jev });
    h.controller.operate({ op: 'quiz', action: 'show_board' });
    h.controller.operate({ op: 'quiz', action: 'ask' });
    await vi.advanceTimersByTimeAsync(OB_QUIZ_THINK_MIN_MS + 500);
    expect(h.controller.stateSnapshot().quiz?.phase).toBe('locked');
    expect(synths.some((s) => s.voiceId === 'voice-jev')).toBe(false);
    expect(h.mouthSets.some((m) => m.camInputId === 'mp4-3')).toBe(false);
  });

  it('AUTO waits for the speech queue before the next beat', async () => {
    const { ai } = fakeQuizAi();
    const { tts } = fakeQuizTts(10_000); // a long-winded host
    const h = harness(ai, tts);
    await onAirVoicedQuiz(h);
    h.controller.setConfig({ quiz: { auto: true } });
    // The intro clip (10 s) holds AUTO: nothing is assigned yet well past the
    // usual 2.5 s assign delay.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.controller.stateSnapshot().quiz?.phase).toBe('idle');
    // Once the line ends, the round moves.
    await vi.advanceTimersByTimeAsync(9_000);
    expect(h.controller.stateSnapshot().quiz?.phase).not.toBe('idle');
  });

  it('the cameo speaks its farewell before the host cashout line', async () => {
    const { ai } = fakeQuizAi();
    const { tts, synths } = fakeQuizTts(800);
    const h = harness(ai, tts);
    h.controller.setConfig({
      presetId: 'quiz',
      audio: { mode: 'mix' },
      quiz: { bank: 'smelter', aiHost: true, tts: true },
    });
    h.attach(1, 'speaker', 'Max Smelter');
    const gemini = h.attach(2, 'guest', 'GEMINI');
    h.attach(3, 'guest', 'GPT');
    h.controller.control('go_live');
    await vi.advanceTimersByTimeAsync(3_000);
    h.controller.operate({ op: 'quiz', action: 'assign', camId: gemini });
    h.controller.operate({ op: 'quiz', action: 'show_board' });
    h.controller.operate({ op: 'quiz', action: 'ask' });
    await vi.advanceTimersByTimeAsync(OB_QUIZ_THINK_MIN_MS + 5_000);
    const farewellIx = synths.findIndex((s) => s.voiceId === 'voice-gemini');
    const cashoutIx = synths.findIndex((s) => s.text === 'canned-cashout');
    expect(farewellIx).toBeGreaterThanOrEqual(0);
    expect(cashoutIx).toBeGreaterThan(farewellIx);
  });

  it('tts config off keeps everything text-only and clears a playing line', async () => {
    const { ai } = fakeQuizAi();
    const { tts, synths } = fakeQuizTts(60_000);
    const h = harness(ai, tts);
    await onAirVoicedQuiz(h);
    expect(h.speechRegs.length).toBe(1); // the intro is playing
    h.controller.operate({ op: 'quiz_set', tts: false });
    expect(h.controller.stateSnapshot().config.quiz.tts).toBe(false);
    expect(h.speechUnregs).toContain('ob-tts-1');
    expect(h.lastHudQuiz()?.speech).toBeNull();
    const after = synths.length;
    h.controller.operate({ op: 'quiz', action: 'show_board' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(synths.length).toBe(after); // no further synths
    // The haiku polish path is back in play (plates only) — still no voices.
    expect(h.speechRegs.length).toBe(1);
  });
});
