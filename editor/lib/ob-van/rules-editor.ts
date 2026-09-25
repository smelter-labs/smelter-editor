import {
  OB_RULESET_LIMITS,
  isObCamRole,
  parseObRuleset,
  type ObAction,
  type ObCamSelector,
  type ObCondition,
  type ObConditionLeaf,
  type ObRule,
  type ObRuleset,
  type ObRulesetParse,
  type ObShotTemplate,
  type ObSignalKind,
} from '@smelter-editor/types';
import { roleLabel } from './roles';
import { SHOT_LABEL, TRANSITION_LABEL } from './view-labels';
import { formatSeconds } from './pacing';

// Rules cards: small immutable edits (enable, priority, cooldown), the human
// summary of a rule's `when` / `then`, and the RAW JSON drawer's parse. The
// server re-validates every ruleset (`POST ruleset`), so this is UX only.

export function isRuleEnabled(rule: Pick<ObRule, 'enabled'>): boolean {
  return rule.enabled !== false;
}

function mapRule(
  ruleset: ObRuleset,
  id: string,
  fn: (rule: ObRule) => ObRule,
): ObRuleset {
  return {
    ...ruleset,
    rules: ruleset.rules.map((r) => (r.id === id ? fn(r) : r)),
  };
}

export function toggleRule(ruleset: ObRuleset, id: string): ObRuleset {
  return mapRule(ruleset, id, (r) => ({ ...r, enabled: !isRuleEnabled(r) }));
}

export function setRulePriority(
  ruleset: ObRuleset,
  id: string,
  priority: number,
): ObRuleset {
  const { min, max } = OB_RULESET_LIMITS.priority;
  const p = Math.round(Math.min(max, Math.max(min, priority)));
  return mapRule(ruleset, id, (r) => ({ ...r, priority: p }));
}

export function setRuleCooldown(
  ruleset: ObRuleset,
  id: string,
  cooldownMs: number,
): ObRuleset {
  const { min, max } = OB_RULESET_LIMITS.cooldownMs;
  const ms = Math.round(Math.min(max, Math.max(min, cooldownMs)));
  return mapRule(ruleset, id, (r) => ({ ...r, cooldownMs: ms }));
}

export function removeRule(ruleset: ObRuleset, id: string): ObRuleset {
  return { ...ruleset, rules: ruleset.rules.filter((r) => r.id !== id) };
}

/** Pretty JSON for the RAW drawer. */
export function rulesetToJson(ruleset: ObRuleset): string {
  return JSON.stringify(ruleset, null, 2);
}

/** RAW JSON → the shared permissive parser; a syntax error is one error line. */
export function parseRulesetJson(
  text: string,
  fallback: ObRuleset,
): ObRulesetParse {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ruleset: null, warnings: [], errors: [`JSON: ${msg}`] };
  }
  return parseObRuleset(raw, fallback);
}

/** Where a rule came from, for its badge. */
export type RuleOrigin = 'preset' | 'edited' | 'llm' | 'custom';

/**
 * PRESET when the rule is the preset's own, EDITED when it has the preset's
 * id but different content, otherwise the ruleset's origin (LLM / CUSTOM).
 */
export function ruleOrigin(
  rule: ObRule,
  preset: ObRuleset | null,
  rulesetOrigin: 'llm' | 'custom',
): RuleOrigin {
  const base = preset?.rules.find((r) => r.id === rule.id);
  if (!base) return rulesetOrigin;
  const strip = (r: ObRule) => ({ ...r, enabled: isRuleEnabled(r) });
  return JSON.stringify(strip(base)) === JSON.stringify(strip(rule))
    ? 'preset'
    : 'edited';
}

// ── human summary ─────────────────────────────────────────────────────────

const SIGNAL_WORD: Record<ObSignalKind, string> = {
  speech: 'speech',
  silence: 'silence',
  speechShare: 'speech share',
  rms: 'loudness',
  onset: 'speech onset',
  onsetsPerSec: 'onsets/s',
  motion: 'motion',
  motionSpike: 'motion spike',
  burst: 'burst',
  people: 'people',
  ball: 'ball in view',
  ballAge: 'ball last seen',
  keyword: 'keyword',
  hold: 'program held',
  segment: 'segment',
  dialogue: 'back-and-forth',
};

/** Signals whose values are milliseconds. */
const MS_SIGNALS: readonly ObSignalKind[] = ['hold', 'ballAge'];
/** Signals that are about the whole show, not one camera. */
const GLOBAL_SIGNALS: readonly ObSignalKind[] = [
  'hold',
  'segment',
  'dialogue',
  'keyword',
];

