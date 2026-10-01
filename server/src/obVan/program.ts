/**
 * The OB Van program bus as a pure state machine: what is on PROGRAM and
 * PREVIEW, the transition in flight (A → B), the dip-to-black envelope and
 * the air-time scheduling rule for auto / LLM decisions. No timers, no deps:
 * the controller owns the clock and the side effects, this file decides.
 */
import type {
  ObActionSource,
  ObShot,
  ObTally,
  ObTransition,
  ObTransitionType,
} from '@smelter-editor/types';
import { OB_TRANSITION_LIMITS, obShotCams } from '@smelter-editor/types';

/** Dip-to-black envelope drawn by the HUD (opacity of a black plate). */
export type ObDip = {
  startedAtMs: number;
  inMs: number;
  holdMs: number;
  outMs: number;
};

/** A program change in flight. */
export type ObLiveTransition = {
  type: ObTransitionType;
  startedAtMs: number;
  durationMs: number;
  from: ObShot | null;
  to: ObShot;
  /**
   * fade / dip: the picture switches at this moment (under full black);
   * null = the stage switches at `startedAtMs` (dissolve, wipe, punch).
   */
  cutAtMs: number | null;
  /** The outgoing picture is gone and the transition is over. */
  settleAtMs: number;
};

export type ObProgramState = {
  program: ObShot | null;
  /** When the current program went (or goes, for fade / dip) on air. */
  sinceMs: number;
  source: ObActionSource;
  preview: ObShot | null;
  transition: ObLiveTransition | null;
  dip: ObDip | null;
  /** Monotonic guard for scheduled changes (never two at the same ms). */
  lastApplyAtMs: number;
};

/** Standalone `dip` / `dip` transition envelope. */
export const OB_DIP_FADE_MS = 300;
export const OB_DIP_HOLD_MS = 400;
/** A scheduled change further than this in the past is dropped. */
export const OB_LATE_SKIP_MS = 2000;

export function initialProgram(now: number): ObProgramState {
  return {
    program: null,
    sinceMs: now,
    source: 'system',
    preview: null,
    transition: null,
    dip: null,
    lastApplyAtMs: 0,
  };
}

const clampMs = (v: number, lim: { min: number; max: number }) =>
  Math.min(lim.max, Math.max(lim.min, Math.round(v)));

/** Effective duration of a transition (cut → 0; clamped to the limits). */
export function transitionDurationMs(t: ObTransition): number {
  if (t.type === 'cut') return 0;
  if (t.type === 'dip') {
    const hold = clampMs(
      t.holdMs ?? OB_DIP_HOLD_MS,
      OB_TRANSITION_LIMITS.holdMs,
    );
    return OB_DIP_FADE_MS * 2 + hold;
  }
  return clampMs(t.durationMs, OB_TRANSITION_LIMITS.durationMs);
}

/** The dip envelope a transition needs (fade = through black, dip = hold). */
export function dipFor(t: ObTransition, now: number): ObDip | null {
  if (t.type === 'fade') {
    const d = transitionDurationMs(t);
    if (d <= 0) return null;
    const half = Math.round(d / 2);
    return { startedAtMs: now, inMs: half, holdMs: 0, outMs: d - half };
  }
  if (t.type === 'dip') return standaloneDip(now, t.holdMs);
  return null;
}

export function standaloneDip(now: number, holdMs?: number): ObDip {
  return {
    startedAtMs: now,
    inMs: OB_DIP_FADE_MS,
    holdMs: clampMs(holdMs ?? OB_DIP_HOLD_MS, OB_TRANSITION_LIMITS.holdMs),
    outMs: OB_DIP_FADE_MS,
  };
}

export function dipEndsAt(dip: ObDip): number {
  return dip.startedAtMs + dip.inMs + dip.holdMs + dip.outMs;
}

/** Black plate opacity at wall time `now` (0 before / after, 1 on hold). */
export function dipOpacity(dip: ObDip | null, now: number): number {
  if (!dip) return 0;
  const t = now - dip.startedAtMs;
  if (t < 0) return 0;
  if (t < dip.inMs) return dip.inMs > 0 ? t / dip.inMs : 1;
  if (t < dip.inMs + dip.holdMs) return 1;
  const out = t - dip.inMs - dip.holdMs;
  if (out < dip.outMs) return dip.outMs > 0 ? 1 - out / dip.outMs : 0;
  return 0;
}

