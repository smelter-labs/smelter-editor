/**
 * OB Van — the host's hand gestures → operator commands (the `follow`
 * preset). The worker recognises a static gesture on the host's camera (hold
 * ½ s, 2 s cooldown); the controller maps it here and applies it through the
 * ordinary `operate()` path, so gesture effects behave exactly like an
 * operator pressing the FX buttons (and never pause the auto pilot — only
 * shot changes do).
 *
 * One obvious place to tweak the mapping; a per-show override in
 * `config.host` can come later if the demo wants it.
 */
import type {
  ObEffects,
  ObGestureName,
  ObOperatorCommand,
} from '@smelter-editor/types';
import { OB_GESTURE_NAMES } from '@smelter-editor/types';

/** Node-side guard on top of the worker's own gate (belt and braces). */
export const OB_GESTURE_COOLDOWN_MS = 2000;

export function isObGestureName(v: unknown): v is ObGestureName {
  return (
    typeof v === 'string' && (OB_GESTURE_NAMES as readonly string[]).includes(v)
  );
}

/**
 * The command a gesture triggers, given the effects currently on air:
 * open palm toggles the spotlight, thumbs-up grades neon, peace grades vhs,
 * a fist clears everything.
 */
export function obGestureCommand(
  name: ObGestureName,
  effects: ObEffects,
): ObOperatorCommand {
  switch (name) {
    case 'open_palm':
      return { op: 'fx', effects: { spotlight: !effects.spotlight } };
    case 'thumbs_up':
      return { op: 'fx', effects: { grade: 'neon' } };
    case 'peace':
      return { op: 'fx', effects: { grade: 'vhs' } };
    case 'fist':
      return { op: 'fx', effects: { grade: 'none', spotlight: false } };
  }
}

/** One short phrase for the log, e.g. `grade neon` or `spotlight on`. */
export function describeObGestureCommand(cmd: ObOperatorCommand): string {
  if (cmd.op !== 'fx') return cmd.op;
  const parts: string[] = [];
  if (cmd.effects.grade !== undefined)
    parts.push(
      cmd.effects.grade === 'none' ? 'clear' : `grade ${cmd.effects.grade}`,
    );
  if (cmd.effects.spotlight !== undefined)
    parts.push(`spotlight ${cmd.effects.spotlight ? 'on' : 'off'}`);
  return parts.join(' · ') || 'fx';
}
