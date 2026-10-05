import { afterEach, describe, expect, it, vi } from 'vitest';
import { createObQuizContestants } from '../llm/contestants';

const INPUT = {
  question: 'What language are Smelter shaders written in?',
  answers: ['GLSL', 'HLSL', 'WGSL', 'CUDA'] as [string, string, string, string],
};

const ENV_ALL = {
  OPENAI_API_KEY: 'sk-test',
  XAI_API_KEY: 'xai-test',
  TYPESAFE_API_KEY: 'ts-test',
  ANTHROPIC_API_KEY: 'ant-test',
} as NodeJS.ProcessEnv;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const openAiBody = (content: string) => ({
  choices: [{ message: { content } }],
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('availability', () => {
  it('reflects the per-provider env keys (the cameo is always in)', () => {
    const none = createObQuizContestants({} as NodeJS.ProcessEnv);
    expect(none.opus.available()).toBe(false);
    expect(none.gpt.available()).toBe(false);
    expect(none.jev.available()).toBe(false);
    expect(none.gemini.available()).toBe(true); // no API — pure theatre
    const all = createObQuizContestants(ENV_ALL);
    expect(all.opus.available()).toBe(true);
    expect(all.gpt.available()).toBe(true);
    expect(all.jev.available()).toBe(true);
    expect(all.gemini.available()).toBe(true);
  });

  it('answers null without a key, without calling anything', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const c = createObQuizContestants({} as NodeJS.ProcessEnv);
    expect(await c.gpt.answer(INPUT)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('OpenAI-compatible adapter (gpt)', () => {
  it('parses the json_schema reply and never leaks the correct letter', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(openAiBody('{"answer":"C","quip":"WGSL, obviously."}')),
    );
    vi.stubGlobal('fetch', fetchMock);
    const c = createObQuizContestants(ENV_ALL);
    const res = await c.gpt.answer(INPUT);
    expect(res).toEqual({
      letter: 'C',
      quip: 'WGSL, obviously.',
      confidence: null,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    // Blind by construction: the bank's `correct` field never reaches the
    // request (the prompt may ask "which letter is correct?" — that's fine).
    expect(init.body as string).not.toContain('"correct"');
    expect(JSON.parse(init.body as string).model).toBe('gpt-6-astra');
  });

  it('sends the bearer key', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(openAiBody('{"answer":"A","quip":"x"}')),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await createObQuizContestants(ENV_ALL).gpt.answer(INPUT);
    expect(res && 'letter' in res && res.letter).toBe('A');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer sk-test',
    );
  });

  it('falls back to the loose letter parse on non-JSON content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(openAiBody('I will go with B here.'))),
    );
    const c = createObQuizContestants(ENV_ALL);
    const res = await c.gpt.answer(INPUT);
    expect(res).toEqual({ letter: 'B', quip: null, confidence: null });
  });

  it('resolves null on HTTP errors and on garbage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ oops: 1 }, 500)),
    );
    const c = createObQuizContestants(ENV_ALL);
    expect(await c.gpt.answer(INPUT)).toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(openAiBody('no letters here'))),
    );
    expect(await createObQuizContestants(ENV_ALL).gpt.answer(INPUT)).toBeNull();
  });

  it('env overrides change model and base url', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(openAiBody('{"answer":"D","quip":"x"}')),
    );
    vi.stubGlobal('fetch', fetchMock);
    const c = createObQuizContestants({
      ...ENV_ALL,
      OB_QUIZ_GPT_MODEL: 'gpt-7',
      OB_QUIZ_GPT_BASE_URL: 'https://proxy.local/v1/',
    } as NodeJS.ProcessEnv);
    await c.gpt.answer(INPUT);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://proxy.local/v1/chat/completions');
    expect(JSON.parse(init.body as string).model).toBe('gpt-7');
  });
});

describe('jev (TypeSafe System One)', () => {
  it('maps the Choice answer and confidence; context rides in state', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        model: 'jev-1.13.0',
        answers: {
          answer: {
            type: 'choice',
            choice: 'C',
            confidence: 0.87,
            probabilities: { A: 0.02, B: 0.05, C: 0.87, D: 0.06 },
          },
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const c = createObQuizContestants(ENV_ALL);
    const res = await c.jev.answer(INPUT);
    expect(res).toEqual({ letter: 'C', quip: null, confidence: 0.87 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('jev-latest');
    expect(body.questions.answer.type).toBe('choice');
    expect(body.questions.answer.criteria).toEqual({
      A: 'GLSL',
      B: 'HLSL',
      C: 'WGSL',
      D: 'CUDA',
    });
    expect(body.state).toContain(INPUT.question);
    expect(body.state).toContain('Smelter'); // the study pack
  });

  it('rejects malformed choices and out-of-range confidence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ answers: { answer: { type: 'choice', choice: 'E' } } }),
      ),
    );
    expect(await createObQuizContestants(ENV_ALL).jev.answer(INPUT)).toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          answers: { answer: { type: 'choice', choice: 'B', confidence: 7 } },
        }),
      ),
    );
    const res = await createObQuizContestants(ENV_ALL).jev.answer(INPUT);
    expect(res).toEqual({ letter: 'B', quip: null, confidence: null });
  });
});

describe('guards', () => {
  it('one call in flight per contestant — the second ask drops to null', async () => {
    let release: (v: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((r) => (release = r))),
    );
    const c = createObQuizContestants(ENV_ALL);
    const first = c.gpt.answer(INPUT);
    expect(await c.gpt.answer(INPUT)).toBeNull(); // busy
    release(jsonResponse(openAiBody('{"answer":"A","quip":"x"}')));
    const res = await first;
    expect(res && 'letter' in res && res.letter).toBe('A');
  });

  it('the process-wide call cap stops further calls (cameo exempt)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(openAiBody('{"answer":"A","quip":"x"}'))),
    );
    const c = createObQuizContestants({
      ...ENV_ALL,
      OB_QUIZ_AI_MAX_CALLS: '1',
    } as NodeJS.ProcessEnv);
    expect(await c.gpt.answer(INPUT)).not.toBeNull();
    expect(c.jev.available()).toBe(false); // cap shared across contestants
    expect(await c.jev.answer(INPUT)).toBeNull();
    // The cameo never calls anything, so the cap does not apply to it.
    expect(c.gemini.available()).toBe(true);
  });

  it('the gemini cameo cashes out instead of answering, with no network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const c = createObQuizContestants({} as NodeJS.ProcessEnv);
    expect(await c.gemini.answer(INPUT)).toEqual({ cashOut: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a throwing adapter resolves null instead of rejecting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('boom');
      }),
    );
    const c = createObQuizContestants(ENV_ALL);
    await expect(c.jev.answer(INPUT)).resolves.toBeNull();
  });
});
