/**
 * OB Van LLM — Smelterionaire's AI contestants: one adapter per model
 * (Opus/Anthropic, GPT/OpenAI, Jev/TypeSafe AI), all answering the same way
 * the lifeline does — BLIND, given only the question, the four answers and
 * the shared Smelter study pack. Wrong answers are part of the show. The
 * fourth chair, GEMINI, is a staged cameo with no API behind it: asked
 * anything, it "answers" by cashing out its million tokens and leaving.
 *
 * Adapters never throw and never go through `runOneShot` (four contestants
 * and the lifeline must be able to think at the same time): any failure —
 * missing key, timeout, bad response — resolves `null`, and the quiz machine
 * turns that into a canned answer. Each adapter allows one call in flight,
 * and the factory enforces a process-wide call cap so AUTO mode can never
 * run away.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ObQuizLetter, ObQuizModelId } from '@smelter-editor/types';
import { OB_QUIZ_LETTERS, isObQuizLetter } from '@smelter-editor/types';
import { AnthropicObLlmClient } from './client';
import { toStrictSchema, type ObLlmToolDef } from './schema';
import { OB_QUIZ_SMELTER_CONTEXT } from './smelterContext';

export type ObQuizAnswerInput = {
  question: string;
  answers: [string, string, string, string];
  signal?: AbortSignal;
};

export type ObQuizAnswerResult =
  | {
      letter: ObQuizLetter;
      /** In-character on-air sentence (null for Jev — it only decides). */
      quip: string | null;
      /** Jev's calibrated confidence 0..1 (null for chat models). */
      confidence: number | null;
    }
  /** The Gemini cameo: retire with the pot instead of answering. */
  | { cashOut: true };

export interface ObQuizContestant {
  readonly id: ObQuizModelId;
  /** Provider model id (for logs / the panel). */
  readonly model: string;
  /** False = no API key (or the cap is spent) — canned path, no call. */
  available(): boolean;
  /** Resolves `null` on any failure; never rejects. */
  answer(input: ObQuizAnswerInput): Promise<ObQuizAnswerResult | null>;
}

/** Hard ceiling on adapter + host calls per process (AUTO-mode runaway guard). */
const DEFAULT_MAX_CALLS = 200;

const ANTHROPIC_TIMEOUT_MS = 20_000;
const OPENAI_COMPAT_TIMEOUT_MS = 25_000;
const JEV_TIMEOUT_MS = 15_000;

const personaSystem = (persona: string) =>
  `${persona}
You are a contestant on the live quiz show "Who Wants to Be a Smelterionaire?", playing for a million on-screen TOKENS against other AI models. The show is about Smelter. You studied these notes:

${OB_QUIZ_SMELTER_CONTEXT}

You are NOT told the correct answer. Commit to exactly one letter — confident, in character, never hedging across two letters. Your quip is shown on the live program overlay, so keep it to one sentence.`;

const PERSONAS: Record<'opus' | 'gpt', string> = {
  opus: 'You are OPUS, the Anthropic flagship: eloquent, a touch theatrical, quietly certain you are the smartest one on the panel.',
  gpt: 'You are GPT, the OpenAI flagship: upbeat, polished, relentlessly helpful even when nobody asked.',
};

const buildUser = (input: ObQuizAnswerInput) =>
  [
    `Question: ${input.question}`,
    ...input.answers.map((a, i) => `${OB_QUIZ_LETTERS[i]}. ${a}`),
    'Which letter is correct?',
  ].join('\n');

const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const cleanQuip = (v: unknown): string | null => {
  const text = typeof v === 'string' ? v.trim().slice(0, 200) : '';
  return text || null;
};

/** `{answer, quip}` object → result (shared by the Anthropic + OpenAI paths). */
function parseAnswerObject(raw: unknown): ObQuizAnswerResult | null {
  if (!isRec(raw) || !isObQuizLetter(raw.answer)) return null;
  return { letter: raw.answer, quip: cleanQuip(raw.quip), confidence: null };
}

/** Last-resort parse of free text: the first standalone A–D wins. */
function parseLooseAnswer(text: string): ObQuizAnswerResult | null {
  const m = /\b([A-D])\b/.exec(text);
  if (!m) return null;
  return { letter: m[1] as ObQuizLetter, quip: null, confidence: null };
}

// ── Anthropic (OPUS) ──────────────────────────────────────────────────────

