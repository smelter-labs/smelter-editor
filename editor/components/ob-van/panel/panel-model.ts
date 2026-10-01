import type { ObState } from '@smelter-editor/types';
import { secondsUntil } from '@/lib/ob-van/pacing';
import { quizBarModel } from '@/lib/ob-van/quiz-panel';
import type { PanelKeyContext } from './panel-keys';

// Small pure derivations of the desk from `ObState`, shared by the panel
// screen and its bars (and covered by node tests).

/** REPLAY is offered for the match preset or a ruleset with burst replay. */
export function isReplayEnabled(
  state: Pick<ObState, 'config' | 'ruleset'>,
): boolean {
  return (
    state.config.presetId === 'match' ||
    state.ruleset.behaviours?.burstReplay === true
  );
}

/** The keyboard map's view of the desk. */
export function panelKeyContextOf(state: ObState): PanelKeyContext {
  const quiz = quizBarModel(state);
  return {
    cams: state.cams,
    preview: state.preview,
    program: state.program.shot,
    autoOn: state.autoPilot.on,
    transitionType: state.config.transition.type,
    lowerThirdCamId: state.lowerThird?.camId ?? null,
    rundownLength: state.rundown.items.length,
    replayEnabled: isReplayEnabled(state),
    quiz: quiz
      ? {
          phase: quiz.phase,
          canReveal: quiz.canReveal,
          canLifeline: quiz.canLifeline,
        }
      : null,
  };
}

export type AutopilotStatus =
  | { kind: 'off' }
  | { kind: 'on' }
  | { kind: 'paused'; resumesInS: number };

/** ON / PAUSED (a manual action, resumes in N s) / OFF at server time `nowMs`. */
export function autopilotStatus(
  autoPilot: Pick<ObState['autoPilot'], 'on' | 'pausedUntilMs'>,
  nowMs: number,
): AutopilotStatus {
  if (!autoPilot.on) return { kind: 'off' };
  const left = secondsUntil(autoPilot.pausedUntilMs, nowMs);
  if (
    left != null &&
    autoPilot.pausedUntilMs != null &&
    autoPilot.pausedUntilMs > nowMs
  )
    return { kind: 'paused', resumesInS: left };
  return { kind: 'on' };
}
