/**
 * OB Van LLM layer — `createObLlm(deps)` builds the `ObLlmModule` the
 * controller owns (brief → ruleset, periodic analyst, wrap-up notes,
 * transcript ring, budget, kill switch).
 *
 * Without an API key the factory still returns a module (no null checks in
 * the controller): `status().available === false`, `generateRuleset()` /
 * `wrapNotes()` reject with `ObLlmError('llm_unavailable')` (routes → 503)
 * and `setAnalyst()` only records the wish.
 */
import type { ObLlmStatus, ObPhase } from '@smelter-editor/types';
import type { ObBriefResult, ObLlmDeps, ObLlmModule } from '../contracts';
import {
  analystIntervalFromEnv,
  clampAnalystInterval,
  ObAnalyst,
  type ObTimers,
} from './analyst';
import { generateRuleset } from './brief';
import {
  ObLlmBudget,
  obLlmLimitsFromEnv,
  type ObLlmBudgetLimits,
} from './budget';
import {
  createObLlmClient,
  toObLlmError,
  type ObLlmClient,
  type ObLlmUsage,
} from './client';
import { ObLlmError } from './errors';
import { ObTranscriptRing } from './transcripts';
import { generateWrapNotes } from './wrap';

export type CreateObLlmOptions = {
  limits?: ObLlmBudgetLimits;
  intervalS?: number;
  timers?: ObTimers;
};

const unavailable = () =>
  new ObLlmError(
    'llm_unavailable',
    'LLM is off — set ANTHROPIC_API_KEY on the server.',
  );

/**
 * @param client `undefined` → `createObLlmClient()` from the environment;
 *               `null` → no LLM; an instance → used as is (tests).
 */
export function createObLlm(
  deps: ObLlmDeps,
  client?: ObLlmClient | null,
  opts: CreateObLlmOptions = {},
): ObLlmModule {
  const llm = client === undefined ? createObLlmClient() : client;
  const now = deps.now ?? Date.now;
  const intervalS =
    opts.intervalS !== undefined
      ? clampAnalystInterval(opts.intervalS)
      : analystIntervalFromEnv();

  if (!llm) {
    let wanted = false;
    let wantedInterval = intervalS;
    const status = (): ObLlmStatus => ({
      available: false,
      model: null,
      analyst: false,
      intervalS: wantedInterval,
      busy: false,
      runs: 0,
      tokensIn: 0,
      tokensOut: 0,
      estCostUsd: 0,
      lastRunAtMs: null,
      lastNote: null,
      backoffUntilMs: null,
      error: wanted
        ? 'LLM is off — set ANTHROPIC_API_KEY on the server.'
        : null,
    });
    return {
      status,
      generateRuleset: () => Promise.reject(unavailable()),
      setAnalyst(enabled, s) {
        wanted = enabled;
        if (s !== undefined) wantedInterval = clampAnalystInterval(s);
        deps.onStatus(status());
      },
      setModel: () => undefined,
      onTranscript: () => undefined,
      setPhase: () => undefined,
      wrapNotes: () => Promise.reject(unavailable()),
      kill() {
        wanted = false;
        deps.onStatus(status());
      },
      dispose: () => undefined,
    };
  }

  const budget = new ObLlmBudget(
    llm.model,
    opts.limits ?? obLlmLimitsFromEnv(),
  );
  const ring = new ObTranscriptRing();
  let phase: ObPhase = 'setup';
  let oneShot: AbortController | null = null;
  let oneShotLastRunAtMs: number | null = null;
  let disposed = false;

  const status = (): ObLlmStatus => {
    const a = analyst.state();
    const lastRuns = [a.lastRunAtMs, oneShotLastRunAtMs].filter(
      (x): x is number => x !== null,
    );
    return {
      available: true,
      model: llm.model,
      analyst: a.enabled,
      intervalS: a.intervalS,
      busy: a.busy || oneShot !== null,
      runs: budget.runs,
      tokensIn: budget.tokensIn,
      tokensOut: budget.tokensOut,
      estCostUsd: Math.round(budget.estCostUsd * 10_000) / 10_000,
      lastRunAtMs: lastRuns.length ? Math.max(...lastRuns) : null,
      lastNote: a.lastNote,
      backoffUntilMs: a.backoffUntilMs,
      error: a.error,
    };
  };
  const emit = () => {
    if (!disposed) deps.onStatus(status());
  };

  const analyst = new ObAnalyst({
    client: llm,
    budget,
    ring,
    getSituation: deps.getSituation,
    apply: deps.apply,
    log: deps.log,
    onChange: emit,
    now,
    intervalS,
    timers: opts.timers,
  });

  /** Brief / wrap: one at a time, budget-checked, abortable by `kill()`. */
  async function runOneShot<T>(
    fn: (signal: AbortSignal, onUsage: (u: ObLlmUsage) => void) => Promise<T>,
  ): Promise<T> {
    if (oneShot)
      throw new ObLlmError('busy', 'Another LLM request is running.');
    const over = budget.exceeded();
    if (over)
      throw new ObLlmError(
        'budget',
        `LLM budget for this event is spent: ${over}`,
      );
    const controller = new AbortController();
    oneShot = controller;
    emit();
    try {
      return await fn(controller.signal, (u) => {
        budget.record(u);
        oneShotLastRunAtMs = now();
      });
    } catch (e) {
      throw toObLlmError(e);
    } finally {
      if (oneShot === controller) oneShot = null;
      emit();
    }
  }

  return {
    status,

    generateRuleset(input): Promise<ObBriefResult> {
      let eventName: string | undefined;
      try {
        eventName = deps.getSituation().eventName;
      } catch {
        eventName = undefined;
      }
      return runOneShot((signal, onUsage) =>
        generateRuleset(llm, { ...input, eventName }, { signal, onUsage }),
      );
    },

    setAnalyst(enabled, s) {
      analyst.setEnabled(enabled, s);
    },

    setModel(model) {
      const m = model.trim();
      if (!m || m === llm.model) return;
      llm.setModel?.(m);
      // Calls from now on are priced at the new model's rates.
      budget.model = llm.model;
      emit();
    },

    onTranscript(camNumber, text, airMs) {
      ring.push(camNumber, text, airMs);
    },

    setPhase(p) {
      const prev = phase;
      phase = p;
      // A new event starts when the show goes back to setup after a wrap.
      if (prev === 'wrap' && p === 'setup') {
        budget.reset();
        ring.clear();
        oneShotLastRunAtMs = null;
      }
      analyst.setPhase(p);
      emit();
    },

    wrapNotes(input) {
      let cams: {
        camId: string;
        number: number;
        name: string;
        role: string;
      }[] = [];
      try {
        cams = deps.getSituation().cams.map((c) => ({
          camId: c.camId,
          number: c.number,
          name: c.name,
          role: c.role,
        }));
      } catch {
        cams = [];
      }
      return runOneShot((signal, onUsage) =>
        generateWrapNotes(llm, { ...input, cams }, { signal, onUsage }),
      );
    },

    kill() {
      oneShot?.abort();
      oneShot = null;
      analyst.kill();
      emit();
    },

    dispose() {
      oneShot?.abort();
      oneShot = null;
      analyst.dispose();
      disposed = true;
    },
  };
}

export {
  ObLlmError,
  isObLlmError,
  obLlmErrorStatus,
  type ObLlmErrorCode,
} from './errors';
export {
  createObLlmClient,
  OB_LLM_DEFAULT_MODEL,
  type ObLlmClient,
} from './client';