/** A camera selector in words: `SPEAKER`, `CAM 2`, `OFF-AIR BEST`. */
export function selectorLabel(sel: ObCamSelector): string {
  if (sel === 'any') return 'ANY CAM';
  if (sel === 'program') return 'PROGRAM';
  if (sel === 'not-program') return 'BEST OFF-AIR';
  if (sel === 'trigger') return 'THAT CAM';
  if (sel.startsWith('cam:')) return `CAM ${sel.slice(4)}`;
  if (sel.startsWith('id:')) return `CAM ${sel.slice(3)}`;
  return isObCamRole(sel) ? roleLabel(sel) : String(sel).toUpperCase();
}

function valueText(
  signal: ObSignalKind,
  value: ObConditionLeaf['value'],
): string {
  if (typeof value === 'number' && MS_SIGNALS.includes(signal))
    return formatSeconds(value);
  if (typeof value === 'string') return `"${value}"`;
  return String(value);
}

export function leafSummary(leaf: ObConditionLeaf): string {
  const word = SIGNAL_WORD[leaf.signal] ?? leaf.signal;
  let text: string;
  if (leaf.op === 'has' || (leaf.signal === 'keyword' && leaf.value != null)) {
    text = `${word} ${valueText(leaf.signal, leaf.value ?? '')}`;
  } else if (
    leaf.op &&
    leaf.value !== undefined &&
    typeof leaf.value !== 'boolean'
  ) {
    text = `${word} ${leaf.op} ${valueText(leaf.signal, leaf.value)}`;
  } else if (
    leaf.value === false ||
    (leaf.op === '!=' && leaf.value === true)
  ) {
    text = `no ${word}`;
  } else {
    text = word;
  }
  if (leaf.cam && !GLOBAL_SIGNALS.includes(leaf.signal))
    text += ` on ${selectorLabel(leaf.cam)}`;
  if (leaf.forMs && leaf.forMs > 0) text += ` for ${formatSeconds(leaf.forMs)}`;
  return text;
}

export function conditionSummary(when: ObCondition): string {
  if ('all' in when) return when.all.map(leafSummary).join(' AND ');
  if ('any' in when) return when.any.map(leafSummary).join(' OR ');
  if ('not' in when) return `NOT ${leafSummary(when.not)}`;
  return leafSummary(when);
}

export function shotTemplateSummary(shot: ObShotTemplate): string {
  const s = selectorLabel;
  switch (shot.kind) {
    case 'solo':
      return s(shot.cam);
    case 'virtual':
      return `VIRTUAL ${s(shot.cam)}${shot.target ? ` → ${shot.target.toUpperCase()}` : ''}`;
    case 'pip':
      return `PIP ${s(shot.main)} / ${s(shot.inset)}`;
    case 'speaker-slides':
      return `SLIDES ${s(shot.slides)} + ${s(shot.speaker)}`;
    case 'split':
      return `SPLIT ${shot.cams.map(s).join(' + ')}`;
    case 'quad':
    case 'grid':
      return shot.cams.length === 0
        ? `${SHOT_LABEL[shot.kind]} ALL`
        : `${SHOT_LABEL[shot.kind]} ${shot.cams.map(s).join(' + ')}`;
  }
}

export function actionSummary(then: ObAction): string {
  const parts: string[] = [];
  if (then.shot) parts.push(shotTemplateSummary(then.shot));
  if (then.transition) {
    const ms = then.transition.durationMs;
    parts.push(
      `${TRANSITION_LABEL[then.transition.type]}${ms ? ` ${ms} ms` : ''}`,
    );
  }
  if (then.lowerThird)
    parts.push(
      then.lowerThird.mode === 'off'
        ? 'L3 OFF'
        : `L3 ${selectorLabel(then.lowerThird.cam)}`,
    );
  if (then.replay)
    parts.push(
      `REPLAY ${selectorLabel(then.replay.cam)} −${formatSeconds(then.replay.beforeMs)}`,
    );
  if (then.effects) {
    const fx = Object.entries(then.effects)
      .map(([k, v]) =>
        typeof v === 'boolean' ? (v ? k : `no ${k}`) : `${k} ${String(v)}`,
      )
      .join(', ');
    if (fx) parts.push(`FX ${fx}`);
  }
  if (then.pacing) {
    const p = then.pacing;
    const bits = [
      p.minHoldMs != null ? `min ${formatSeconds(p.minHoldMs)}` : '',
      p.maxHoldMs != null ? `max ${formatSeconds(p.maxHoldMs)}` : '',
    ].filter(Boolean);
    parts.push(`PACING ${bits.join(' ') || 'change'}`);
  }
  return parts.length ? parts.join(' · ') : 'nothing';
}

/** One card's text: WHEN / THEN / meta line. */
export function ruleSummary(rule: ObRule): {
  when: string;
  then: string;
  meta: string;
} {
  const meta = [
    `P${rule.priority}`,
    rule.priority >= 80 ? 'cuts through min hold' : '',
    rule.cooldownMs ? `cooldown ${formatSeconds(rule.cooldownMs)}` : '',
    rule.holdMs ? `hold ${formatSeconds(rule.holdMs)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    when: conditionSummary(rule.when),
    then: actionSummary(rule.then),
    meta,
  };
}
