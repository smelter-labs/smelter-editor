import {
  OB_TRANSITION_TYPES,
  type ObCam,
  type ObOperatorCommand,
  type ObQuizLetter,
  type ObQuizPhase,
  type ObShot,
  type ObTransitionType,
} from '@smelter-editor/types';
import { mainCamOf } from '@/lib/ob-van/tally';

// The desk keyboard map, shared by the operator panel and the host's ON AIR
// screen. Pure: a key + what the desk shows → one command (or nothing).
//
//   1..9   preview camera N          Enter  TAKE (preview → program)
//   Space  CUT (also `.`)            A      auto pilot on / off
//   L      lower third on preview    T      next transition type
//   N      next rundown segment      R      replay (when the preset has it)
//
// With the QUIZ board up, the letters take over (A stops being AUTO):
//   Q      board on / off            A B C D  lock that letter
//   V      REVEAL                    G / W    override correct / wrong
//   H      ASK AI (lifeline)

export type PanelKeyQuizContext = {
  phase: ObQuizPhase;
  canReveal: boolean;
  canLifeline: boolean;
};

export type PanelKeyContext = {
  cams: readonly Pick<ObCam, 'id' | 'number' | 'connected'>[];
  preview: ObShot | null;
  program: ObShot | null;
  autoOn: boolean;
  transitionType: ObTransitionType;
  /** Camera the active lower third sits on (null = none on air). */
  lowerThirdCamId: string | null;
  rundownLength: number;
  replayEnabled: boolean;
  /** Non-null while the QUIZ preset runs. */
  quiz: PanelKeyQuizContext | null;
};

export const PANEL_KEY_HINTS: { key: string; label: string }[] = [
  { key: '1-8', label: 'PREVIEW' },
  { key: 'ENTER', label: 'TAKE' },
  { key: 'SPACE', label: 'CUT' },
  { key: 'A', label: 'AUTO' },
  { key: 'L', label: 'LOWER THIRD' },
  { key: 'T', label: 'TRANSITION' },
  { key: 'N', label: 'NEXT' },
];

export const QUIZ_KEY_HINTS: { key: string; label: string }[] = [
  { key: 'Q', label: 'BOARD' },
  { key: 'A-D', label: 'LOCK' },
  { key: 'V', label: 'REVEAL' },
  { key: 'G/W', label: 'OVERRIDE' },
  { key: 'H', label: 'ASK AI' },
];

/** The letters steal A–D from the desk only while the board is up. */
export function quizLettersActive(
  quiz: PanelKeyQuizContext | null,
): quiz is PanelKeyQuizContext {
  return quiz != null && (quiz.phase === 'board' || quiz.phase === 'locked');
}

function quizKeyToCommand(
  key: string,
  quiz: PanelKeyQuizContext,
): ObOperatorCommand | null {
  const upper = key.toUpperCase();
  if (quizLettersActive(quiz) && /^[A-D]$/.test(upper))
    return { op: 'quiz', action: 'lock', letter: upper as ObQuizLetter };
  switch (upper) {
    case 'Q':
      if (quiz.phase === 'assigned')
        return { op: 'quiz', action: 'show_board' };
      if (quiz.phase === 'board') return { op: 'quiz', action: 'hide_board' };
      return null;
    case 'V':
      return quiz.canReveal ? { op: 'quiz', action: 'reveal' } : null;
    case 'G':
      return quiz.phase === 'board' || quiz.phase === 'locked'
        ? { op: 'quiz', action: 'reveal', verdict: 'correct' }
        : null;
    case 'W':
      return quiz.phase === 'board' || quiz.phase === 'locked'
        ? { op: 'quiz', action: 'reveal', verdict: 'wrong' }
        : null;
    case 'H':
      return quiz.canLifeline ? { op: 'quiz', action: 'lifeline' } : null;
    default:
      return null;
  }
}

export function nextTransitionType(t: ObTransitionType): ObTransitionType {
  const i = OB_TRANSITION_TYPES.indexOf(t);
  return OB_TRANSITION_TYPES[(i + 1) % OB_TRANSITION_TYPES.length];
}

export function panelKeyToCommand(
  key: string,
  ctx: PanelKeyContext,
): ObOperatorCommand | null {
  if (/^[1-9]$/.test(key)) {
    const cam = ctx.cams.find((c) => c.number === Number(key));
    if (!cam) return null;
    return { op: 'preview', shot: { kind: 'solo', cam: cam.id } };
  }
  if (ctx.quiz) {
    const quizCmd = quizKeyToCommand(key, ctx.quiz);
    if (quizCmd) return quizCmd;
    // With the board up, A belongs to the letters even when the lock refuses
    // — a missed A must not silently toggle the auto pilot mid-question.
    if (quizLettersActive(ctx.quiz) && /^[a-dA-D]$/.test(key)) return null;
  }
  switch (key) {
    case 'Enter':
      return ctx.preview ? { op: 'take' } : null;
    case ' ':
    case '.':
      return ctx.preview ? { op: 'cut' } : null;
    case 'a':
    case 'A':
      return { op: 'auto', enabled: !ctx.autoOn };
    case 'l':
    case 'L': {
      const camId = mainCamOf(ctx.preview) ?? mainCamOf(ctx.program);
      if (!camId) return null;
      return ctx.lowerThirdCamId === camId
        ? { op: 'lower_third', clear: true }
        : { op: 'lower_third', camId };
    }
    case 't':
    case 'T':
      return {
        op: 'transition',
        transition: { type: nextTransitionType(ctx.transitionType) },
      };
    case 'n':
    case 'N':
      return ctx.rundownLength > 0 ? { op: 'segment', action: 'next' } : null;
    case 'r':
    case 'R': {
      if (!ctx.replayEnabled) return null;
      const camId = mainCamOf(ctx.program);
      return camId ? { op: 'replay', camId } : { op: 'replay' };
    }
    default:
      return null;
  }
}
