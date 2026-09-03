// Combo scoring — pure math over the per-character tuning that ships in the
// shared character catalog. The controller owns streak bookkeeping; this module
// only turns (streak, gap between kills, config) into a multiplier and points.

import {
  SHOOTER_CHARACTERS,
  type ShooterComboConfig,
} from '@smelter-editor/types';

/** Fallback for players with no (or an unknown) character. */
export const DEFAULT_COMBO_CONFIG: ShooterComboConfig = {
  windowMs: 2000,
  growth: 0.5,
  max: 3,
};

export function comboConfigFor(
  characterId: string | undefined,
): ShooterComboConfig {
  const c = SHOOTER_CHARACTERS.find((ch) => ch.id === characterId);
  return c?.combo ?? DEFAULT_COMBO_CONFIG;
}

/**
 * Multiplier for a kill that is the `streak`-th of its chain, landed `dtMs`
 * after the previous one:
 *
 *   min(max, 1 + growth * (streak - 1) * exp(-dtMs / windowMs))
 *
 * The first kill of a chain (streak 1) is always x1. Faster follow-ups decay
 * less, so both the kill count and the time between kills shape the value.
 */
export function comboMultiplier(
  streak: number,
  dtMs: number,
  cfg: ShooterComboConfig,
): number {
  if (streak <= 1) return 1;
  const decay = Math.exp(-Math.max(0, dtMs) / cfg.windowMs);
  return Math.min(cfg.max, 1 + cfg.growth * (streak - 1) * decay);
}

/** Points awarded for a kill at multiplier `mult` — rounded, never below 1. */
export function comboPoints(mult: number): number {
  return Math.max(1, Math.round(mult));
}
