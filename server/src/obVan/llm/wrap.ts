/**
 * OB Van LLM — wrap-up notes for the director (≤ 120 words, plain text,
 * medium effort, no tool).
 */
import type { ObLogEntry, ObStats } from '@smelter-editor/types';
import type { ObLlmClient, ObLlmUsage } from './client';
import { ObLlmError } from './errors';
import { buildWrapUser, OB_LLM_SYSTEM, OB_LLM_WRAP_MAX_WORDS } from './prompts';

export type ObWrapInput = {
  eventName: string;
  brief: string;
  stats: ObStats;
  log: ObLogEntry[];
  cams: { camId: string; number: number; name: string; role: string }[];
};

/** Clip to `max` words (the model is asked for ≤ 120; this enforces it). */
export function clipWords(text: string, max: number): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length <= max) return words.join(' ');
  return `${words
    .slice(0, max)
    .join(' ')
    .replace(/[,;:]$/, '')}…`;
}

export async function generateWrapNotes(
  client: ObLlmClient,
  input: ObWrapInput,
  opts: { onUsage?: (usage: ObLlmUsage) => void; signal?: AbortSignal } = {},
): Promise<string> {
  const res = await client.call({
    system: OB_LLM_SYSTEM,
    user: buildWrapUser(input),
    maxTokens: 2000,
    effort: 'medium',
    timeoutMs: 60_000,
    retries: 1,
    signal: opts.signal,
  });
  opts.onUsage?.(res.usage);
  if (res.stopReason === 'refusal')
    throw new ObLlmError('refused', 'The model declined to write wrap notes.');
  const notes = clipWords(res.text, OB_LLM_WRAP_MAX_WORDS);
  if (!notes)
    throw new ObLlmError('empty', 'The model returned no wrap notes.');
  return notes;
}
