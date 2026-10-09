/**
 * OB Van LLM — the AI PANEL's free-text panelists: OPUS (Anthropic) and GPT
 * (OpenAI-compatible) answering the live host's spoken questions in one or
 * two short on-air sentences, with the rolling conversation as context.
 *
 * Same hygiene as the quiz contestants (`contestants.ts`): adapters never
 * throw and never go through `runOneShot` — any failure (missing key,
 * timeout, bad response) resolves `null` and the panel machine substitutes a
 * canned line. One call in flight per adapter, a process-wide call cap
 * (`OB_PANEL_AI_MAX_CALLS`), latency logged as `[ob-van][panel-ai]`.
 */
import Anthropic from '@anthropic-ai/sdk';
import type {
  ObPanelHistoryEntry,
  ObPanelSpeakerId,
} from '@smelter-editor/types';
import { AnthropicObLlmClient } from './client';

export type ObPanelistInput = {
  question: string;
  /** Prior conversation, oldest first (the question is not in it). */
  history: ObPanelHistoryEntry[];
  signal?: AbortSignal;
};

export interface ObPanelist {
  readonly id: ObPanelSpeakerId;
  /** Provider model id (for logs / the desk). */
  readonly model: string;
  /** False = no API key (or the cap is spent) — canned path, no call. */
  available(): boolean;
  /** Resolves `null` on any failure; never rejects. */
  discuss(input: ObPanelistInput): Promise<{ text: string } | null>;
}

export type ObPanelAiModule = {
  panelists: Record<ObPanelSpeakerId, ObPanelist>;
  /** TTS voice for a panelist (overridable per panel, falls back to quiz). */
  voiceOf(model: ObPanelSpeakerId): string | null;
};

/** Hard ceiling on panelist calls per process (runaway guard). */
const DEFAULT_MAX_CALLS = 200;
const ANTHROPIC_TIMEOUT_MS = 20_000;
const OPENAI_COMPAT_TIMEOUT_MS = 25_000;
/** Spoken answers must stay short — trim whatever the model returns. */
const MAX_ANSWER_CHARS = 300;

const PERSONAS: Record<ObPanelSpeakerId, string> = {
  opus: 'You are OPUS, the Anthropic flagship: eloquent, a touch theatrical, quietly certain you are the smartest one on the panel.',
  gpt: 'You are GPT, the OpenAI flagship: upbeat, polished, relentlessly helpful even when nobody asked.',
};

const personaSystem = (persona: string) =>
  `${persona}
You are a panelist on a live TV discussion. A human host asks questions out loud; your reply is spoken ON AIR by a text-to-speech voice, word for word.
Rules: answer OUT LOUD style — at most two short sentences, under 220 characters. Plain spoken English only: no markdown, no emoji, no lists, no stage directions. Be in character, take a stance, never hedge into a lecture. The other panelist answers the same question, so make your take your own.`;

const buildUser = (input: ObPanelistInput, otherName: string) => {
  const lines: string[] = [];
  if (input.history.length) {
    lines.push('The conversation so far:');
    for (const h of input.history) {
      const who =
        h.speaker === 'host'
          ? 'HOST'
          : h.speaker === 'opus'
            ? 'OPUS'
            : 'GPT';
      lines.push(`${who}: ${h.text}`);
    }
    lines.push('');
  }
  lines.push(`The host now asks: ${input.question}`);
  lines.push(
    `Give your spoken answer (${otherName} will answer too — don't speak for them).`,
  );
  return lines.join('\n');
};

const cleanAnswer = (text: string): string | null => {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length > MAX_ANSWER_CHARS
    ? `${flat.slice(0, MAX_ANSWER_CHARS - 1).replace(/[,;:\s]+\S*$/, '')}…`
    : flat;
};

const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// ── Anthropic (OPUS) ──────────────────────────────────────────────────────

class AnthropicPanelist implements ObPanelist {
  readonly id = 'opus' as const;
  readonly model: string;
  private readonly client: AnthropicObLlmClient | null;

