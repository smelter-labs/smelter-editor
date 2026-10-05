import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createObQuizTts } from '../llm/tts';

// These tests exercise the real ffmpeg mux (the same binary the demo scripts
// use); only the ElevenLabs HTTP call is mocked.

const CACHE = mkdtempSync(path.join(tmpdir(), 'ob-tts-test-'));

afterEach(() => vi.unstubAllGlobals());
afterAll(() => rmSync(CACHE, { recursive: true, force: true }));

/** 1 s of 24 kHz s16le mono: a 220 Hz tone with a silent second half. */
function tonePcm(): Buffer {
  const samples = 24_000;
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples / 2; i++)
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / 24_000) * 20_000), i * 2);
  return buf;
}

const pcmResponse = (body: Buffer, status = 200) =>
  new Response(new Uint8Array(body), { status });

describe('createObQuizTts', () => {
  it('is null without a key (and not in fake mode)', () => {
    expect(createObQuizTts({} as NodeJS.ProcessEnv, { cacheDir: CACHE })).toBeNull();
  });

  it('synthesises via the API: exact duration, normalised mouth, playable mp4', async () => {
    const fetchMock = vi.fn(async () => pcmResponse(tonePcm()));
    vi.stubGlobal('fetch', fetchMock);
    const tts = createObQuizTts(
      { ELEVENLABS_API_KEY: 'xi-test' } as NodeJS.ProcessEnv,
      { cacheDir: CACHE },
    )!;
    const clip = await tts.synth('Hello there.', 'voice-1');
    expect(clip).not.toBeNull();
    expect(clip!.durationMs).toBe(1_000); // 24k samples at 24 kHz
    expect(clip!.mouth.rateHz).toBe(50);
    expect(clip!.mouth.v).toHaveLength(50);
    // Voiced first half near 1 after p95 normalisation, silent tail at 0.
    expect(Math.max(...clip!.mouth.v.slice(0, 20))).toBeGreaterThan(0.8);
    expect(Math.max(...clip!.mouth.v.slice(30))).toBe(0);
    expect(existsSync(clip!.file)).toBe(true);
    // ftyp box right past the size header = a real mp4 container.
    expect(readFileSync(clip!.file).subarray(4, 8).toString()).toBe('ftyp');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v1/text-to-speech/voice-1');
    expect(url).toContain('output_format=pcm_24000');
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe(
      'xi-test',
    );
    expect(JSON.parse(init.body as string).model_id).toBe('eleven_flash_v2_5');
  });

  it('serves repeats from the disk cache (no second API call)', async () => {
    const fetchMock = vi.fn(async () => pcmResponse(tonePcm()));
    vi.stubGlobal('fetch', fetchMock);
    const env = { ELEVENLABS_API_KEY: 'xi-test' } as NodeJS.ProcessEnv;
    const first = await createObQuizTts(env, { cacheDir: CACHE })!.synth(
      'Cache me.',
      'voice-1',
    );
    expect(first).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // A fresh module instance (fresh process, same cache dir) hits the disk.
    const again = await createObQuizTts(env, { cacheDir: CACHE })!.synth(
      'Cache me.',
      'voice-1',
    );
    expect(again).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent synths of the same line', async () => {
    let release: (r: Response) => void = () => {};
    const fetchMock = vi.fn(
      () => new Promise<Response>((r) => (release = r)),
    );
    vi.stubGlobal('fetch', fetchMock);
    const tts = createObQuizTts(
      { ELEVENLABS_API_KEY: 'xi-test' } as NodeJS.ProcessEnv,
      { cacheDir: CACHE },
    )!;
    const a = tts.synth('Twice at once.', 'voice-1');
    const b = tts.synth('Twice at once.', 'voice-1');
    await vi.waitUntil(() => fetchMock.mock.calls.length > 0);
    release(pcmResponse(tonePcm()));
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).not.toBeNull();
    expect(rb).toBe(ra); // the same in-flight promise
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('resolves null on HTTP errors and empty bodies — never rejects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => pcmResponse(tonePcm(), 429)));
    const env = { ELEVENLABS_API_KEY: 'xi-test' } as NodeJS.ProcessEnv;
    await expect(
      createObQuizTts(env, { cacheDir: CACHE })!.synth('Nope.', 'voice-1'),
    ).resolves.toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => pcmResponse(Buffer.alloc(100))),
    );
    await expect(
      createObQuizTts(env, { cacheDir: CACHE })!.synth('Tiny.', 'voice-1'),
    ).resolves.toBeNull();
  });

  it('fake mode needs no key and makes a short voiced clip', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const tts = createObQuizTts(
      { OB_QUIZ_TTS_FAKE: '1' } as NodeJS.ProcessEnv,
      { cacheDir: CACHE },
    );
    expect(tts).not.toBeNull();
    const clip = await tts!.synth('Fake it.', 'voice-x');
    expect(clip).not.toBeNull();
    expect(clip!.durationMs).toBeGreaterThan(1_000);
    expect(Math.max(...clip!.mouth.v)).toBeGreaterThan(0.5);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps voices per contestant with env overrides; jev has none', () => {
    const tts = createObQuizTts(
      {
        ELEVENLABS_API_KEY: 'xi-test',
        OB_QUIZ_TTS_HOST_VOICE: 'my-host',
        OB_QUIZ_TTS_VOICE_GPT: 'my-gpt',
      } as NodeJS.ProcessEnv,
      { cacheDir: CACHE },
    )!;
    expect(tts.hostVoice).toBe('my-host');
    expect(tts.voiceOf('gpt')).toBe('my-gpt');
    expect(tts.voiceOf('opus')).toBeTruthy();
    expect(tts.voiceOf('jev')).toBeNull();
  });
});
