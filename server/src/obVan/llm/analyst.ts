/**
 * OB Van LLM — the periodic situation analyst.
 *
 * Every `intervalS` (default 15, min 10) while the show is ON AIR, if the
 * situation changed (segment, program, last cut, roster, new caption words)
 * and no call is in flight, it sends a compact report + the last minute of
 * captions and lets the model nudge the show with ≤ 3 bounded actions (tool
 * `direct`). Each action is validated (camera numbers must exist, names must
 * have been heard or be a talent field, numbers clamped) and applied through
 * the controller's command path with source 'llm'.
 *
 * Failures: rate / net → exponential backoff (×2, starting at the interval,
 * capped at 5 min); 3 consecutive api errors → the analyst turns itself off;
 * budget spent → off. Timers are injectable so tests drive `tick()` directly.
 */
import {
  OB_CONFIG_LIMITS,
  OB_RULESET_LIMITS,
  type ObLogEntry,
  type ObOperatorCommand,
  type ObPhase,
} from '@smelter-editor/types';
import type { ObSituation } from '../contracts';
import type { ObLlmBudget } from './budget';
import { toObLlmError, type ObLlmClient } from './client';
import {
  buildAnalystUser,
  OB_LLM_NOTE_MAX_CHARS,
  OB_LLM_SYSTEM_ANALYST,
} from './prompts';
import { OB_DIRECT_MAX_ACTIONS, OB_DIRECT_TOOL } from './schema';
import type { ObTranscriptLine, ObTranscriptRing } from './transcripts';

export const OB_ANALYST_DEFAULT_INTERVAL_S = 15;
export const OB_ANALYST_MIN_INTERVAL_S = OB_CONFIG_LIMITS.analystIntervalS.min;
export const OB_ANALYST_MAX_INTERVAL_S = OB_CONFIG_LIMITS.analystIntervalS.max;
export const OB_ANALYST_MAX_BACKOFF_MS = 5 * 60_000;
export const OB_ANALYST_MAX_API_ERRORS = 3;
/** Call timeout, decoupled from the interval (a busy tick just skips). */
export const OB_ANALYST_TIMEOUT_MS = 20_000;
/** Event-driven ticks: debounce after the event, minimum gap between runs. */
export const OB_ANALYST_EVENT_DEBOUNCE_MS = 1_000;
export const OB_ANALYST_MIN_EVENT_GAP_MS = 5_000;
/** How long an LLM cut holds the program against the auto pilot. */
export const OB_LLM_CUT_HOLD_MS = 4_000;

export function clampAnalystInterval(s: number | undefined): number {
  if (s === undefined || !Number.isFinite(s))
    return OB_ANALYST_DEFAULT_INTERVAL_S;
  return Math.round(
    Math.min(OB_ANALYST_MAX_INTERVAL_S, Math.max(OB_ANALYST_MIN_INTERVAL_S, s)),
  );
}

/** `OB_VAN_LLM_ANALYST_INTERVAL_S` (default 15, clamped 10..300). */
export function analystIntervalFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.OB_VAN_LLM_ANALYST_INTERVAL_S;
  return clampAnalystInterval(
    raw === undefined || raw.trim() === '' ? undefined : Number(raw),
  );
}