  constructor(env: NodeJS.ProcessEnv) {
    this.model =
      env.OB_PANEL_OPUS_MODEL?.trim() ||
      env.OB_QUIZ_OPUS_MODEL?.trim() ||
      'claude-opus-5';
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

  async discuss(input: ObPanelistInput): Promise<{ text: string } | null> {
    if (!this.client) return null;
    // No tool — a plain text answer is exactly what goes on air.
    const result = await this.client.call({
      system: personaSystem(PERSONAS.opus),
      user: buildUser(input, 'GPT'),
      maxTokens: 300,
      effort: 'low',
      timeoutMs: ANTHROPIC_TIMEOUT_MS,
      signal: input.signal,
    });
    const text = cleanAnswer(result.text);
    return text ? { text } : null;
  }
}

// ── OpenAI-compatible (GPT) ───────────────────────────────────────────────

class OpenAiCompatPanelist implements ObPanelist {
  readonly id = 'gpt' as const;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;

  constructor(env: NodeJS.ProcessEnv) {
    this.model =
      env.OB_PANEL_GPT_MODEL?.trim() ||
      env.OB_QUIZ_GPT_MODEL?.trim() ||
      'gpt-6-astra';
    this.baseUrl = (
      env.OB_PANEL_GPT_BASE_URL?.trim() ||
      env.OB_QUIZ_GPT_BASE_URL?.trim() ||
      'https://api.openai.com/v1'
    ).replace(/\/$/, '');
    this.apiKey = env.OPENAI_API_KEY?.trim() || undefined;
  }

  available(): boolean {
    return !!this.apiKey;
  }

  async discuss(input: ObPanelistInput): Promise<{ text: string } | null> {
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
          { role: 'system', content: personaSystem(PERSONAS.gpt) },
          { role: 'user', content: buildUser(input, 'OPUS') },
        ],
      }),
    });
    if (!res.ok) {
      console.warn(
        `[ob-van][panel-ai] gpt HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`,
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
    const text = cleanAnswer(content);
    return text ? { text } : null;
  }
}

// ── Factory ───────────────────────────────────────────────────────────────

/**
 * One call in flight (a second `discuss()` while busy resolves `null`
 * immediately), the process-wide call cap, latency logging, catch-all.
 */
function withGuards(
  inner: ObPanelist,
  budget: { calls: number; max: number },
): ObPanelist {
  let inFlight = false;
  return {
    id: inner.id,
    model: inner.model,
    available: () => inner.available() && budget.calls < budget.max,
    async discuss(input) {
      if (!inner.available()) return null;
      if (inFlight) {
        console.warn(`[ob-van][panel-ai] ${inner.id} busy — dropping ask`);
        return null;
      }
      if (budget.calls >= budget.max) {
        console.warn(`[ob-van][panel-ai] call cap ${budget.max} reached`);
        return null;
      }
      budget.calls++;
      inFlight = true;
      const started = Date.now();
      try {
        const res = await inner.discuss(input);
        console.log(
          `[ob-van][panel-ai] ${inner.id} (${inner.model}) ${
            res ? `→ ${res.text.length} chars` : '→ null'
          } in ${Date.now() - started} ms`,
        );
        return res;
      } catch (e) {
        console.warn(
          `[ob-van][panel-ai] ${inner.id} failed after ${Date.now() - started} ms:`,
          e instanceof Error ? e.message : e,
        );
        return null;
      } finally {
        inFlight = false;
      }
    },
  };
}

export function createObPanelAi(
  env: NodeJS.ProcessEnv = process.env,
  quizVoiceOf?: (model: ObPanelSpeakerId) => string | null,
): ObPanelAiModule {
  const max = Number(env.OB_PANEL_AI_MAX_CALLS) || DEFAULT_MAX_CALLS;
  const budget = { calls: 0, max };
  const voices: Record<ObPanelSpeakerId, string | null> = {
    opus: env.OB_PANEL_TTS_VOICE_OPUS?.trim() || null,
    gpt: env.OB_PANEL_TTS_VOICE_GPT?.trim() || null,
  };
  return {
    panelists: {
      opus: withGuards(new AnthropicPanelist(env), budget),
      gpt: withGuards(new OpenAiCompatPanelist(env), budget),
    },
    voiceOf: (model) => voices[model] ?? quizVoiceOf?.(model) ?? null,
  };
}
