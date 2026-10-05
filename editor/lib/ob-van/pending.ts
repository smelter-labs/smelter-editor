import {
  obShotsEqual,
  type ObOperatorCommand,
  type ObState,
} from '@smelter-editor/types';

// Pending-until-echo (the KBT view-switcher pattern): a desk press marks its
// command pending, repeated presses of the same thing are ignored, and the
// mark clears when `ob_state` shows the change (or after a short timeout —
// the server may have refused it). Pure so the node tests cover the echo
// rules.

export const PENDING_TIMEOUT_MS = 1500;

/**
 * Identity of a press: `op` plus the argument that makes two presses "the
 * same" (preview CAM 2 vs preview CAM 3 are different presses; two TAKEs
 * are the same).
 */
export function pendingKeyOf(cmd: ObOperatorCommand): string {
  switch (cmd.op) {
    case 'preview':
      return `preview:${JSON.stringify(cmd.shot)}`;
    case 'shot':
      return `shot:${cmd.mode}:${JSON.stringify(cmd.shot)}`;
    case 'take':
    case 'cut':
      // TAKE and CUT both change the program: one in flight at a time.
      return 'program';
    case 'transition':
      return 'transition';
    case 'fx':
      return `fx:${Object.keys(cmd.effects).sort().join(',')}`;
    case 'lower_third':
      return cmd.clear ? 'lower_third:clear' : `lower_third:${cmd.camId ?? ''}`;
    case 'auto':
      return 'auto';
    case 'segment':
      return 'segment';
    case 'audio':
      return 'audio';
    case 'replay':
      return 'replay';
    case 'title_bug':
      return 'title_bug';
    case 'dip':
      return 'dip';
    case 'cam':
      return `cam:${cmd.action}:${cmd.camId}`;
    case 'pacing':
      return 'pacing';
    case 'prefer_cam':
      return `prefer_cam:${cmd.camId}`;
    case 'note':
      return 'note';
    case 'quiz':
      // A re-lock of another letter is a new press; everything else is one
      // in-flight action of its kind.
      return cmd.action === 'lock'
        ? `quiz:lock:${cmd.letter ?? ''}`
        : `quiz:${cmd.action}`;
    case 'quiz_set':
      return `quiz_set:${cmd.auto !== undefined ? 'auto' : ''}${cmd.aiHost !== undefined ? 'aiHost' : ''}`;
  }
}

/** The server state shows the command took effect. */
export function commandEchoed(
  cmd: ObOperatorCommand,
  before: ObState | null,
  now: ObState,
): boolean {
  switch (cmd.op) {
    case 'preview':
      return obShotsEqual(now.preview, cmd.shot);
    case 'shot':
      return cmd.mode === 'preview'
        ? obShotsEqual(now.preview, cmd.shot)
        : obShotsEqual(now.program.shot, cmd.shot);
    case 'take':
    case 'cut':
    case 'dip':
      return before == null || now.program.sinceMs !== before.program.sinceMs;
    case 'transition': {
      const t = now.config.transition;
      return (
        (cmd.transition.type == null || t.type === cmd.transition.type) &&
        (cmd.transition.durationMs == null ||
          t.durationMs === cmd.transition.durationMs)
      );
    }
    case 'fx':
      return (Object.keys(cmd.effects) as (keyof typeof cmd.effects)[]).every(
        (k) => now.effects[k] === cmd.effects[k],
      );
    case 'lower_third':
      if (cmd.clear) return now.lowerThird == null;
      return (
        now.lowerThird != null &&
        (cmd.camId == null || now.lowerThird.camId === cmd.camId) &&
        (before?.lowerThird == null ||
          now.lowerThird.startedAtMs !== before.lowerThird.startedAtMs)
      );
    case 'auto':
      return now.autoPilot.on === cmd.enabled;
    case 'segment':
      if (cmd.action === 'goto') return now.rundown.index === cmd.index;
      return before == null || now.rundown.index !== before.rundown.index;
    case 'audio':
      return JSON.stringify(now.audio) === JSON.stringify(cmd.audio);
    case 'replay':
      return now.replay != null;
    case 'title_bug':
      return cmd.visible == null || now.titleBug.visible === cmd.visible;
    case 'quiz': {
      const quiz = now.quiz;
      if (!quiz) return true;
      switch (cmd.action) {
        case 'assign':
          return (
            quiz.current != null &&
            (cmd.camId == null || quiz.current.forCamId === cmd.camId)
          );
        case 'show_board':
          return quiz.current?.shownAtMs != null;
        case 'hide_board':
          return quiz.current == null || quiz.current.shownAtMs == null;
        case 'lock':
          return quiz.current?.lockedLetter === cmd.letter;
        case 'reveal':
          return quiz.phase === 'revealed' || quiz.phase === 'idle';
        case 'lifeline':
          return quiz.hint != null;
        case 'skip':
          return quiz.current == null;
        case 'reset':
          return true;
      }
      return true;
    }
    case 'quiz_set':
      return (
        (cmd.auto == null || now.config.quiz?.auto === cmd.auto) &&
        (cmd.aiHost == null || now.config.quiz?.aiHost === cmd.aiHost)
      );
    default:
      // No visible echo to wait for — clear on the next state.
      return true;
  }
}