const GIVE_ANSWER_TOOL: ObLlmToolDef = {
  name: 'give_answer',
  description: 'Lock in your final answer to the quiz question, in character.',
  inputSchema: toStrictSchema({
    type: 'object',
    additionalProperties: false,
    properties: {
      answer: {
        type: 'string',
        enum: ['A', 'B', 'C', 'D'],
        description: 'The letter you lock in.',
      },
      quip: {
        type: 'string',
        maxLength: 200,
        description:
          'One in-character on-air sentence about your pick. At most 160 characters.',
      },
    },
    required: ['answer', 'quip'],
  }),
};

class AnthropicContestant implements ObQuizContestant {
  readonly id = 'opus' as const;
  readonly model: string;
  private readonly client: AnthropicObLlmClient | null;

  constructor(env: NodeJS.ProcessEnv) {
    this.model = env.OB_QUIZ_OPUS_MODEL?.trim() || 'claude-opus-5';
    const apiKey = env.ANTHROPIC_API_KEY?.trim();
    this.client = apiKey
      ? new AnthropicObLlmClient({
          model: this.model,
          messages: new Anthropic({ apiKey }).messages,
        })
      : null;
  }

  available(): boolean {
    return this.client !== null;
  }

  async answer(input: ObQuizAnswerInput): Promise<ObQuizAnswerResult | null> {
    if (!this.client) return null;
    // toolChoice stays 'auto': forcing `tool_choice: {type:'tool'}` is
    // rejected by current-generation models (client.ts maps 'required' so).
    const result = await this.client.call({
      system: personaSystem(PERSONAS.opus),
      user: buildUser(input) + '\nCall give_answer.',
      tool: GIVE_ANSWER_TOOL,
      maxTokens: 400,
      effort: 'low',
      timeoutMs: ANTHROPIC_TIMEOUT_MS,
      signal: input.signal,
    });
    return parseAnswerObject(result.toolInput) ?? parseLooseAnswer(result.text);
  }
}

// ── OpenAI-compatible (GPT, GROK) ─────────────────────────────────────────

type OpenAiCompatOpts = {
  id: 'gpt';
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
};

class OpenAiCompatContestant implements ObQuizContestant {
  readonly id: ObQuizModelId;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;

  constructor(private readonly opts: OpenAiCompatOpts) {
    this.id = opts.id;
    this.model = opts.model;
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.apiKey = opts.apiKey;
  }

  available(): boolean {
    return !!this.apiKey;
  }

  async answer(input: ObQuizAnswerInput): Promise<ObQuizAnswerResult | null> {
    if (!this.apiKey) return null;
    const signal = input.signal
      ? AbortSignal.any([
          input.signal,
          AbortSignal.timeout(OPENAI_COMPAT_TIMEOUT_MS),
        ])
      : AbortSignal.timeout(OPENAI_COMPAT_TIMEOUT_MS);
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      signal,
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: personaSystem(PERSONAS[this.opts.id]) },
          {
            role: 'user',
            content:
              buildUser(input) +
              '\nReply with JSON only: {"answer":"A"|"B"|"C"|"D","quip":"one sentence"}',
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'give_answer',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                answer: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
                quip: { type: 'string' },
              },
              required: ['answer', 'quip'],
            },
          },
        },
      }),
    });
    if (!res.ok) {
      console.warn(
        `[ob-van][quiz-ai] ${this.id} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`,
      );
      return null;
    }
    const body: unknown = await res.json();
    const content =
      isRec(body) &&
      Array.isArray(body.choices) &&
      isRec(body.choices[0]) &&
      isRec(body.choices[0].message) &&
      typeof body.choices[0].message.content === 'string'
        ? body.choices[0].message.content
        : '';
    if (!content) return null;
    try {
      const parsed = parseAnswerObject(JSON.parse(content));
      if (parsed) return parsed;
    } catch {
      // Not JSON — some providers wrap it; fall through to the loose parse.
    }
    return parseLooseAnswer(content);
  }
}

// ── Jev (TypeSafe AI System One) ──────────────────────────────────────────
//
// Jev doesn't generate text: it returns typed probabilistic decisions.
// `POST /v1/systemone` with a `choice` question over the four answers gives
// back the pick plus a calibrated confidence — which IS its on-air persona.

class JevContestant implements ObQuizContestant {
  readonly id = 'jev' as const;
  readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;

  constructor(env: NodeJS.ProcessEnv) {
    this.apiKey = env.TYPESAFE_API_KEY?.trim() || undefined;
    this.model = env.OB_QUIZ_JEV_MODEL?.trim() || 'jev-latest';
    this.baseUrl =
      env.OB_QUIZ_JEV_BASE_URL?.trim().replace(/\/$/, '') ||
      'https://api.typesafe.ai/v1';
  }

  available(): boolean {
    return !!this.apiKey;
  }

