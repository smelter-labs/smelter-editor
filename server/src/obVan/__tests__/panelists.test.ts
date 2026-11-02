import { afterEach, describe, expect, it, vi } from 'vitest';
import { createObPanelAi } from '../llm/panelists';

const INPUT = {
  question: 'Will AI directors replace human vision mixers?',
  history: [
    { speaker: 'host' as const, text: 'Welcome to the panel.' },
    { speaker: 'opus' as const, text: 'Delighted to be rendered.' },
  ],
};

const ENV_ALL = {
  OPENAI_API_KEY: 'sk-test',
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
  it('reflects the per-provider env keys', () => {
    const none = createObPanelAi({} as NodeJS.ProcessEnv);
    expect(none.panelists.opus.available()).toBe(false);
    expect(none.panelists.gpt.available()).toBe(false);
    const all = createObPanelAi(ENV_ALL);
    expect(all.panelists.opus.available()).toBe(true);
    expect(all.panelists.gpt.available()).toBe(true);
  });

  it('discusses to null without a key, without calling anything', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const ai = createObPanelAi({} as NodeJS.ProcessEnv);
    expect(await ai.panelists.gpt.discuss(INPUT)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('OpenAI-compatible panelist (gpt)', () => {
  it('sends the conversation and the question, returns the spoken line', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(openAiBody('Not a chance. Vision mixers have taste.')),
    );
    vi.stubGlobal('fetch', fetchMock);
    const ai = createObPanelAi(ENV_ALL);
    const res = await ai.panelists.gpt.discuss(INPUT);
    expect(res).toEqual({ text: 'Not a chance. Vision mixers have taste.' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(init.body as string) as {
      messages: { role: string; content: string }[];
    };
    const user = body.messages.find((m) => m.role === 'user')!.content;
    expect(user).toContain('Welcome to the panel.');
    expect(user).toContain('OPUS: Delighted to be rendered.');
    expect(user).toContain(INPUT.question);
    const system = body.messages.find((m) => m.role === 'system')!.content;
    expect(system).toContain('two short sentences');
  });

  it('flattens whitespace and trims a rambling answer', async () => {
    const long = `${'blah '.repeat(100)}end`;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(openAiBody(`  spaced\n\nout ${long}`))),
    );
    const ai = createObPanelAi(ENV_ALL);
    const res = await ai.panelists.gpt.discuss(INPUT);
    expect(res!.text.length).toBeLessThanOrEqual(300);
    expect(res!.text).not.toContain('\n');
  });

  it('resolves null on an HTTP error (never rejects)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'nope' }, 500)),
    );
    const ai = createObPanelAi(ENV_ALL);
    expect(await ai.panelists.gpt.discuss(INPUT)).toBeNull();
  });
});

describe('guards', () => {
  it('one call in flight — a second discuss drops to null', async () => {
    let release!: (r: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((r) => (release = r))),
    );
    const ai = createObPanelAi(ENV_ALL);
    const first = ai.panelists.gpt.discuss(INPUT);
    expect(await ai.panelists.gpt.discuss(INPUT)).toBeNull();
    release(jsonResponse(openAiBody('Late but here.')));
    expect(await first).toEqual({ text: 'Late but here.' });
  });

  it('the process-wide cap stops further calls', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(openAiBody('yes')));
    vi.stubGlobal('fetch', fetchMock);
    const ai = createObPanelAi({
      ...ENV_ALL,
      OB_PANEL_AI_MAX_CALLS: '1',
    } as NodeJS.ProcessEnv);
    expect(await ai.panelists.gpt.discuss(INPUT)).toEqual({ text: 'yes' });
    expect(await ai.panelists.gpt.discuss(INPUT)).toBeNull();
    expect(ai.panelists.gpt.available()).toBe(false); // cap spent
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('voices', () => {
  it('prefers the panel env voice, falls back to the quiz voice', () => {
    const quizVoiceOf = (model: 'opus' | 'gpt') => `quiz-${model}`;
    const ai = createObPanelAi(
      { OB_PANEL_TTS_VOICE_OPUS: 'panel-opus' } as NodeJS.ProcessEnv,
      quizVoiceOf,
    );
    expect(ai.voiceOf('opus')).toBe('panel-opus');
    expect(ai.voiceOf('gpt')).toBe('quiz-gpt');
    const bare = createObPanelAi({} as NodeJS.ProcessEnv);
    expect(bare.voiceOf('gpt')).toBeNull();
  });
});
