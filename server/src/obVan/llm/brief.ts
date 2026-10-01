/**
 * OB Van LLM — brief → ruleset. One `propose_ruleset` call, then the output
 * goes through the same permissive parser as every other ruleset
 * (`parseObRuleset`, preset as fallback for pacing / weights) and rules that
 * point at cameras which do not exist are dropped with a warning.
 */
import {
  obPresetRuleset,
  obShotCams,
  parseObRuleset,
  type ObCamSelector,
  type ObCondition,
  type ObConditionLeaf,
  type ObPresetId,
  type ObRule,
  type ObRuleset,
} from '@smelter-editor/types';
import type { ObBriefResult, ObSituation } from '../contracts';
import type { ObLlmClient, ObLlmUsage } from './client';
import { ObLlmError } from './errors';
import { buildBriefUser, OB_LLM_SYSTEM } from './prompts';
import { OB_PROPOSE_RULESET_TOOL } from './schema';

export type ObBriefInput = {
  brief: string;
  presetId: ObPresetId;
  cams: ObSituation['cams'];
  eventName?: string;
};

export type ObBriefOptions = {
  /** Called once per API call with its usage (also when the output is rejected). */
  onUsage?: (usage: ObLlmUsage) => void;
  signal?: AbortSignal;
};

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function leavesOf(c: ObCondition): ObConditionLeaf[] {
  if ('all' in c) return c.all;
  if ('any' in c) return c.any;
  if ('not' in c) return [c.not];
  return [c];
}

/** Every camera selector a rule mentions. */
export function obRuleSelectors(rule: ObRule): ObCamSelector[] {
  const out: ObCamSelector[] = [];
  for (const leaf of leavesOf(rule.when)) if (leaf.cam) out.push(leaf.cam);
  if (rule.then.shot) out.push(...obShotCams(rule.then.shot));
  if (rule.then.lowerThird) out.push(rule.then.lowerThird.cam);
  if (rule.then.replay) out.push(rule.then.replay.cam);
  return out;
}

/**
 * Drop rules that reference a camera number (`cam:N`) or id (`id:X`) that is
 * not in `cams`. Role selectors stay (a missing role simply never fires).
 */
export function dropUnknownCams(
  ruleset: ObRuleset,
  cams: Pick<ObSituation['cams'][number], 'number' | 'camId'>[],
): { ruleset: ObRuleset; warnings: string[] } {
  const numbers = new Set(cams.map((c) => c.number));
  const ids = new Set(cams.map((c) => c.camId));
  const warnings: string[] = [];
  const unknown = (sel: ObCamSelector): boolean => {
    const byNumber = /^cam:(\d+)$/.exec(sel);
    if (byNumber) return !numbers.has(Number(byNumber[1]));
    if (sel.startsWith('id:')) return !ids.has(sel.slice(3));
    return false;
  };
  const rules = ruleset.rules.filter((rule) => {
    const bad = obRuleSelectors(rule).filter(unknown);
    if (!bad.length) return true;
    warnings.push(
      `rule "${rule.id}" dropped: unknown camera ${[...new Set(bad)].join(', ')}`,
    );
    return false;
  });
  return { ruleset: { ...ruleset, rules }, warnings };
}

/** Tool-input keyword list `[{group, words}]` → the DSL's record. */
function keywordListToRecord(raw: unknown[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const item of raw) {
    if (
      !isRec(item) ||
      typeof item.group !== 'string' ||
      !Array.isArray(item.words)
    )
      continue;
    const words = item.words.filter((w): w is string => typeof w === 'string');
    if (item.group.trim() && words.length) out[item.group.trim()] = words;
  }
  return out;
}

export async function generateRuleset(
  client: ObLlmClient,
  input: ObBriefInput,
  opts: ObBriefOptions = {},
): Promise<ObBriefResult> {
  const brief = input.brief.trim();
  if (!brief) throw new ObLlmError('invalid_ruleset', 'The brief is empty.');
  const preset = obPresetRuleset(input.presetId);
  const res = await client.call({
    system: OB_LLM_SYSTEM,
    user: buildBriefUser({
      brief,
      presetId: input.presetId,
      preset,
      cams: input.cams,
      eventName: input.eventName,
    }),
    tool: OB_PROPOSE_RULESET_TOOL,
    maxTokens: 8000,
    effort: 'medium',
    timeoutMs: 90_000,
    retries: 1,
    signal: opts.signal,
  });
  opts.onUsage?.(res.usage);

  if (res.stopReason === 'refusal') {
    throw new ObLlmError(
      'refused',
      'The model declined to write rules for this brief.',
    );
  }
  if (res.toolInput === null) {
    throw new ObLlmError(
      'no_tool',
      `The model did not propose a ruleset${res.text ? `: ${res.text.slice(0, 200)}` : '.'}`,
    );
  }
  if (!isRec(res.toolInput) || !isRec(res.toolInput.ruleset)) {
    throw new ObLlmError(
      'invalid_ruleset',
      'The model returned no ruleset object.',
      ['tool input has no "ruleset" object'],
    );
  }
  const rationale =
    typeof res.toolInput.rationale === 'string'
      ? res.toolInput.rationale.trim().slice(0, 600)
      : '';
  const raw: Rec = {
    ...res.toolInput.ruleset,
    id: `llm-${input.presetId}`,
    preset: input.presetId,
  };
  if (Array.isArray(raw.keywords)) {
    const keywords = keywordListToRecord(raw.keywords);
    if (Object.keys(keywords).length) raw.keywords = keywords;
    else delete raw.keywords;
  }

  const parsed = parseObRuleset(raw, preset);
  if (!parsed.ruleset) {
    throw new ObLlmError(
      'invalid_ruleset',
      `The proposed ruleset is invalid: ${parsed.errors.join('; ')}`,
      [...parsed.errors, ...parsed.warnings],
    );
  }
  const dropped = dropUnknownCams(parsed.ruleset, input.cams);
  const warnings = [...parsed.warnings, ...dropped.warnings];
  if (parsed.ruleset.rules.length > 0 && dropped.ruleset.rules.length === 0) {
    warnings.push('every rule referenced unknown cameras — scoring only');
  }
  return { ruleset: dropped.ruleset, rationale, warnings };
}
