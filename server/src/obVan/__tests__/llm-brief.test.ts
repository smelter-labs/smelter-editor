import { describe, expect, it, vi } from 'vitest';
import Anthropic, {
  APIConnectionTimeoutError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import { obPresetRuleset } from '@smelter-editor/types';
import { dropUnknownCams, generateRuleset } from '../llm/brief';
import {
  AnthropicObLlmClient,
  createObLlmClient,
  toObLlmError,
  type ObMessagesApi,
} from '../llm/client';
import { ObLlmError } from '../llm/errors';
import { createObLlm } from '../llm';
import { OB_LLM_SYSTEM } from '../llm/prompts';
import {
  OB_DIRECT_TOOL,
  OB_PROPOSE_RULESET_TOOL,
  toStrictSchema,
  type ObJsonSchema,
} from '../llm/schema';
import { FakeLlmClient, situation } from './llm-fixtures';

const cams = situation().cams;

const goodRuleset = {
  name: 'Panel, calm',
  pacing: { minHoldMs: 3000, maxHoldMs: 18000, transition: 'dissolve' },
  weights: {
    speech: 1.8,
    motion: 0.1,
    people: 0.3,
    ball: 0,
    novelty: 0.3,
    stay: 0.6,
  },
  keywords: [{ group: 'slides', words: ['Slide', 'as you can see'] }],
  rules: [
    {
      id: 'wide-silence',
      name: 'Wide on silence',
      priority: 10,
      when: { signal: 'silence', forMs: 5000 },
      then: { shot: { kind: 'solo', cam: 'wide' } },
    },
    {
      id: 'anna',
      name: 'Anna when she talks',
      priority: 70,
      when: { signal: 'speech', cam: 'cam:2', forMs: 800 },
      then: {
        shot: { kind: 'solo', cam: 'cam:2' },
        lowerThird: { cam: 'cam:2', mode: 'talent' },
      },
    },
  ],
};

async function brief(client: FakeLlmClient) {
  return generateRuleset(client, {
    brief: 'Calm panel, Anna leads.',
    presetId: 'talk',
    cams,
  });
}

describe('generateRuleset', () => {
  it('accepts a valid ruleset and normalises it', async () => {
    const client = new FakeLlmClient().tool({
      ruleset: goodRuleset,
      rationale: 'Calm cuts, Anna first.',
    });
    const onUsage = vi.fn();
    const res = await generateRuleset(
      client,
      { brief: 'Calm panel, Anna leads.', presetId: 'talk', cams },
      { onUsage },
    );
    expect(res.ruleset.id).toBe('llm-talk');
    expect(res.ruleset.preset).toBe('talk');
    expect(res.ruleset.rules.map((r) => r.id)).toEqual([
      'anna',
      'wide-silence',
    ]); // by priority
    expect(res.ruleset.keywords).toEqual({
      slides: ['slide', 'as you can see'],
    });
    expect(res.ruleset.pacing.transition).toBe('dissolve');
    expect(res.rationale).toBe('Calm cuts, Anna first.');
    expect(res.warnings).toEqual([]);
    expect(onUsage).toHaveBeenCalledTimes(1);

    const call = client.calls[0];
    expect(call.system).toBe(OB_LLM_SYSTEM);
    expect(call.tool?.name).toBe('propose_ruleset');
    expect(call.effort).toBe('medium');
    expect(call.user).toContain('cam 2 · role speaker');
    expect(call.user).toContain('Calm panel, Anna leads.');
  });

  it('fills pacing / weights from the preset when missing', async () => {
    const { pacing: _p, weights: _w, ...rest } = goodRuleset;
    const client = new FakeLlmClient().tool({ ruleset: rest, rationale: '' });
    const res = await brief(client);
    const preset = obPresetRuleset('talk');
    expect(res.ruleset.pacing).toEqual(preset.pacing);
    expect(res.ruleset.weights.speech).toBe(preset.weights.speech);
  });

  it('drops a rule that references a camera that does not exist', async () => {
    const ruleset = {
      ...goodRuleset,
      rules: [
        ...goodRuleset.rules,
        {
          id: 'ghost',
          name: 'Cam 7',
          priority: 50,
          when: { signal: 'speech', cam: 'cam:7' },
          then: { shot: { kind: 'solo', cam: 'trigger' } },
        },
        {
          id: 'ghost-id',
          name: 'By id',
          priority: 40,
          when: { signal: 'motion', op: '>', value: 0.5 },
          then: { shot: { kind: 'split', cams: ['program', 'id:nope'] } },
        },
      ],
    };
    const res = await brief(
      new FakeLlmClient().tool({ ruleset, rationale: 'x' }),
    );
    expect(res.ruleset.rules.map((r) => r.id)).toEqual([
      'anna',
      'wide-silence',
    ]);
    expect(res.warnings).toEqual([
      'rule "ghost" dropped: unknown camera cam:7',
      'rule "ghost-id" dropped: unknown camera id:nope',
    ]);
  });

  it('keeps role selectors even when no camera has the role', () => {
    const r = obPresetRuleset('talk');
    const out = dropUnknownCams(r, cams);
    expect(out.ruleset.rules.length).toBe(r.rules.length);
    expect(out.warnings).toEqual([]);
  });

  it('rejects an unreadable ruleset with invalid_ruleset', async () => {
    const ruleset = {
      name: 'bad',
      rules: [
        {
          id: 'x',
          name: 'x',
          priority: 5,
          when: { signal: 'telepathy' },
          then: { shot: { kind: 'solo', cam: 'wide' } },
        },
      ],
    };
    const err = await brief(
      new FakeLlmClient().tool({ ruleset, rationale: '' }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ObLlmError);
    expect((err as ObLlmError).code).toBe('invalid_ruleset');
    expect((err as ObLlmError).details).toContain(
      'none of the rules could be read',
    );
  });

  it('rejects a tool input without a ruleset object', async () => {
    const err = await brief(
      new FakeLlmClient().tool({ rationale: 'no rules' }),
    ).catch((e: unknown) => e);
    expect((err as ObLlmError).code).toBe('invalid_ruleset');
  });

  it('maps "no tool call" to no_tool and a refusal to refused', async () => {
    const noTool = await brief(
      new FakeLlmClient().reply({
        toolInput: null,
        text: 'Sure!',
        attempts: 2,
      }),
    ).catch((e: unknown) => e);
    expect((noTool as ObLlmError).code).toBe('no_tool');
    const refused = await brief(
      new FakeLlmClient().reply({ toolInput: null, stopReason: 'refusal' }),
    ).catch((e: unknown) => e);
    expect((refused as ObLlmError).code).toBe('refused');
  });
});

// ── Tool schemas ───────────────────────────────────────────────────────

const FORBIDDEN = [
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'maxItems',
  'pattern',
] as const;

function walk(s: ObJsonSchema, visit: (s: ObJsonSchema) => void): void {
  visit(s);
  for (const p of Object.values(s.properties ?? {})) walk(p, visit);
  if (s.items) walk(s.items, visit);
  for (const a of s.anyOf ?? []) walk(a, visit);
}

describe('toStrictSchema', () => {
  it('adds additionalProperties:false and strips unsupported bounds', () => {
    const out = toStrictSchema({
      type: 'object',
      properties: {
        n: { type: 'integer', minimum: 1, maximum: 8, description: 'Camera.' },
        s: { type: 'string', maxLength: 10 },
        list: {
          type: 'array',
          items: { type: 'object', properties: { a: { type: 'string' } } },
          minItems: 2,
          maxItems: 3,
        },
      },
      required: ['n'],
    });
    expect(out.additionalProperties).toBe(false);
    expect(out.properties?.list.items?.additionalProperties).toBe(false);
    expect(out.properties?.list.items?.required).toEqual([]);
    expect(out.properties?.n).toEqual({
      type: 'integer',
      description: 'Camera. (1..8)',
    });
    expect(out.properties?.s).toEqual({
      type: 'string',
      description: '(≤ 10 chars)',
    });
    expect(out.properties?.list.minItems).toBe(1);
    expect(out.properties?.list.maxItems).toBeUndefined();
  });

  it.each([OB_PROPOSE_RULESET_TOOL, OB_DIRECT_TOOL])(
    '$name is in the strict subset',
    (tool) => {
      walk(tool.inputSchema, (s) => {
        for (const k of FORBIDDEN) expect(s[k]).toBeUndefined();
        if (s.minItems !== undefined) expect([0, 1]).toContain(s.minItems);
        if (s.properties) {
          expect(s.additionalProperties).toBe(false);
          for (const r of s.required ?? [])
            expect(Object.keys(s.properties)).toContain(r);
        }
      });
      expect(JSON.stringify(tool.inputSchema)).not.toContain('$ref'); // non-recursive
    },
  );
});

// ── Client (fake transport) ────────────────────────────────────────────

function message(
  over: Partial<Anthropic.Message> & { content: Anthropic.Message['content'] },
): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5',
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    container: null,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 2000,
      cache_creation_input_tokens: 0,
    } as Anthropic.Usage,
    ...over,
  } as Anthropic.Message;
}

