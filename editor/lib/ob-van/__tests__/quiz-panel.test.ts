import { describe, expect, it } from 'vitest';
import type {
  ObConfig,
  ObPhase,
  ObQuizState,
  ObState,
} from '@smelter-editor/types';
import { OB_DEFAULT_CONFIG } from '@smelter-editor/types';
import { quizBarModel } from '../quiz-panel';

function quizState(patch: Partial<ObQuizState> = {}): ObQuizState {
  return {
    phase: 'idle',
    players: [
      {
        camId: 'g1',
        name: 'Alice',
        model: null,
        amount: 1_500_000,
        amountFrom: 1_000_000,
        amountChangedAtMs: 100,
        lifelineUsed: false,
        answered: 1,
        correctCount: 1,
        cashedOut: false,
        live: true,
      },
      {
        camId: 'g2',
        name: 'Bob',
        model: null,
        amount: 1_000_000,
        amountFrom: 1_000_000,
        amountChangedAtMs: null,
        lifelineUsed: true,
        answered: 0,
        correctCount: 0,
        cashedOut: false,
        live: false,
      },
    ],
    questionsLeft: 5,
    current: null,
    hint: null,
    ...patch,
  };
}

function state(
  quiz: ObQuizState | null,
  over: { phase?: ObPhase; config?: Partial<ObConfig> } = {},
): Pick<ObState, 'config' | 'quiz' | 'phase'> {
  return {
    phase: over.phase ?? 'on-air',
    config: {
      ...structuredClone(OB_DEFAULT_CONFIG),
      presetId: 'quiz',
      ...over.config,
    },
    quiz,
  };
}

const question = (patch = {}): NonNullable<ObQuizState['current']> => ({
  questionId: 'q1',
  number: 3,
  forCamId: 'g1',
  q: 'What?',
  answers: ['a', 'b', 'c', 'd'],
  correct: 'B',
  shownAtMs: null,
  lockedLetter: null,
  lockedAtMs: null,
  verdict: null,
  revealedAtMs: null,
  delta: 0,
  answering: null,
  ...patch,
});

describe('quizBarModel', () => {
  it('is null off the quiz preset or without server quiz state', () => {
    expect(
      quizBarModel(state(quizState(), { config: { presetId: 'talk' } })),
    ).toBeNull();
    expect(quizBarModel(state(null))).toBeNull();
  });

  it('formats money and marks who is assignable (live, idle phase)', () => {
    const m = quizBarModel(state(quizState()))!;
    expect(m.players[0]).toMatchObject({
      money: '1,500,000 TOK',
      assignable: true,
      active: false,
    });
    expect(m.players[1].assignable).toBe(false); // not live
    expect(m.question).toBeNull();
    expect(m.canShowBoard).toBe(false);
    expect(m.canSkip).toBe(false);
  });

  it('nobody is assignable off-air or with an empty bank', () => {
    const offAir = quizBarModel(state(quizState(), { phase: 'setup' }))!;
    expect(offAir.players.every((p) => !p.assignable)).toBe(true);
    const empty = quizBarModel(state(quizState({ questionsLeft: 0 })))!;
    expect(empty.players.every((p) => !p.assignable)).toBe(true);
  });

  it('walks the question through assigned → board → locked → revealed', () => {
    const assigned = quizBarModel(
      state(quizState({ phase: 'assigned', current: question() })),
    )!;
    expect(assigned.canShowBoard).toBe(true);
    expect(assigned.canLock).toBe(false);
    expect(assigned.canOverride).toBe(false);
    expect(assigned.canSkip).toBe(true);
    expect(assigned.players[0].active).toBe(true);
    expect(assigned.question?.forName).toBe('Alice');
    expect(assigned.question?.answers[1]).toMatchObject({
      letter: 'B',
      correct: true,
    });

    const board = quizBarModel(
      state(quizState({ phase: 'board', current: question({ shownAtMs: 5 }) })),
    )!;
    expect(board.boardShown).toBe(true);
    expect(board.canHideBoard).toBe(true);
    expect(board.canLock).toBe(true);
    expect(board.canReveal).toBe(false);
    expect(board.canOverride).toBe(true);

    const locked = quizBarModel(
      state(
        quizState({
          phase: 'locked',
          current: question({ shownAtMs: 5, lockedLetter: 'C' }),
        }),
      ),
    )!;
    expect(locked.canReveal).toBe(true);
    expect(locked.canLock).toBe(true); // change of heart allowed
    expect(locked.question?.locked).toBe('C');

    const revealed = quizBarModel(
      state(
        quizState({
          phase: 'revealed',
          current: question({
            shownAtMs: 5,
            lockedLetter: 'C',
            verdict: 'wrong',
            revealedAtMs: 9,
            delta: -500_000,
          }),
        }),
      ),
    )!;
    expect(revealed.canReveal).toBe(false);
    expect(revealed.question?.verdict).toBe('wrong');
    expect(revealed.players[0].assignable).toBe(true); // next question may go out
  });

  it('exposes ask: board up, nothing in flight, and the answering row', () => {
    const board = quizBarModel(
      state(quizState({ phase: 'board', current: question({ shownAtMs: 5 }) })),
    )!;
    expect(board.canAsk).toBe(true);
    expect(board.answering).toBeNull();
    const pending = quizBarModel(
      state(
        quizState({
          phase: 'board',
          current: question({
            shownAtMs: 5,
            answering: {
              seq: 1,
              status: 'pending',
              model: 'gpt',
              startedAtMs: 7,
              answeredAtMs: null,
              letter: null,
              quip: null,
              confidence: null,
              canned: false,
            },
          }),
        }),
      ),
    )!;
    expect(pending.canAsk).toBe(false);
    expect(pending.answering?.status).toBe('pending');
    const idle = quizBarModel(state(quizState()))!;
    expect(idle.canAsk).toBe(false);
  });

  it('carries player model badges and the config toggles', () => {
    const withModel = quizState();
    withModel.players[0].model = 'opus';
    const m = quizBarModel(
      state(withModel, {
        config: { quiz: { bank: 'smelter', aiHost: true, auto: true } },
      }),
    )!;
    expect(m.players[0].model).toBe('opus');
    expect(m.players[1].model).toBeNull();
    expect(m.auto).toBe(true);
    expect(m.aiHost).toBe(true);
  });

  it('gates the lifeline on the active player and a pending hint', () => {
    const base = quizState({ phase: 'assigned', current: question() });
    expect(quizBarModel(state(base))!.canLifeline).toBe(true);
    const used = quizState({
      phase: 'assigned',
      current: question({ forCamId: 'g2' }),
    });
    expect(quizBarModel(state(used))!.canLifeline).toBe(false); // Bob burned his
    const pending = quizState({
      phase: 'assigned',
      current: question(),
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
    });
    const m = quizBarModel(state(pending))!;
    expect(m.canLifeline).toBe(false);
    expect(m.lifelinePending).toBe(true);
  });
});
