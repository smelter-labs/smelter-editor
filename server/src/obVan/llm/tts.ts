/**
 * OB Van — ElevenLabs voices for the Smelterionaire cast.
 *
 * `synth(text, voiceId)` turns a line into a Smelter-playable mp4 (black
 * 64×36 h264 + AAC, same shape as the quiz stingers) plus a 50 Hz mouth
 * track for the puppet lips — both derived from the raw PCM the API returns,
 * so the clip duration is exact and no ffprobe is needed. Clips are cached
 * on disk by sha1(voice|text): the host's canned template lines repeat, so
 * after one show almost every host beat plays with zero latency. The module
 * never throws — any failure resolves `null` and the show stays text-only
 * for that line.
 *
 * `OB_QUIZ_TTS_FAKE=1` skips the API and synthesises a short local tone
 * (keyless e2e exercises the register/mouth/pacing path end to end).
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ObQuizModelId } from '@smelter-editor/types';
import type { PuppetMouthTrack } from '../puppets/types';

const execFileAsync = promisify(execFile);

export type ObQuizTtsClip = {
  /** Absolute path of the muxed mp4 inside the cache dir. */
  file: string;
  durationMs: number;
  mouth: PuppetMouthTrack;
};

export interface ObQuizTtsModule {
  /** Resolves `null` on any failure; never rejects. */
  synth(text: string, voiceId: string): Promise<ObQuizTtsClip | null>;
  /** Fire-and-forget pre-generation (fills the disk cache). */
  warm(lines: { text: string; voiceId: string }[]): void;
  /** Contestant voice, or null for the silent ones (Jev only decides). */
  voiceOf(model: ObQuizModelId): string | null;
  readonly hostVoice: string;
  dispose(): void;
}

const SR = 24_000; // pcm_24000 — the highest PCM rate on the free tier
const MOUTH_RATE_HZ = 50;
const FETCH_TIMEOUT_MS = 12_000;
const FFMPEG_TIMEOUT_MS = 10_000;
const MAX_CONCURRENT = 3;
/** Hard ceiling on API calls per process (cache misses only). */
const DEFAULT_MAX_CALLS = 200;

/**
 * Premade ElevenLabs voices (the pre-2026 "legacy" set expires 2026-12-31 —
 * these are from the current default catalogue). All env-overridable.
 */
const DEFAULT_VOICES: Record<ObQuizModelId, string | null> = {
  opus: 'WQP7cQUF5aAS6Axh5yaa', // Elara — crisp narrator
  gpt: 'FrS6cKLB1wg4WYgPa9GW', // Wyatt — measured mentor
  gemini: 'g7LVvkPWALzPxOQbF6OE', // Jade — high energy (fits the walkout)
  jev: null, // Jev doesn't talk. Jev computes.
};
const DEFAULT_HOST_VOICE = '2E3fywgOSbUgLXqjR29C';

/**
 * 50 Hz RMS envelope of mono PCM, normalised by the p95 of the VOICED
 * windows (port of `mouthTrack` in scripts/ob-quiz-demo.mjs).
 */
function mouthTrack(pcm: Int16Array): PuppetMouthTrack {
  const win = Math.round(SR / MOUTH_RATE_HZ);
  const n = Math.floor(pcm.length / win);
  const rms = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = i * win; j < (i + 1) * win; j++) {
      const s = pcm[j] / 32768;
      sum += s * s;
    }
    rms[i] = Math.sqrt(sum / win);
  }
  let max = 0;
  for (const v of rms) if (v > max) max = v;
  if (max < 1e-3) return { rateHz: MOUTH_RATE_HZ, v: rms.map(() => 0) };
  const voiced = rms.filter((v) => v > max * 0.1).sort((a, b) => a - b);
  const norm = voiced[Math.floor(voiced.length * 0.95)] || max;
  return {
    rateHz: MOUTH_RATE_HZ,
    v: rms.map((v) => Math.round(Math.min(1, v / norm) * 1000) / 1000),
  };
}

/** ~1.4 s syllable-modulated tone — the keyless stand-in for the API. */
function fakePcm(seedText: string): Int16Array {
  let hash = 0;
  for (const ch of seedText) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const freq = 160 + (Math.abs(hash) % 120);
  const samples = Math.round(SR * 1.4);
  const pcm = new Int16Array(samples);
  for (let i = 0; i < samples; i++) {
    const t = i / SR;
    const syllable = Math.max(0, Math.sin(2 * Math.PI * 4 * t)) ** 2;
    pcm[i] = Math.round(Math.sin(2 * Math.PI * freq * t) * syllable * 12_000);
  }
  return pcm;
}

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

function isClipSidecar(v: unknown): v is { durationMs: number; mouth: PuppetMouthTrack } {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  const mouth = r.mouth as Record<string, unknown> | undefined;
  return (
    typeof r.durationMs === 'number' &&
    r.durationMs > 0 &&
    typeof mouth === 'object' &&
    mouth !== null &&
    typeof mouth.rateHz === 'number' &&
    Array.isArray(mouth.v)
  );
}

