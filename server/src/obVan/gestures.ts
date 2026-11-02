/**
 * OB Van — the host's hand gestures → operator commands (the `follow`
 * preset). The worker recognises a static gesture on the host's camera (hold
 * ½ s, 1.2 s cooldown); the controller maps it here and applies it through the
 * ordinary `operate()` path. The command carries the camera id, so the effect
 * touches ONLY the picture the gesture was seen on — the show-wide FX buttons
 * stay untouched (and gestures never pause the auto pilot — only shot
 * changes do).
 *
 * One obvious place to tweak the mapping; a per-show override in
 * `config.host` can come later if the demo wants it.
 */
import type {
  ObCamFx,
  ObGestureName,
  ObOperatorCommand,
} from '@smelter-editor/types';
import { OB_GESTURE_NAMES } from '@smelter-editor/types';

/** Node-side guard on top of the worker's own gate (belt and braces). */
export const OB_GESTURE_COOLDOWN_MS = 1200;

export function isObGestureName(v: unknown): v is ObGestureName {
  return (
    typeof v === 'string' && (OB_GESTURE_NAMES as readonly string[]).includes(v)
  );
}

/**
 * The command a gesture triggers, scoped to the camera it was seen on (the
 * `camId` on the fx op): open palm toggles that camera's spotlight, thumbs-up
 * grades it neon, peace grades it vhs, a fist clears the camera's overrides.
 * `camFx` is the camera's current override state, for the spotlight toggle.
 */
export function obGestureCommand(
  name: ObGestureName,
  camId: string,
  camFx: ObCamFx,
): ObOperatorCommand {
  switch (name) {
    case 'open_palm':
      return { op: 'fx', camId, effects: { spotlight: !camFx.spotlight } };
    case 'thumbs_up':
      return { op: 'fx', camId, effects: { grade: 'neon' } };
    case 'peace':
      return { op: 'fx', camId, effects: { grade: 'vhs' } };
    case 'fist':
      return { op: 'fx', camId, effects: { grade: 'none', spotlight: false } };
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
