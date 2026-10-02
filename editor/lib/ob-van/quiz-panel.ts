import type {
  ObQuizLetter,
  ObQuizPhase,
  ObQuizState,
  ObState,
} from '@smelter-editor/types';
import { OB_QUIZ_LETTERS, obQuizFormatMoney } from '@smelter-editor/types';

// Pure derivations of the Smelterionaire desk from `ObState` (node-tested,
// like panel-model.ts). The QuizBar renders this model; the correct letter
// lives ONLY here on the desk — the program HUD never sees it pre-reveal.

export { obQuizFormatMoney, OB_QUIZ_LETTERS };
export type { ObQuizLetter, ObQuizPhase };

export type QuizPlayerRow = {
  camId: string;
  name: string;
  money: string;
  lifelineUsed: boolean;
  live: boolean;
  /** This player is under the current question. */
  active: boolean;
  /** Clicking assigns the next question to them. */
  assignable: boolean;
};

export type QuizQuestionCard = {
  number: number;
  forName: string;
  q: string;
  answers: { letter: ObQuizLetter; text: string; correct: boolean }[];
  locked: ObQuizLetter | null;
  verdict: 'correct' | 'wrong' | null;
};

export type QuizBarModel = {
  phase: ObQuizPhase;
  onAir: boolean;
  questionsLeft: number;
  players: QuizPlayerRow[];
  question: QuizQuestionCard | null;
  boardShown: boolean;
  canShowBoard: boolean;
  canHideBoard: boolean;
  canLock: boolean;
  canReveal: boolean;
  /** Manual verdict override (open judgment call) — no lock needed. */
  canOverride: boolean;
  canLifeline: boolean;
  lifelinePending: boolean;
  canSkip: boolean;
};

/** Null unless the QUIZ preset is on and the server reports quiz state. */
export function quizBarModel(
  state: Pick<ObState, 'config' | 'quiz' | 'phase'>,
): QuizBarModel | null {
  const quiz: ObQuizState | null | undefined =
    state.config.presetId === 'quiz' ? state.quiz : null;
  if (!quiz) return null;
  const phase = quiz.phase;
  const onAir = state.phase === 'on-air';
  const c = quiz.current;
  const assignable =
    onAir &&
    (phase === 'idle' || phase === 'revealed') &&
    quiz.questionsLeft > 0;
  const activePlayer = c
    ? quiz.players.find((p) => p.camId === c.forCamId)
    : undefined;
  const inQuestion =
    phase === 'assigned' || phase === 'board' || phase === 'locked';
  return {
    phase,
    onAir,
    questionsLeft: quiz.questionsLeft,
    players: quiz.players.map((p) => ({
      camId: p.camId,
      name: p.name,
      money: obQuizFormatMoney(p.amount),
      lifelineUsed: p.lifelineUsed,
      live: p.live,
      active: c?.forCamId === p.camId,
      assignable: assignable && p.live,
    })),
    question: c
      ? {
          number: c.number,
          forName: activePlayer?.name ?? '',
          q: c.q,
          answers: OB_QUIZ_LETTERS.map((letter, i) => ({
            letter,
            text: c.answers[i],
            correct: c.correct === letter,
          })),
          locked: c.lockedLetter,
          verdict: c.verdict,
        }
      : null,
    boardShown: c?.shownAtMs != null,
    canShowBoard: onAir && phase === 'assigned',
    canHideBoard: onAir && phase === 'board',
    canLock: onAir && (phase === 'board' || phase === 'locked'),
    canReveal: onAir && phase === 'locked',
    canOverride: onAir && (phase === 'board' || phase === 'locked'),
    canLifeline:
      onAir &&
      inQuestion &&
      activePlayer != null &&
      !activePlayer.lifelineUsed &&
      quiz.hint?.status !== 'pending',
    lifelinePending: quiz.hint?.status === 'pending',
    canSkip: onAir && inQuestion,
  };
}
