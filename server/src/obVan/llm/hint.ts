/**
 * OB Van LLM — the Smelterionaire "Ask the AI" lifeline. One text call per
 * use: the quiz question plus its four answers, answered through the strict
 * `give_hint` tool. The model answers BLIND — it is never told the correct
 * letter, so a confidently wrong hint is a legitimate (and welcome) outcome.
 * Cheap by design: no images, `maxTokens` 300, 8 s timeout, no retry — the
 * quiz machine's pending-hint timeout owns the fallback.
 */
import type { ObQuizLetter } from '@smelter-editor/types';
import { isObQuizLetter } from '@smelter-editor/types';
import type { ObLlmClient, ObLlmUsage } from './client';
import { toStrictSchema, type ObLlmToolDef } from './schema';

export type ObQuizHintInput = {
  question: string;
  answers: [string, string, string, string];
};

export type ObQuizHintResult = {
  letter: ObQuizLetter;
  text: string;
};

export type ObQuizHintOptions = {
  onUsage?: (usage: ObLlmUsage) => void;
  signal?: AbortSignal;
};

export const OB_QUIZ_HINT_TOOL: ObLlmToolDef = {
  name: 'give_hint',
  description:
    "Give the contestant your best answer to the quiz question, in character.",
  inputSchema: toStrictSchema({
    type: 'object',
    additionalProperties: false,
    properties: {
      answer: {
        type: 'string',
        enum: ['A', 'B', 'C', 'D'],
        description: 'The letter you believe is correct.',
      },
      quip: {
        type: 'string',
        maxLength: 200,
        description:
          "One playful on-air sentence pointing at your letter, like \"I'm fairly sure it's B — that's what my shaders are written in.\" At most 160 characters.",
      },
    },
    required: ['answer', 'quip'],
  }),
};

/** Fixed system prompt (stable prefix caches across lifeline calls). */
export const OB_QUIZ_HINT_SYSTEM = `You are the AI director of the live quiz show "Who Wants to Be a Smelterionaire?" — the same AI that is cutting the cameras right now. A contestant just burned their one lifeline on you.
You are NOT told the correct answer. Reason it out and commit to one letter — confident, a little smug, never hedging across two letters. Your sentence is shown on the live program overlay.
Answer ONLY by calling the give_hint tool.`;

export function buildQuizHintUser(input: ObQuizHintInput): string {
  const letters: ObQuizLetter[] = ['A', 'B', 'C', 'D'];
  return [
    `Question: ${input.question}`,
    ...input.answers.map((a, i) => `${letters[i]}. ${a}`),
    'Which letter is correct? Call give_hint.',
  ].join('\n');
}

const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Tool input → result; null when the shape is off (strict should prevent it). */
export function parseQuizHintResult(raw: unknown): ObQuizHintResult | null {
  if (!isRec(raw)) return null;
  if (!isObQuizLetter(raw.answer)) return null;
  const text =
    typeof raw.quip === 'string' ? raw.quip.trim().slice(0, 200) : '';
  if (!text) return null;
  return { letter: raw.answer, text };
}

/**
 * One lifeline call; `null` when the model refused or answered without the
 * tool (usage was still spent and reported through `onUsage`).
 */
export async function quizHint(
  client: ObLlmClient,
  input: ObQuizHintInput,
  opts: ObQuizHintOptions = {},
): Promise<ObQuizHintResult | null> {
  const result = await client.call({
    system: OB_QUIZ_HINT_SYSTEM,
    user: buildQuizHintUser(input),
    tool: OB_QUIZ_HINT_TOOL,
    maxTokens: 300,
    effort: 'low',
    timeoutMs: 8_000,
    signal: opts.signal,
  });
  opts.onUsage?.(result.usage);
  return parseQuizHintResult(result.toolInput);
}
