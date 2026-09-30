import {
  OB_CONFIG_LIMITS,
  OB_PACING_DIAL_FACTOR,
  OB_RULESET_LIMITS,
  type ObPacingDial,
  type ObRuleset,
  type ObState,
} from '@smelter-editor/types';

// Pacing dial, auto-pilot resume and countdown maths for the host and panel.

export const PACING_OPTIONS: { value: ObPacingDial; label: string }[] = [
  { value: 'calm', label: 'CALM' },
  { value: 'lively', label: 'LIVELY' },
  { value: 'frantic', label: 'FRANTIC' },
];

export const PACING_BLURB: Record<ObPacingDial, string> = {
  calm: 'holds 1.6× longer',
  lively: 'the ruleset as written',
  frantic: 'cuts 0.6× sooner',
};

/** Min / max hold the dial produces from a ruleset (the server's multiplier). */
export function dialHold(
  ruleset: Pick<ObRuleset, 'pacing'>,
  dial: ObPacingDial,
): { minHoldMs: number; maxHoldMs: number } {
  const f = OB_PACING_DIAL_FACTOR[dial] ?? 1;
  const lim = OB_RULESET_LIMITS;
  const clamp = (v: number, l: { min: number; max: number }) =>
    Math.round(Math.min(l.max, Math.max(l.min, v)));
  return {
    minHoldMs: clamp(ruleset.pacing.minHoldMs * f, lim.minHoldMs),
    maxHoldMs: clamp(ruleset.pacing.maxHoldMs * f, lim.maxHoldMs),
  };
}

/** Hold the auto pilot works with right now: operator override, else the dial. */
export function effectiveHold(
  state: Pick<ObState, 'ruleset' | 'overrides' | 'config'>,
): { minHoldMs: number; maxHoldMs: number; overridden: boolean } {
  const base = dialHold(state.ruleset, state.config.pacingDial);
  const o = state.overrides.pacing;
  return {
    minHoldMs: o?.minHoldMs ?? base.minHoldMs,
    maxHoldMs: o?.maxHoldMs ?? base.maxHoldMs,
    overridden: o != null && (o.minHoldMs != null || o.maxHoldMs != null),
  };
}

export const RESUME_AFTER_S = { min: 5, max: 60, step: 5 } as const;

/** Resume-after in whole seconds within the UI range (server allows 0..120 s). */
export function clampResumeAfterMs(ms: unknown): number {
  const lim = OB_CONFIG_LIMITS.resumeAfterMs;
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return 20000;
  const s = Math.round(ms / 1000);
  const clamped = Math.min(RESUME_AFTER_S.max, Math.max(RESUME_AFTER_S.min, s));
  return Math.min(lim.max, Math.max(lim.min, clamped * 1000));
}

export const ANALYST_INTERVAL_S = { min: 10, max: 120, step: 5 } as const;

/** Analyst interval in the UI range (inside the server's 10..300 s). */
export function clampAnalystIntervalS(s: unknown): number {
  if (typeof s !== 'number' || !Number.isFinite(s)) return 15;
  const { min, max } = ANALYST_INTERVAL_S;
  return Math.min(max, Math.max(min, Math.round(s)));
}

/** Whole seconds left until `atMs` (server clock), never negative; null when unset. */
export function secondsUntil(
  atMs: number | null | undefined,
  serverNowMs: number,
): number | null {
  if (atMs == null) return null;
  return Math.max(0, Math.ceil((atMs - serverNowMs) / 1000));
}

/** `2.5 s`, `12 s`, `1:05` — hold / duration labels. */
export function formatSeconds(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 10) return `${(Math.round(s * 10) / 10).toString()} s`;
  if (s < 60) return `${Math.round(s)} s`;
  const whole = Math.round(s);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** `m:ss` / `h:mm:ss` clock for elapsed show time. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