const textMsg = (text: string) =>
  message({
    content: [{ type: 'text', text, citations: null } as Anthropic.TextBlock],
  });
const toolMsg = (input: unknown) =>
  message({
    stop_reason: 'tool_use',
    content: [
      {
        type: 'tool_use',
        id: 'tu_1',
        name: 'direct',
        input,
      } as Anthropic.ToolUseBlock,
    ],
  });

function fakeMessages(...replies: (Anthropic.Message | Error)[]) {
  const bodies: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const options: ({ timeout?: number; maxRetries?: number } | undefined)[] = [];
  const api: ObMessagesApi = {
    create: async (body, opts) => {
      bodies.push(
        JSON.parse(
          JSON.stringify(body),
        ) as Anthropic.MessageCreateParamsNonStreaming,
      );
      options.push(opts);
      const next = replies.shift();
      if (!next) throw new Error('no reply');
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { api, bodies, options };
}

const callInput = {
  system: 'SYSTEM',
  user: 'USER',
  tool: OB_DIRECT_TOOL,
  maxTokens: 1500,
  effort: 'low' as const,
  timeoutMs: 20_000,
};

describe('AnthropicObLlmClient', () => {
  it('sends a cached system block, one strict tool, tool_choice auto and effort', async () => {
    const t = fakeMessages(toolMsg({ actions: [] }));
    const client = new AnthropicObLlmClient({
      model: 'claude-sonnet-5',
      messages: t.api,
    });
    const res = await client.call(callInput);
    expect(res.toolInput).toEqual({ actions: [] });
    expect(res.attempts).toBe(1);
    const body = t.bodies[0];
    expect(body.model).toBe('claude-sonnet-5');
    expect(body.system).toEqual([
      { type: 'text', text: 'SYSTEM', cache_control: { type: 'ephemeral' } },
    ]);
    expect(body.tools?.[0]).toMatchObject({ name: 'direct', strict: true });
    expect(body.tool_choice).toEqual({
      type: 'auto',
      disable_parallel_tool_use: true,
    });
    expect(body.output_config).toEqual({ effort: 'low' });
    expect(t.options[0]).toMatchObject({ timeout: 20_000, maxRetries: 0 });
  });

  it('retries once with an explicit instruction when the tool is not called, summing usage', async () => {
    const t = fakeMessages(textMsg('Looks fine.'), toolMsg({ actions: [] }));
    const client = new AnthropicObLlmClient({
      model: 'claude-sonnet-5',
      messages: t.api,
    });
    const res = await client.call(callInput);
    expect(res.attempts).toBe(2);
    expect(res.toolInput).toEqual({ actions: [] });
    expect(res.usage).toEqual({
      in: 200,
      out: 100,
      cacheRead: 4000,
      cacheWrite: 0,
    });
    expect(JSON.stringify(t.bodies[1].messages)).toContain(
      'answer ONLY by calling the `direct` tool',
    );
  });

  it('gives up after the retry (toolInput null) and never retries a refusal', async () => {
    const twice = fakeMessages(textMsg('no'), textMsg('still no'));
    const res = await new AnthropicObLlmClient({
      model: 'm',
      messages: twice.api,
    }).call(callInput);
    expect(res).toMatchObject({
      toolInput: null,
      attempts: 2,
      text: 'still no',
    });

    const refusal = fakeMessages(
      message({ stop_reason: 'refusal', content: [] }),
    );
    const r2 = await new AnthropicObLlmClient({
      model: 'm',
      messages: refusal.api,
    }).call(callInput);
    expect(r2).toMatchObject({
      toolInput: null,
      attempts: 1,
      stopReason: 'refusal',
    });
  });

  it('falls back to a non-strict tool when the API rejects the strict schema', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const rejected = new BadRequestError(
      400,
      undefined,
      'tools.0: invalid strict schema',
      new Headers(),
    );
    const t = fakeMessages(
      rejected,
      toolMsg({ actions: [] }),
      toolMsg({ actions: [] }),
    );
    const client = new AnthropicObLlmClient({ model: 'm', messages: t.api });
    await client.call(callInput);
    await client.call(callInput);
    expect(
      t.bodies.map(
        (b) => b.tools?.[0] && 'strict' in b.tools[0] && b.tools[0].strict,
      ),
    ).toEqual([true, false, false]);
    warn.mockRestore();
  });

  it('maps SDK errors to rate / net / api', () => {
    const h = new Headers();
    expect(
      toObLlmError(new RateLimitError(429, undefined, 'slow down', h)).code,
    ).toBe('rate');
    expect(
      toObLlmError(new InternalServerError(529, undefined, 'overloaded', h))
        .code,
    ).toBe('rate');
    expect(
      toObLlmError(new InternalServerError(500, undefined, 'boom', h)).code,
    ).toBe('net');
    expect(toObLlmError(new APIConnectionTimeoutError()).code).toBe('net');
    expect(
      toObLlmError(new AuthenticationError(401, undefined, 'bad key', h)).code,
    ).toBe('api');
    expect(toObLlmError(new ObLlmError('budget', 'x')).code).toBe('budget');
  });

  it('createObLlmClient needs ANTHROPIC_API_KEY and honours OB_VAN_LLM_MODEL', () => {
    expect(createObLlmClient({})).toBeNull();
    expect(createObLlmClient({ ANTHROPIC_API_KEY: '  ' })).toBeNull();
    expect(createObLlmClient({ ANTHROPIC_API_KEY: 'sk-test' })?.model).toBe(
      'claude-sonnet-5',
    );
    expect(
      createObLlmClient({
        ANTHROPIC_API_KEY: 'sk-test',
        OB_VAN_LLM_MODEL: 'claude-opus-5',
      })?.model,
    ).toBe('claude-opus-5');
  });
});

describe('createObLlm without a client', () => {
  it('reports unavailable and rejects with llm_unavailable', async () => {
    const onStatus = vi.fn();
    const llm = createObLlm(
      {
        getSituation: () => situation(),
        apply: vi.fn(),
        log: vi.fn(),
        onStatus,
      },
      null,
    );
    expect(llm.status()).toMatchObject({
      available: false,
      model: null,
      analyst: false,
    });
    const err = await llm
      .generateRuleset({ brief: 'x', presetId: 'talk', cams })
      .catch((e: unknown) => e);
    expect((err as ObLlmError).code).toBe('llm_unavailable');
    llm.setAnalyst(true, 45);
    expect(onStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        available: false,
        analyst: false,
        intervalS: 45,
      }),
    );
  });

  it('forwards a brief through the module and accounts its usage', async () => {
    const client = new FakeLlmClient().tool({
      ruleset: goodRuleset,
      rationale: 'ok',
    });
    const llm = createObLlm(
      {
        getSituation: () => situation(),
        apply: vi.fn(),
        log: vi.fn(),
        onStatus: vi.fn(),
      },
      client,
      { limits: { maxRuns: 10, maxInputTokens: 100_000 } },
    );
    const res = await llm.generateRuleset({
      brief: 'Calm panel',
      presetId: 'talk',
      cams,
    });
    expect(res.ruleset.rules).toHaveLength(2);
    expect(llm.status()).toMatchObject({
      available: true,
      model: 'claude-sonnet-5',
      runs: 1,
      tokensIn: 4000,
      tokensOut: 200,
    });
    expect(client.calls[0].user).toContain('Event: Panel');
  });
});