export type ObTimers = {
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

const REAL_TIMERS: ObTimers = {
  setInterval: (fn, ms) => {
    const h = setInterval(fn, ms);
    h.unref?.();
    return h;
  },
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  setTimeout: (fn, ms) => {
    const h = setTimeout(fn, ms);
    h.unref?.();
    return h;
  },
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export type ObAnalystOptions = {
  client: ObLlmClient;
  budget: ObLlmBudget;
  ring: ObTranscriptRing;
  getSituation: () => ObSituation;
  apply: (cmd: ObOperatorCommand, reasons: string[]) => void;
  log: (entry: Omit<ObLogEntry, 'id' | 'atMs'>) => void;
  /** Analyst state changed (the module re-publishes its status). */
  onChange: () => void;
  now: () => number;
  intervalS?: number;
  timers?: ObTimers;
};

export type ObAnalystTickResult =
  | 'disabled'
  | 'phase'
  | 'busy'
  | 'backoff'
  | 'budget'
  | 'unchanged'
  | 'ran'
  | 'error';

export type ObAnalystState = {
  enabled: boolean;
  intervalS: number;
  busy: boolean;
  lastRunAtMs: number | null;
  lastNote: string | null;
  backoffUntilMs: number | null;
  error: string | null;
};

/** One validated action from the model. */
export type ObDirectAction =
  | { type: 'cut'; cam: number; why: string }
  | { type: 'advance_segment'; why: string }
  | {
      type: 'set_lower_third';
      cam: number;
      name: string;
      subtitle?: string;
      ms?: number;
      why: string;
    }
  | { type: 'set_pacing'; minHoldMs?: number; maxHoldMs?: number; why: string }
  | { type: 'prefer_cam'; cam: number; forMs: number; why: string }
  | { type: 'note'; text: string };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim()
    ? v.replace(/\s+/g, ' ').trim().slice(0, max)
    : undefined;
const intIn = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v)
    ? Math.round(Math.min(max, Math.max(min, v)))
    : undefined;

/** Read the `direct` tool input: known action shapes only, ≤ 3, first of each type. */
export function parseDirectActions(input: unknown): {
  actions: ObDirectAction[];
  rejected: string[];
} {
  const rejected: string[] = [];
  const list =
    isRec(input) && Array.isArray(input.actions) ? input.actions : [];
  if (isRec(input) && !Array.isArray(input.actions))
    rejected.push('no actions list');
  const actions: ObDirectAction[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    if (actions.length >= OB_DIRECT_MAX_ACTIONS) {
      rejected.push(
        `more than ${OB_DIRECT_MAX_ACTIONS} actions — extra ignored`,
      );
      break;
    }
    if (!isRec(raw) || typeof raw.type !== 'string') {
      rejected.push('unreadable action');
      continue;
    }
    if (seen.has(raw.type)) {
      rejected.push(`duplicate ${raw.type} ignored`);
      continue;
    }
    const why = text(raw.why, 80) ?? 'analyst';
    let action: ObDirectAction | null = null;
    switch (raw.type) {
      case 'cut': {
        const cam = intIn(raw.cam, 1, 99);
        if (cam !== undefined) action = { type: 'cut', cam, why };
        break;
      }
      case 'advance_segment':
        action = { type: 'advance_segment', why };
        break;
      case 'set_lower_third': {
        const cam = intIn(raw.cam, 1, 99);
        const name = text(raw.name, 48);
        if (cam !== undefined && name) {
          action = { type: 'set_lower_third', cam, name, why };
          const subtitle = text(raw.subtitle, 64);
          if (subtitle) action.subtitle = subtitle;
          const ms = intIn(raw.ms, 2000, 15000);
          if (ms !== undefined) action.ms = ms;
        }
        break;
      }
      case 'set_pacing': {
        const minHoldMs = intIn(
          raw.minHoldMs,
          OB_RULESET_LIMITS.minHoldMs.min,
          OB_RULESET_LIMITS.minHoldMs.max,
        );
        const maxHoldMs = intIn(
          raw.maxHoldMs,
          OB_RULESET_LIMITS.maxHoldMs.min,
          OB_RULESET_LIMITS.maxHoldMs.max,
        );
        if (minHoldMs !== undefined || maxHoldMs !== undefined) {
          action = { type: 'set_pacing', why };
          if (minHoldMs !== undefined) action.minHoldMs = minHoldMs;
          if (maxHoldMs !== undefined)
            action.maxHoldMs = Math.max(maxHoldMs, minHoldMs ?? 0);
        }
        break;
      }
      case 'prefer_cam': {
        const cam = intIn(raw.cam, 1, 99);
        const forMs = intIn(raw.forMs, 3000, 60000);
        if (cam !== undefined && forMs !== undefined)
          action = { type: 'prefer_cam', cam, forMs, why };
        break;
      }
      case 'note': {
        const t = text(raw.text, OB_LLM_NOTE_MAX_CHARS);
        if (t) action = { type: 'note', text: t };
        break;
      }
    }
    if (!action) {
      rejected.push(`invalid ${raw.type}`);
      continue;
    }
    seen.add(action.type);
    actions.push(action);
  }
  return { actions, rejected };
}

const fold = (s: string) =>
  s.normalize('NFC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();

/** A lower-third name is allowed when it is a talent field or was heard in the captions. */
export function isKnownName(
  name: string,
  cams: ObSituation['cams'],
  transcripts: ObTranscriptLine[],
): boolean {
  const n = fold(name);
  if (!n) return false;
  if (cams.some((c) => c.talent && fold(c.talent) === n)) return true;
  return transcripts.some((l) => fold(l.text).includes(n));
}

/** Situation fingerprint: nothing new → no call. */
export function situationHash(
  s: ObSituation,
  lastTranscriptAt: number | null,
): string {
  const lastCut = s.lastCuts.length ? s.lastCuts[s.lastCuts.length - 1] : null;
  // Dominant speaker (cam number) so a speaker change always busts the hash.
  // Raw rms / motion stay out: their jitter would bust it every tick.
  let dominant: number | null = null;
  let best = -1;
  for (const c of s.cams) {
    if (!c.live || !c.signals?.speaking) continue;
    if (c.signals.speechShare > best) {
      best = c.signals.speechShare;
      dominant = c.number;
    }
  }
  return JSON.stringify([
    s.phase,
    s.segment?.index ?? null,
    s.program.shot,
    lastCut ? lastCut.id : null,
    s.cams.map((c) => [
      c.number,
      c.role,
      c.live,
      c.talent,
      c.signals ? c.signals.speaking : null,
      c.signals ? Math.round(c.signals.speechShare * 10) : null,
      c.signals ? c.signals.people : null,
    ]),
    dominant,
    s.lowerThird?.name ?? null,
    lastTranscriptAt,
  ]);
}

export class ObAnalyst {
  private readonly o: ObAnalystOptions;
  private readonly timers: ObTimers;
  private enabled = false;
  private intervalS: number;
  private phase: ObPhase = 'setup';
  private timer: unknown = null;
  private eventTimer: unknown = null;
  private pendingTick: string | null = null;
  private lastTrigger: string | null = null;
  private inFlight: AbortController | null = null;
  private lastHash: string | null = null;
  private lastRunAtMs: number | null = null;
  private lastNote: string | null = null;
  private backoffMs = 0;
  private backoffUntilMs: number | null = null;
  private apiErrors = 0;
  private error: string | null = null;

  constructor(opts: ObAnalystOptions) {
    this.o = opts;
    this.timers = opts.timers ?? REAL_TIMERS;
    this.intervalS = clampAnalystInterval(opts.intervalS);
  }

  state(): ObAnalystState {
    return {
      enabled: this.enabled,
      intervalS: this.intervalS,
      busy: this.inFlight !== null,
      lastRunAtMs: this.lastRunAtMs,
      lastNote: this.lastNote,
      backoffUntilMs: this.backoffUntilMs,
      error: this.error,
    };
  }

  setEnabled(enabled: boolean, intervalS?: number): void {
    if (intervalS !== undefined)
      this.intervalS = clampAnalystInterval(intervalS);
    if (enabled) {
      this.error = null;
      this.apiErrors = 0;
      this.backoffMs = 0;
      this.backoffUntilMs = null;
      this.lastHash = null;
    }
    this.enabled = enabled;
    this.syncTimer(true);
    // First look right away — a fresh director should not wait a full interval.
    if (enabled && this.phase === 'on-air')
      this.timers.setTimeout(() => void this.tick('enabled'), 0);
    this.o.onChange();
  }

  setIntervalS(intervalS: number): void {
    this.intervalS = clampAnalystInterval(intervalS);
    this.syncTimer(true);
    this.o.onChange();
  }

  setPhase(phase: ObPhase): void {
    if (phase === this.phase) return;
    this.phase = phase;
    if (phase !== 'on-air') this.abortInFlight();
    this.lastHash = null;
    this.syncTimer(false);
    if (phase === 'on-air' && this.enabled)
      this.timers.setTimeout(() => void this.tick('on air'), 0);
    this.o.onChange();
  }

  /**
   * Something happened (speaker change, keyword, cut, silence): tick soon.
   * Debounced 1 s; at most one event tick per `OB_ANALYST_MIN_EVENT_GAP_MS`;
   * a call in flight queues one follow-up tick instead.
   */
  requestTick(reason: string): void {
    if (!this.enabled || this.phase !== 'on-air') return;
    if (this.inFlight) {
      this.pendingTick = reason;
      return;
    }
    if (this.eventTimer !== null) return;
    this.eventTimer = this.timers.setTimeout(() => {
      this.eventTimer = null;
      const now = this.o.now();
      if (
        this.lastRunAtMs !== null &&
        now - this.lastRunAtMs < OB_ANALYST_MIN_EVENT_GAP_MS
      )
        return;
      void this.tick(reason);
    }, OB_ANALYST_EVENT_DEBOUNCE_MS);
  }

  /** Stop now: abort the call in flight, turn the analyst off. */
  kill(): void {
    this.abortInFlight();
    this.enabled = false;
    this.syncTimer(false);
    this.o.onChange();
  }

  dispose(): void {
    this.abortInFlight();
    this.enabled = false;
    this.stopTimer();
  }

  /** One analyst step (the timer calls it; public for tests). */
  async tick(trigger?: string): Promise<ObAnalystTickResult> {
    this.lastTrigger = trigger ?? null;
    if (!this.enabled) return 'disabled';
    if (this.phase !== 'on-air') return 'phase';
    if (this.inFlight) return 'busy';
    const now = this.o.now();
    if (this.backoffUntilMs !== null && now < this.backoffUntilMs)
      return 'backoff';
    const over = this.o.budget.exceeded();
    if (over) {
      this.disable(`budget: ${over}`);
      return 'budget';
    }
    const situation = this.o.getSituation();
    if (situation.phase !== 'on-air') return 'phase';
    const hash = situationHash(situation, this.o.ring.lastChangeAt);
    if (hash === this.lastHash) return 'unchanged';

    const transcripts = this.o.ring.lines(now);
    const controller = new AbortController();
    this.inFlight = controller;
    this.o.onChange();
    try {
      const res = await this.o.client.call({
        system: OB_LLM_SYSTEM_ANALYST,
        user: buildAnalystUser(situation, transcripts),
        tool: OB_DIRECT_TOOL,
        toolChoice: 'required',
        maxTokens: 1500,
        effort: 'low',
        timeoutMs: OB_ANALYST_TIMEOUT_MS,
        signal: controller.signal,
      });
      this.o.budget.record(res.usage);
      this.lastRunAtMs = this.o.now();
      this.lastHash = hash;
      this.apiErrors = 0;
      this.backoffMs = 0;
      this.backoffUntilMs = null;
      this.error = null;
      // Killed / phase changed while waiting: drop the answer.
      if (controller.signal.aborted || !this.enabled || this.phase !== 'on-air')
        return 'disabled';
      if (res.stopReason === 'refusal') {
        this.logLlm('amber', 'the analyst declined this turn');
      } else if (res.toolInput === null) {
        this.logLlm('amber', 'the analyst answered without actions');
      } else {
        this.applyActions(res.toolInput, situation, transcripts);
      }
      return 'ran';
    } catch (e) {
      const err = toObLlmError(e);
      if (err.code === 'aborted') return 'disabled';
      if (err.code === 'rate' || err.code === 'net') {
        const base = Math.max(this.intervalS * 1000, 15_000);
        this.backoffMs = this.backoffMs
          ? Math.min(this.backoffMs * 2, OB_ANALYST_MAX_BACKOFF_MS)
          : base;
        this.backoffUntilMs = this.o.now() + this.backoffMs;
        this.error = err.message;
        this.logLlm(
          'amber',
          `analyst backing off ${Math.round(this.backoffMs / 1000)} s (${err.code})`,
        );
      } else {
        this.apiErrors++;
        this.error = err.message;
        if (this.apiErrors >= OB_ANALYST_MAX_API_ERRORS) {
          this.disable(`${this.apiErrors} API errors in a row: ${err.message}`);
        } else {
          this.logLlm('bad', `analyst error: ${err.message}`);
        }
      }
      return 'error';
    } finally {
      if (this.inFlight === controller) this.inFlight = null;
      // An event arrived while we were busy: look once more.
      if (this.pendingTick !== null) {
        const reason = this.pendingTick;
        this.pendingTick = null;
        this.requestTick(reason);
      }
      this.o.onChange();
    }
  }

  private applyActions(
    input: unknown,
    situation: ObSituation,
    transcripts: ObTranscriptLine[],
  ): void {
    const { actions, rejected } = parseDirectActions(input);
    const camBy = (n: number) => situation.cams.find((c) => c.number === n);
    // The cut lands first: nudges in the same turn describe the new program.
    const ordered = [...actions].sort(
      (a, b) => (a.type === 'cut' ? 0 : 1) - (b.type === 'cut' ? 0 : 1),
    );
    for (const a of ordered) {
      const reasons = ['llm analyst'];
      if (this.lastTrigger) reasons.push(`on ${this.lastTrigger}`);
      if (a.type !== 'note') reasons.push(a.why);
      switch (a.type) {
        case 'cut': {
          const cam = camBy(a.cam);
          if (!cam || !cam.live) {
            rejected.push(
              `cut: camera ${a.cam} ${cam ? 'is not live' : 'does not exist'}`,
            );
            break;
          }
          if (cam.onProgram) {
            rejected.push(`cut: camera ${a.cam} is already on program`);
            break;
          }
          this.o.apply(
            {
              op: 'shot',
              shot: { kind: 'solo', cam: cam.camId },
              mode: 'take',
              holdMs: OB_LLM_CUT_HOLD_MS,
            },
            reasons,
          );
          break;
        }
        case 'advance_segment': {
          const index = situation.segment?.index ?? -1;
          if (index + 1 >= situation.rundown.length) {
            rejected.push('advance_segment: no next segment');
            break;
          }
          this.o.apply({ op: 'segment', action: 'next' }, reasons);
          break;
        }
        case 'set_lower_third': {
          const cam = camBy(a.cam);
          if (!cam) {
            rejected.push(`set_lower_third: camera ${a.cam} does not exist`);
            break;
          }
          if (!isKnownName(a.name, situation.cams, transcripts)) {
            rejected.push(
              `set_lower_third: "${a.name}" was not heard or listed as talent`,
            );
            break;
          }
          this.o.apply(
            {
              op: 'lower_third',
              camId: cam.camId,
              name: a.name,
              subtitle: a.subtitle ?? null,
              ...(a.ms ? { ms: a.ms } : {}),
            },
            reasons,
          );
          break;
        }
        case 'set_pacing':
          this.o.apply(
            {
              op: 'pacing',
              ...(a.minHoldMs !== undefined ? { minHoldMs: a.minHoldMs } : {}),
              ...(a.maxHoldMs !== undefined ? { maxHoldMs: a.maxHoldMs } : {}),
            },
            reasons,
          );
          break;
        case 'prefer_cam': {
          const cam = camBy(a.cam);
          if (!cam || !cam.live) {
            rejected.push(
              `prefer_cam: camera ${a.cam} ${cam ? 'is not live' : 'does not exist'}`,
            );
            break;
          }
          if (cam.onProgram) {
            // Boosting the on-air camera would only suppress score cuts.
            rejected.push(`prefer_cam: camera ${a.cam} is already on program`);
            break;
          }
          this.o.apply(
            { op: 'prefer_cam', camId: cam.camId, forMs: a.forMs },
            reasons,
          );
          break;
        }
        case 'note':
          this.lastNote = a.text;
          this.o.apply({ op: 'note', text: a.text }, reasons);
          break;
      }
    }
    if (rejected.length)
      this.logLlm(
        'amber',
        `analyst actions rejected: ${rejected.join('; ')}`,
        rejected,
      );
  }

  private disable(reason: string): void {
    this.enabled = false;
    this.error = reason;
    this.syncTimer(false);
    this.logLlm('bad', `analyst off — ${reason}`);
    this.o.onChange();
  }

  private logLlm(
    tone: ObLogEntry['tone'],
    message: string,
    reasons?: string[],
  ): void {
    this.o.log({
      source: 'llm',
      kind: 'llm',
      tone,
      label: 'LLM',
      text: message,
      ...(reasons ? { reasons } : {}),
    });
  }

  private abortInFlight(): void {
    if (!this.inFlight) return;
    this.inFlight.abort();
    this.inFlight = null;
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      this.timers.clearInterval(this.timer);
      this.timer = null;
    }
    if (this.eventTimer !== null) {
      this.timers.clearTimeout(this.eventTimer);
      this.eventTimer = null;
    }
    this.pendingTick = null;
  }

  /** Timer runs only while enabled AND on air. */
  private syncTimer(restart: boolean): void {
    const shouldRun = this.enabled && this.phase === 'on-air';
    if (!shouldRun || restart) this.stopTimer();
    if (shouldRun && this.timer === null) {
      this.timer = this.timers.setInterval(
        () => void this.tick(),
        this.intervalS * 1000,
      );
    }
  }
}
