/**
 * OB Van LLM — token / cost accounting and the per-event guardrails.
 *
 * Prices are Anthropic first-party list prices in USD per million tokens
 * (claude-api skill, cached 2026-06-24). Cache writes use the 5-minute TTL
 * multiplier (1.25 × input); cache reads are listed per model (0.1 × input on
 * most models). Unknown models are priced like Opus 5 so the estimate errs
 * high.
 *
 * Limits (per event — reset when a new event starts):
 * - `OB_VAN_LLM_MAX_RUNS_PER_EVENT` (default 240) API calls;
 * - `OB_VAN_LLM_MAX_INPUT_TOKENS_PER_EVENT` (default 400 000) input tokens,
 *   counting uncached + cache-read + cache-write tokens alike (conservative).
 */
import type { ObLlmUsage } from './client';

export type ObLlmPrice = {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWritePerMTok: number;
};

const price = (
  input: number,
  output: number,
  cacheRead = input * 0.1,
): ObLlmPrice => ({
  inputPerMTok: input,
  outputPerMTok: output,
  cacheReadPerMTok: cacheRead,
  cacheWritePerMTok: input * 1.25,
});

export const OB_LLM_PRICES: Readonly<Record<string, ObLlmPrice>> = {
  'claude-sonnet-5': price(2, 10),
  'claude-haiku-4-5': price(1, 5),
  'claude-sonnet-4-6': price(3, 15),
  'claude-opus-5': price(5, 25),
  'claude-opus-5-5': price(4, 20, 0.2),
  'claude-opus-4-8': price(5, 25),
  'claude-opus-4-7': price(5, 25),
  'claude-opus-4-6': price(5, 25),
  'claude-fable-5': price(10, 50),
  'claude-fable-5-1': price(10, 50, 0.25),
};
const FALLBACK_PRICE = OB_LLM_PRICES['claude-opus-5'];

export function obLlmPrice(model: string): {
  price: ObLlmPrice;
  known: boolean;
} {
  const known = OB_LLM_PRICES[model];
  return known
    ? { price: known, known: true }
    : { price: FALLBACK_PRICE, known: false };
}

export function obLlmCostUsd(model: string, usage: ObLlmUsage): number {
  const { price: p } = obLlmPrice(model);
  return (
    (usage.in * p.inputPerMTok +
      usage.out * p.outputPerMTok +
      usage.cacheRead * p.cacheReadPerMTok +
      usage.cacheWrite * p.cacheWritePerMTok) /
    1_000_000
  );
}

export type ObLlmBudgetLimits = { maxRuns: number; maxInputTokens: number };

export const OB_LLM_DEFAULT_LIMITS: ObLlmBudgetLimits = {
  maxRuns: 240,
  maxInputTokens: 400_000,
};

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function obLlmLimitsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ObLlmBudgetLimits {
  return {
    maxRuns: positiveInt(
      env.OB_VAN_LLM_MAX_RUNS_PER_EVENT,
      OB_LLM_DEFAULT_LIMITS.maxRuns,
    ),
    maxInputTokens: positiveInt(
      env.OB_VAN_LLM_MAX_INPUT_TOKENS_PER_EVENT,
      OB_LLM_DEFAULT_LIMITS.maxInputTokens,
    ),
  };
}

export class ObLlmBudget {
  /** Prices calls from now on; switched together with the client's model. */
  model: string;
  readonly limits: ObLlmBudgetLimits;
  runs = 0;
  /** All input tokens (uncached + cache read + cache write). */
  tokensIn = 0;
  tokensOut = 0;
  cacheRead = 0;
  estCostUsd = 0;

  constructor(model: string, limits: ObLlmBudgetLimits = obLlmLimitsFromEnv()) {
    this.model = model;
    this.limits = limits;
  }

  /** Account one API call (`usage` summed over its attempts). */
  record(usage: ObLlmUsage): void {
    this.runs++;
    this.tokensIn += usage.in + usage.cacheRead + usage.cacheWrite;
    this.tokensOut += usage.out;
    this.cacheRead += usage.cacheRead;
    this.estCostUsd += obLlmCostUsd(this.model, usage);
  }

  /** Why no further call is allowed, or null. */
  exceeded(): string | null {
    if (this.runs >= this.limits.maxRuns)
      return `run limit reached (${this.runs}/${this.limits.maxRuns} per event)`;
    if (this.tokensIn >= this.limits.maxInputTokens)
      return `input token limit reached (${this.tokensIn}/${this.limits.maxInputTokens} per event)`;
    return null;
  }

  reset(): void {
    this.runs = 0;
    this.tokensIn = 0;
    this.tokensOut = 0;
    this.cacheRead = 0;
    this.estCostUsd = 0;
  }
}
