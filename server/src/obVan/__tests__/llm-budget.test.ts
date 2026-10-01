import { describe, expect, it, vi } from 'vitest';
import {
  ObLlmBudget,
  obLlmCostUsd,
  obLlmLimitsFromEnv,
  obLlmPrice,
  OB_LLM_DEFAULT_LIMITS,
} from '../llm/budget';
import { ObLlmError } from '../llm/errors';
import { createObLlm } from '../llm';
import { FakeLlmClient, situation } from './llm-fixtures';

const M = 1_000_000;

describe('prices', () => {
  it('prices claude-sonnet-5 at $2 / $10 per MTok, cache read 0.1×, write 1.25×', () => {
    expect(
      obLlmCostUsd('claude-sonnet-5', {
        in: M,
        out: 0,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ).toBeCloseTo(2);
    expect(
      obLlmCostUsd('claude-sonnet-5', {
        in: 0,
        out: M,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ).toBeCloseTo(10);
    expect(
      obLlmCostUsd('claude-sonnet-5', {
        in: 0,
        out: 0,
        cacheRead: M,
        cacheWrite: 0,
      }),
    ).toBeCloseTo(0.2);
    expect(
      obLlmCostUsd('claude-sonnet-5', {
        in: 0,
        out: 0,
        cacheRead: 0,
        cacheWrite: M,
      }),
    ).toBeCloseTo(2.5);
  });

  it('prices unknown models conservatively (Opus 5 rates)', () => {
    expect(obLlmPrice('claude-mystery').known).toBe(false);
    expect(
      obLlmCostUsd('claude-mystery', {
        in: M,
        out: M,
        cacheRead: 0,
        cacheWrite: 0,
      }),
    ).toBeCloseTo(30);
    expect(obLlmPrice('claude-opus-5-5').price.cacheReadPerMTok).toBeCloseTo(
      0.2,
    );
  });
});

describe('limits', () => {
  it('defaults to 600 runs / 1.2M input tokens and reads the environment', () => {
    expect(obLlmLimitsFromEnv({})).toEqual({
      maxRuns: 600,
      maxInputTokens: 1_200_000,
    });
    expect(
      obLlmLimitsFromEnv({
        OB_VAN_LLM_MAX_RUNS_PER_EVENT: '12',
        OB_VAN_LLM_MAX_INPUT_TOKENS_PER_EVENT: '50000',
      }),
    ).toEqual({ maxRuns: 12, maxInputTokens: 50_000 });
    expect(
      obLlmLimitsFromEnv({
        OB_VAN_LLM_MAX_RUNS_PER_EVENT: '-3',
        OB_VAN_LLM_MAX_INPUT_TOKENS_PER_EVENT: 'lots',
      }),
    ).toEqual(OB_LLM_DEFAULT_LIMITS);
  });

  it('accumulates usage and reports the first limit hit', () => {
    const b = new ObLlmBudget('claude-sonnet-5', {
      maxRuns: 3,
      maxInputTokens: 10_000,
    });
    b.record({ in: 1000, out: 300, cacheRead: 2000, cacheWrite: 500 });
    expect(b).toMatchObject({
      runs: 1,
      tokensIn: 3500,
      tokensOut: 300,
      cacheRead: 2000,
    });
    expect(b.estCostUsd).toBeCloseTo(
      (1000 * 2 + 300 * 10 + 2000 * 0.2 + 500 * 2.5) / M,
    );
    expect(b.exceeded()).toBeNull();
    b.record({ in: 6000, out: 0, cacheRead: 500, cacheWrite: 0 });
    expect(b.exceeded()).toContain('input token limit');
    b.reset();
    expect(b.exceeded()).toBeNull();
    for (let i = 0; i < 3; i++)
      b.record({ in: 1, out: 1, cacheRead: 0, cacheWrite: 0 });
    expect(b.exceeded()).toBe('run limit reached (3/3 per event)');
  });
});

describe('module guardrails', () => {
  const deps = () => ({
    getSituation: () => situation(),
    apply: vi.fn(),
    log: vi.fn(),
    onStatus: vi.fn(),
  });
  const ruleset = {
    name: 'r',
    pacing: { minHoldMs: 2500, maxHoldMs: 20000, transition: 'cut' },
    weights: { speech: 1, motion: 0, people: 0, ball: 0, novelty: 0, stay: 0 },
    rules: [],
  };

  it('refuses a brief once the event budget is spent, counting rejected outputs too', async () => {
    const client = new FakeLlmClient().reply({ toolInput: null, text: 'no' });
    const llm = createObLlm(deps(), client, {
      limits: { maxRuns: 1, maxInputTokens: 1_000_000 },
    });
    const first = await llm
      .generateRuleset({ brief: 'x', presetId: 'talk', cams: [] })
      .catch((e: unknown) => e);
    expect((first as ObLlmError).code).toBe('no_tool');
    expect(llm.status().runs).toBe(1);
    const second = await llm
      .generateRuleset({ brief: 'x', presetId: 'talk', cams: [] })
      .catch((e: unknown) => e);
    expect((second as ObLlmError).code).toBe('budget');
    expect(client.calls).toHaveLength(1);
  });

  it('allows one brief at a time', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<{ toolInput: unknown }>((r) => {
      release = () => r({ toolInput: { ruleset, rationale: '' } });
    });
    const client = new FakeLlmClient().reply(gate);
    const llm = createObLlm(deps(), client);
    const a = llm.generateRuleset({ brief: 'x', presetId: 'talk', cams: [] });
    expect(llm.status().busy).toBe(true);
    const b = await llm
      .generateRuleset({ brief: 'y', presetId: 'talk', cams: [] })
      .catch((e: unknown) => e);
    expect((b as ObLlmError).code).toBe('busy');
    release();
    await expect(a).resolves.toMatchObject({ rationale: '' });
    expect(llm.status().busy).toBe(false);
  });

  it('rounds the cost estimate in the status', async () => {
    const client = new FakeLlmClient().tool({ ruleset, rationale: '' });
    const llm = createObLlm(deps(), client);
    await llm.generateRuleset({ brief: 'x', presetId: 'talk', cams: [] });
    // USAGE: 1000 in, 200 out, 3000 cache read → 0.002 + 0.002 + 0.0006
    expect(llm.status().estCostUsd).toBe(0.0046);
  });
});
