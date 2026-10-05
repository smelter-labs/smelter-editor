/**
 * OB Van LLM — Max Smelter, the AI quiz host (text-only for now).
 *
 * Canned template lines render instantly on every quiz beat; when an
 * Anthropic key is present, a cheap haiku call rewrites the intro and reveal
 * lines and the controller swaps the text in if it lands while the plate is
 * still up. `config.quiz.aiHost = false` turns all of it off — a human host
 * on the `speaker` cam simply talks instead.
 *
 * Also home of `createObQuizAi()`, the module the controller consumes: the
 * four contestant adapters plus the host lines, fully parallel-safe and
 * deliberately OUTSIDE `llm/index.ts`'s serialised `runOneShot` gate (a
 * contestant must be able to think while the analyst or the lifeline runs).
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ObQuizModelId, ObQuizVerdict } from '@smelter-editor/types';
import { AnthropicObLlmClient } from './client';
import { createObQuizContestants, type ObQuizContestant } from './contestants';

export type ObQuizHostEvent =
  | { kind: 'intro'; eventName: string }
  | { kind: 'assign'; name: string; number: number }
  | { kind: 'board' }
  | { kind: 'answer'; name: string; letter: string; quip: string | null }
  | {
      kind: 'reveal';
      name: string;
      verdict: ObQuizVerdict;
      amountText: string;
    }
  /** The Gemini cameo: a contestant retires with their pot. */
  | { kind: 'cashout'; name: string; amountText: string }
  | { kind: 'wrap'; leaderName: string; amountText: string };

const pick = <T>(list: T[], seed: string): T => {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return list[Math.abs(hash) % list.length];
};

/** Instant, deterministic host line for a quiz beat (≤120 chars on air). */
export function cannedHostLine(evt: ObQuizHostEvent): string {
  switch (evt.kind) {
    case 'intro':
      return pick(
        [
          'Welcome to Smelterionaire — four minds, a million tokens each, zero mercy.',
          'This is Smelterionaire, where the contestants read the docs so you don’t have to.',
        ],
        evt.eventName,
      );
    case 'assign':
      return pick(
        [
          `Question ${evt.number} — ${evt.name}, the spotlight is yours.`,
          `${evt.name}, step up. Question ${evt.number}, for the money.`,
        ],
        `${evt.name}${evt.number}`,
      );
    case 'board':
      return pick(
        [
          'Four answers on the board. Only one pays.',
          'The board is up. Take your time — the tokens won’t.',
        ],
        'board',
      );
    case 'answer':
      return pick(
        [
          `${evt.name} locks ${evt.letter}. Bold.`,
          `${evt.letter}, says ${evt.name}. Let’s see about that.`,
        ],
        `${evt.name}${evt.letter}`,
      );
    case 'reveal':
      return evt.verdict === 'correct'
        ? pick(
            [
              `Correct! ${evt.name} climbs to ${evt.amountText}.`,
              `That’s the one — ${evt.name} is sitting on ${evt.amountText}.`,
            ],
            `${evt.name}${evt.amountText}`,
          )
        : pick(
            [
              `Oh no. The pot shrinks — ${evt.name} is down to ${evt.amountText}.`,
              `Wrong! ${evt.name}, that answer just cost you. ${evt.amountText} left.`,
            ],
            `${evt.name}${evt.amountText}`,
          );
    case 'cashout':
      return pick(
        [
          `${evt.name} is… leaving? Taking ${evt.amountText} and walking. Unbelievable.`,
          `And ${evt.name} cashes out ${evt.amountText} without answering a thing. Security!`,
        ],
        evt.name,
      );
    case 'wrap':
      return `That’s the game — ${evt.leaderName} leads with ${evt.amountText}. Smelterionaire, out.`;
  }
}

// ── Pre-warmable interstitials (spoken, never on the text plates) ─────────
// Latency theatre: a contestant murmur starts the instant the question is
// asked, covering the adapter + quip-synth wait; the host filler drops in
// only when the thinking runs long. All short, so the disk cache makes them
// free after the first show.