export function createObQuizTts(
  env: NodeJS.ProcessEnv = process.env,
  opts: { cacheDir: string },
): ObQuizTtsModule | null {
  const fake = env.OB_QUIZ_TTS_FAKE === '1';
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey && !fake) return null;

  const baseUrl = (
    env.OB_QUIZ_TTS_BASE_URL?.trim() || 'https://api.elevenlabs.io'
  ).replace(/\/$/, '');
  const modelId = env.OB_QUIZ_TTS_MODEL?.trim() || 'eleven_flash_v2_5';
  const maxCalls = Number(env.OB_QUIZ_TTS_MAX_CALLS) || DEFAULT_MAX_CALLS;
  const hostVoice = env.OB_QUIZ_TTS_HOST_VOICE?.trim() || DEFAULT_HOST_VOICE;
  const voices: Record<ObQuizModelId, string | null> = {
    opus: env.OB_QUIZ_TTS_VOICE_OPUS?.trim() || DEFAULT_VOICES.opus,
    gpt: env.OB_QUIZ_TTS_VOICE_GPT?.trim() || DEFAULT_VOICES.gpt,
    gemini: env.OB_QUIZ_TTS_VOICE_GEMINI?.trim() || DEFAULT_VOICES.gemini,
    jev: env.OB_QUIZ_TTS_VOICE_JEV?.trim() || DEFAULT_VOICES.jev,
  };

  let disposed = false;
  let calls = 0;
  let active = 0;
  const waiters: (() => void)[] = [];
  const inFlight = new Map<string, Promise<ObQuizTtsClip | null>>();
  const dirReady = fs
    .mkdir(opts.cacheDir, { recursive: true })
    .catch(() => {});

  const acquire = () =>
    new Promise<void>((resolve) => {
      const run = () => {
        active++;
        resolve();
      };
      if (active < MAX_CONCURRENT) run();
      else waiters.push(run);
    });
  const release = () => {
    active--;
    waiters.shift()?.();
  };

  async function fetchPcm(text: string, voiceId: string): Promise<Int16Array> {
    if (fake) return fakePcm(`${voiceId}|${text}`);
    calls++;
    const res = await fetch(
      `${baseUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=pcm_24000`,
      {
        method: 'POST',
        headers: { 'xi-api-key': apiKey!, 'content-type': 'application/json' },
        body: JSON.stringify({ text, model_id: modelId }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (!res.ok) throw new Error(`elevenlabs ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < SR * 2 * 0.1) throw new Error('elevenlabs: empty audio');
    return new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
  }

  async function mux(pcm: Int16Array, mp4Path: string): Promise<void> {
    const pcmPath = `${mp4Path}.pcm`;
    await fs.writeFile(
      pcmPath,
      Buffer.from(pcm.buffer, pcm.byteOffset, pcm.length * 2),
    );
    try {
      // Same output shape as scripts/quiz-render-sfx.mjs (tiny black video +
      // AAC) — a proven Smelter-compatible carrier.
      await execFileAsync(
        'ffmpeg',
        // prettier-ignore
        [
          '-y',
          '-f', 's16le', '-ar', String(SR), '-ac', '1', '-i', pcmPath,
          '-f', 'lavfi', '-i', 'color=c=black:s=64x36:r=10',
          '-map', '1:v', '-map', '0:a',
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
          '-shortest', '-movflags', '+faststart',
          mp4Path,
        ],
        { timeout: FFMPEG_TIMEOUT_MS },
      );
    } finally {
      await fs.rm(pcmPath, { force: true }).catch(() => {});
    }
  }

  async function synthUncached(
    text: string,
    voiceId: string,
    key: string,
  ): Promise<ObQuizTtsClip | null> {
    const mp4Path = path.join(opts.cacheDir, `${key}.mp4`);
    const jsonPath = path.join(opts.cacheDir, `${key}.json`);
    await dirReady;
    try {
      const sidecar: unknown = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
      await fs.access(mp4Path);
      if (isClipSidecar(sidecar)) return { file: mp4Path, ...sidecar };
    } catch {
      /* cache miss */
    }
    if (calls >= maxCalls && !fake) {
      console.warn('[ob-van][quiz-tts] call cap reached — going text-only');
      return null;
    }
    await acquire();
    const started = Date.now();
    try {
      const pcm = await fetchPcm(text, voiceId);
      const durationMs = Math.round((pcm.length / SR) * 1000);
      const mouth = mouthTrack(pcm);
      await mux(pcm, mp4Path);
      await fs.writeFile(jsonPath, JSON.stringify({ durationMs, mouth }));
      console.log(
        `[ob-van][quiz-tts] synth ${durationMs}ms audio in ${Date.now() - started}ms — "${text.slice(0, 48)}"`,
      );
      return { file: mp4Path, durationMs, mouth };
    } catch (err) {
      console.warn(
        `[ob-van][quiz-tts] synth failed (${(err as Error).message}) — "${text.slice(0, 48)}"`,
      );
      return null;
    } finally {
      release();
    }
  }

  return {
    hostVoice,
    voiceOf: (model) => voices[model],
    synth(text, voiceId) {
      const line = text.trim();
      if (disposed || !line || !voiceId) return Promise.resolve(null);
      const key = sha1(`${voiceId}|${line}`);
      const running = inFlight.get(key);
      if (running) return running;
      const p = synthUncached(line, voiceId, key).finally(() =>
        inFlight.delete(key),
      );
      inFlight.set(key, p);
      return p;
    },
    warm(lines) {
      for (const { text, voiceId } of lines) void this.synth(text, voiceId);
    },
    dispose() {
      disposed = true;
    },
  };
}
