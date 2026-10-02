import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { obPresetRuleset, type ObLlmStatus } from '@smelter-editor/types';
import { registerObVanLlmRoutes, type ObLlmRoomApi } from '../obVanLlmRoutes';
import { ObLlmError } from '../llm/errors';

const STATUS: ObLlmStatus = {
  available: true,
  model: 'claude-sonnet-5',
  analyst: false,
  intervalS: 30,
  busy: false,
  runs: 0,
  tokensIn: 0,
  tokensOut: 0,
  estCostUsd: 0,
  lastRunAtMs: null,
  lastNote: null,
  backoffUntilMs: null,
  error: null,
};

function room(over: Partial<ObLlmRoomApi> = {}): ObLlmRoomApi {
  return {
    obLlmBrief: async () => ({
      ruleset: obPresetRuleset('talk'),
      rationale: 'r',
      warnings: ['w'],
    }),
    obLlmAnalyst: (enabled, intervalS, model) => ({
      ...STATUS,
      analyst: enabled,
      intervalS: intervalS ?? 30,
      ...(model ? { model } : {}),
    }),
    obLlmStatus: () => STATUS,
    obLlmWrap: async () => 'Nice show.',
    obLlmKill: () => ({ ...STATUS, analyst: false }),
    ...over,
  };
}

let app: FastifyInstance | null = null;
async function server(r: ObLlmRoomApi | null) {
  app = Fastify();
  registerObVanLlmRoutes(app, (roomId) => {
    if (!r)
      throw Object.assign(new Error(`Room ${roomId} does not exist.`), {
        statusCode: 404,
      });
    return r;
  });
  await app.ready();
  return app;
}
afterEach(async () => {
  await app?.close();
  app = null;
});

describe('OB Van LLM routes', () => {
  it('POST llm/brief returns the ruleset', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const s = await server(room());
    const res = await s.inject({
      method: 'POST',
      url: '/room/r1/ob-van/llm/brief',
      payload: { brief: 'panel' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      rationale: 'r',
      warnings: ['w'],
      ruleset: { id: 'preset-talk' },
    });
    const empty = await s.inject({
      method: 'POST',
      url: '/room/r1/ob-van/llm/brief',
      payload: { brief: '' },
    });
    expect(empty.statusCode).toBe(400);
    log.mockRestore();
  });

  it.each([
    ['llm_unavailable', 503],
    ['invalid_ruleset', 422],
    ['budget', 429],
    ['busy', 409],
    ['rate', 502],
    ['no_tool', 502],
  ] as const)('maps %s to %i', async (code, status) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const s = await server(
      room({
        obLlmBrief: () =>
          Promise.reject(
            new ObLlmError(
              code,
              `failed: ${code}`,
              code === 'invalid_ruleset' ? ['e1'] : [],
            ),
          ),
      }),
    );
    const res = await s.inject({
      method: 'POST',
      url: '/room/r1/ob-van/llm/brief',
      payload: { brief: 'x' },
    });
    expect(res.statusCode).toBe(status);
    expect(res.json()).toMatchObject({ code, message: `failed: ${code}` });
    if (code === 'invalid_ruleset') expect(res.json().errors).toEqual(['e1']);
    log.mockRestore();
  });

  it('analyst / status / wrap / kill', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const s = await server(room());
    const on = await s.inject({
      method: 'POST',
      url: '/room/r1/ob-van/llm/analyst',
      payload: { enabled: true, intervalS: 20 },
    });
    expect(on.json()).toMatchObject({
      status: { analyst: true, intervalS: 20 },
    });
    const tooFast = await s.inject({
      method: 'POST',
      url: '/room/r1/ob-van/llm/analyst',
      payload: { enabled: true, intervalS: 2 },
    });
    expect(tooFast.statusCode).toBe(400);
    const withModel = await s.inject({
      method: 'POST',
      url: '/room/r1/ob-van/llm/analyst',
      payload: { enabled: true, model: 'claude-haiku-4-5' },
    });
    expect(withModel.json()).toMatchObject({
      status: { model: 'claude-haiku-4-5' },
    });
    const badModel = await s.inject({
      method: 'POST',
      url: '/room/r1/ob-van/llm/analyst',
      payload: { enabled: true, model: 'gpt-5' },
    });
    expect(badModel.statusCode).toBe(400);
    expect(
      (
        await s.inject({ method: 'GET', url: '/room/r1/ob-van/llm/status' })
      ).json(),
    ).toEqual({ status: STATUS });
    expect(
      (
        await s.inject({ method: 'POST', url: '/room/r1/ob-van/llm/wrap' })
      ).json(),
    ).toEqual({ notes: 'Nice show.' });
    expect(
      (
        await s.inject({ method: 'POST', url: '/room/r1/ob-van/llm/kill' })
      ).json(),
    ).toMatchObject({ status: { analyst: false } });
    log.mockRestore();
  });

  it('leaves non-LLM errors (unknown room) to Fastify', async () => {
    const s = await server(null);
    const res = await s.inject({
      method: 'GET',
      url: '/room/nope/ob-van/llm/status',
    });
    expect(res.statusCode).toBe(404);
  });
});