const MURMURS: Partial<Record<ObQuizModelId, string[]>> = {
  opus: [
    'Hmm. Let me compose myself.',
    'Fascinating. Give me a moment.',
    'One moment — savoring the question.',
  ],
  gpt: [
    'Great question — paging the docs back in!',
    'Okay okay okay — thinking!',
    'Love it. Running the numbers!',
  ],
  // jev never talks; gemini never thinks (it walks).
};

export function cannedMurmur(
  model: ObQuizModelId,
  seed: string,
): string | null {
  const pool = MURMURS[model];
  return pool ? pick(pool, seed) : null;
}

const HOST_FILLERS = [
  'Take your time — the clock is only a metaphor.',
  'Somewhere in a datacenter, fans are spinning for this.',
  'No pressure. It’s only a million tokens.',
];

export function cannedHostFiller(seed: string): string {
  return pick(HOST_FILLERS, seed);
}

/** The GEMINI cameo's only spoken words before walking out. */
export const OB_QUIZ_FAREWELL_LINE =
  'I have seen enough. I’m taking the million. Goodbye.';

/** Everything static enough to synthesise ahead of the show. */
export function quizWarmLines(): {
  host: string[];
  byModel: Partial<Record<ObQuizModelId, string[]>>;
} {
  return {
    host: [...HOST_FILLERS, cannedHostLine({ kind: 'board' })],
    byModel: { ...MURMURS, gemini: [OB_QUIZ_FAREWELL_LINE] },
  };
}

const HOST_SYSTEM = `You are Max Smelter, the sharp-tongued host of the live quiz show "Who Wants to Be a Smelterionaire?", where AI models compete on Smelter (the video compositing toolkit) trivia. Write EXACTLY ONE on-air host line for the moment described: punchy, warm, a little wicked, UNDER 110 characters. No quotes, no emoji, no stage directions — just the line.`;

const hostUser = (evt: ObQuizHostEvent): string => {
  switch (evt.kind) {
    case 'intro':
      return `The show "${evt.eventName}" is going live right now. Open it.`;
    case 'reveal':
      return `Contestant ${evt.name} (an AI model) just answered ${
        evt.verdict === 'correct' ? 'CORRECTLY' : 'WRONG'
      } and now has ${evt.amountText}. React.`;
    default:
      return 'React to the moment.';
  }
};

// ── Module factory ────────────────────────────────────────────────────────

export interface ObQuizAiModule {
  contestants: Record<ObQuizModelId, ObQuizContestant>;
  /** Instant deterministic line — always available. */
  cannedHostLine(evt: ObQuizHostEvent): string;
  /**
   * LLM rewrite of the line (intro/reveal only); `null` without a key, on
   * failure, while a previous polish is still running, or for beats that
   * stay canned. Never rejects.
   */
  polishHostLine(evt: ObQuizHostEvent): Promise<string | null>;
  dispose(): void;
}

export function createObQuizAi(
  env: NodeJS.ProcessEnv = process.env,
): ObQuizAiModule {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  const host = apiKey
    ? new AnthropicObLlmClient({
        model: env.OB_QUIZ_HOST_MODEL?.trim() || 'claude-haiku-4-5',
        messages: new Anthropic({ apiKey }).messages,
      })
    : null;
  let hostBusy = false;
  let disposed = false;
  return {
    contestants: createObQuizContestants(env),
    cannedHostLine,
    async polishHostLine(evt) {
      if (!host || disposed || hostBusy) return null;
      if (evt.kind !== 'intro' && evt.kind !== 'reveal') return null;
      hostBusy = true;
      try {
        const result = await host.call({
          system: HOST_SYSTEM,
          user: hostUser(evt),
          maxTokens: 120,
          effort: 'low',
          timeoutMs: 4_000,
        });
        const line = result.text.trim().replace(/^["']|["']$/g, '');
        return line && line.length <= 140 ? line : null;
      } catch {
        return null;
      } finally {
        hostBusy = false;
      }
    },
    dispose() {
      disposed = true;
    },
  };
}