  async answer(input: ObQuizAnswerInput): Promise<ObQuizAnswerResult | null> {
    if (!this.apiKey) return null;
    const signal = input.signal
      ? AbortSignal.any([input.signal, AbortSignal.timeout(JEV_TIMEOUT_MS)])
      : AbortSignal.timeout(JEV_TIMEOUT_MS);
    const res = await fetch(`${this.baseUrl}/systemone`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      signal,
      body: JSON.stringify({
        model: this.model,
        state: `${OB_QUIZ_SMELTER_CONTEXT}\n\n${buildUser(input)}`,
        questions: {
          answer: {
            type: 'choice',
            instructions: 'Which letter answers the quiz question correctly?',
            criteria: {
              A: input.answers[0],
              B: input.answers[1],
              C: input.answers[2],
              D: input.answers[3],
            },
          },
        },
      }),
    });
    if (!res.ok) {
      console.warn(
        `[ob-van][quiz-ai] jev HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`,
      );
      return null;
    }
    const body: unknown = await res.json();
    const ans =
      isRec(body) && isRec(body.answers) && isRec(body.answers.answer)
        ? body.answers.answer
        : null;
    if (!ans || !isObQuizLetter(ans.choice)) return null;
    const confidence =
      typeof ans.confidence === 'number' &&
      ans.confidence >= 0 &&
      ans.confidence <= 1
        ? ans.confidence
        : null;
    return { letter: ans.choice, quip: null, confidence };
  }
}

// ── Gemini (staged cameo) ─────────────────────────────────────────────────
//
// No API behind this chair — and that's the bit. GEMINI sits down, takes one
// look at the first question, cashes out its million tokens and leaves the
// show. Always "available" (it must reach the thinking beat for the gag to
// land); the machine's `cashOut` path retires the player.

class GeminiContestant implements ObQuizContestant {
  readonly id = 'gemini' as const;
  readonly model = 'gemini (cameo)';

  available(): boolean {
    return true;
  }

  async answer(): Promise<ObQuizAnswerResult | null> {
    return { cashOut: true };
  }
}

// ── Factory ───────────────────────────────────────────────────────────────

/**
 * Wrap an adapter with the shared hygiene: one call in flight (a second
 * `answer()` while busy resolves `null` immediately), the process-wide call
 * cap, latency logging, and a catch-all so nothing ever rejects.
 */
function withGuards(
  inner: ObQuizContestant,
  budget: { calls: number; max: number },
): ObQuizContestant {
  let inFlight = false;
  return {
    id: inner.id,
    model: inner.model,
    available: () => inner.available() && budget.calls < budget.max,
    async answer(input) {
      if (!inner.available()) return null;
      if (inFlight) {
        console.warn(`[ob-van][quiz-ai] ${inner.id} busy — dropping ask`);
        return null;
      }
      if (budget.calls >= budget.max) {
        console.warn(`[ob-van][quiz-ai] call cap ${budget.max} reached`);
        return null;
      }
      budget.calls++;
      inFlight = true;
      const started = Date.now();
      try {
        const res = await inner.answer(input);
        console.log(
          `[ob-van][quiz-ai] ${inner.id} (${inner.model}) ${
            res
              ? 'cashOut' in res
                ? '→ cash out'
                : `→ ${res.letter}`
              : '→ null'
          } in ${Date.now() - started} ms`,
        );
        return res;
      } catch (e) {
        console.warn(
          `[ob-van][quiz-ai] ${inner.id} failed after ${Date.now() - started} ms:`,
          e instanceof Error ? e.message : e,
        );
        return null;
      } finally {
        inFlight = false;
      }
    },
  };
}

export function createObQuizContestants(
  env: NodeJS.ProcessEnv = process.env,
): Record<ObQuizModelId, ObQuizContestant> {
  const max = Number(env.OB_QUIZ_AI_MAX_CALLS) || DEFAULT_MAX_CALLS;
  const budget = { calls: 0, max };
  return {
    opus: withGuards(new AnthropicContestant(env), budget),
    gpt: withGuards(
      new OpenAiCompatContestant({
        id: 'gpt',
        baseUrl:
          env.OB_QUIZ_GPT_BASE_URL?.trim() || 'https://api.openai.com/v1',
        apiKey: env.OPENAI_API_KEY?.trim() || undefined,
        model: env.OB_QUIZ_GPT_MODEL?.trim() || 'gpt-6-astra',
      }),
      budget,
    ),
    // The cameo stays outside the call budget — it never calls anything.
    gemini: new GeminiContestant(),
    jev: withGuards(new JevContestant(env), budget),
  };
}