export type ObBeginOptions = {
  source: ObActionSource;
  /** TAKE from preview: the old program lands on preview (mixer swap). */
  swapPreview?: boolean;
};

/**
 * Put `shot` on program with `transition`. A transition still in flight is
 * finished first (the caller parks its outgoing picture). Pure: returns the
 * next state and the live transition (null = a hard cut, done at once).
 */
export function begin(
  state: ObProgramState,
  shot: ObShot,
  transition: ObTransition,
  now: number,
  opts: ObBeginOptions,
): { state: ObProgramState; live: ObLiveTransition | null } {
  const base = finishTransition(state);
  const from = base.program;
  const d = transitionDurationMs(transition);
  const preview = opts.swapPreview ? from : base.preview;
  if (d <= 0 || from == null) {
    // Nothing to transition from (first shot) or a hard cut.
    const dip = transition.type === 'dip' ? dipFor(transition, now) : null;
    return {
      state: {
        ...base,
        program: shot,
        sinceMs: now,
        source: opts.source,
        preview,
        dip: dip ?? base.dip,
        lastApplyAtMs: Math.max(base.lastApplyAtMs, now),
      },
      live: null,
    };
  }
  const dip = dipFor(transition, now);
  const cutAtMs = dip ? now + dip.inMs : null;
  const live: ObLiveTransition = {
    type: transition.type,
    startedAtMs: now,
    durationMs: d,
    from,
    to: shot,
    cutAtMs,
    settleAtMs: now + d,
  };
  return {
    state: {
      ...base,
      program: shot,
      sinceMs: cutAtMs ?? now,
      source: opts.source,
      preview,
      transition: live,
      dip: dip ?? base.dip,
      lastApplyAtMs: Math.max(base.lastApplyAtMs, now),
    },
    live,
  };
}

/** Drop the transition in flight (its outgoing picture is gone). */
export function finishTransition(state: ObProgramState): ObProgramState {
  return state.transition ? { ...state, transition: null } : state;
}

/** Clear what has run its course by `now` (transition, dip). */
export function settle(state: ObProgramState, now: number): ObProgramState {
  let next = state;
  if (next.transition && now >= next.transition.settleAtMs)
    next = { ...next, transition: null };
  if (next.dip && now >= dipEndsAt(next.dip)) next = { ...next, dip: null };
  return next;
}

/** The shot the STAGE shows at `now` (fade / dip keep the old one until the cut). */
export function stagedShot(state: ObProgramState, now: number): ObShot | null {
  const t = state.transition;
  if (t && t.cutAtMs != null && now < t.cutAtMs) return t.from;
  return state.program;
}

/** Cameras on air: program + the outgoing shot while a transition runs. */
export function onAirCams(state: ObProgramState): string[] {
  const out = state.program ? obShotCams(state.program) : [];
  const from = state.transition?.from;
  if (from) for (const c of obShotCams(from)) if (!out.includes(c)) out.push(c);
  return out;
}

/** Tally per camera: program (red) wins over preview (green). */
export function tallyOf(
  state: ObProgramState,
  camIds: readonly string[],
): Record<string, ObTally> {
  const onAir = new Set(onAirCams(state));
  const preview = new Set(state.preview ? obShotCams(state.preview) : []);
  const out: Record<string, ObTally> = {};
  for (const id of camIds) {
    out[id] = onAir.has(id) ? 'program' : preview.has(id) ? 'preview' : 'off';
  }
  return out;
}

/**
 * When a change meant to land at air time `atAirMs` is applied: never in the
 * past, never at the same ms as the previous one. Null = too late (more than
 * OB_LATE_SKIP_MS behind), skip it; `late` = behind but still applied now.
 */
export function scheduleAt(
  atAirMs: number,
  now: number,
  lastApplyAtMs: number,
  lateSkipMs = OB_LATE_SKIP_MS,
): { applyAtMs: number; late: boolean } | null {
  if (atAirMs < now - lateSkipMs) return null;
  return {
    applyAtMs: Math.max(atAirMs, now, lastApplyAtMs + 1),
    late: atAirMs < now,
  };
}
