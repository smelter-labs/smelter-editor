// OB Van — permissive parsing of rulesets and shots. Rulesets come from three
// places (presets, the editor's RAW JSON drawer, the LLM), so the parser is
// forgiving: it clamps numbers to OB_RULESET_LIMITS, drops rules it cannot
// read (with a warning each) and fills pacing / weights from a fallback. It
// only fails when the input is not an object at all or no rule survives and
// the input had some.

import {
  OB_OPS,
  OB_RULESET_LIMITS,
  OB_SIGNAL_KINDS,
  OB_TRANSITION_TYPES,
  OB_GRADES,
  isObCamRole,
  type ObAction,
  type ObAttentionTarget,
  type ObCamSelector,
  type ObCondition,
  type ObConditionLeaf,
  type ObEffects,
  type ObPacing,
  type ObPipCorner,
  type ObPipSize,
  type ObRule,
  type ObRuleset,
  type ObShot,
  type ObShotOf,
  type ObTransitionType,
  type ObWeights,
  type ObZoom,
  type ObPresetId,
  type ObFixedCamRole,
  OB_CAM_ROLES,
} from "./ob-van-events.js";

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const clamp = (v: number, lim: { min: number; max: number }) =>
  Math.min(lim.max, Math.max(lim.min, v));
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const str = (v: unknown, max = 120): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

const SPECIAL_SELECTORS = ["any", "program", "not-program", "trigger"];
const ATTENTION: readonly ObAttentionTarget[] = [
  "speaker",
  "largest",
  "ball",
  "centroid",
  "motion",
];
const ZOOMS: readonly ObZoom[] = ["tight", "normal", "wide"];
const CORNERS: readonly ObPipCorner[] = ["tl", "tr", "bl", "br"];
const SIZES: readonly ObPipSize[] = ["S", "M", "L"];
const PRESETS: readonly ObPresetId[] = [
  "talk",
  "match",
  "stage",
  "gig",
  "follow",
  "custom",
];

export function isObCamSelector(v: unknown): v is ObCamSelector {
  if (typeof v !== "string") return false;
  if (SPECIAL_SELECTORS.includes(v)) return true;
  if (isObCamRole(v)) return true;
  return /^id:.{1,80}$/.test(v) || /^cam:[1-9]$/.test(v);
}

/** Parse a shot over camera refs accepted by `isRef`. */
export function parseObShotOf<C extends string>(
  raw: unknown,
  isRef: (v: unknown) => v is C,
): ObShotOf<C> | null {
  if (!isRec(raw)) return null;
  const ref = (v: unknown): C | null => (isRef(v) ? v : null);
  const refs = (v: unknown, min: number, max: number): C[] | null => {
    if (!Array.isArray(v)) return null;
    const out = v.map(ref).filter((x): x is C => x !== null);
    if (out.length !== v.length || out.length < min || out.length > max)
      return null;
    return out;
  };
  switch (raw.kind) {
    case "solo": {
      const cam = ref(raw.cam);
      return cam ? { kind: "solo", cam } : null;
    }
    case "split": {
      const cams = refs(raw.cams, 2, 2);
      return cams ? { kind: "split", cams: [cams[0], cams[1]] } : null;
    }
    case "pip": {
      const main = ref(raw.main);
      const inset = ref(raw.inset);
      if (!main || !inset) return null;
      const shot: ObShotOf<C> = { kind: "pip", main, inset };
      if (CORNERS.includes(raw.corner as ObPipCorner))
        shot.corner = raw.corner as ObPipCorner;
      if (SIZES.includes(raw.size as ObPipSize)) shot.size = raw.size as ObPipSize;
      return shot;
    }
    case "quad": {
      const cams = refs(raw.cams, 1, 4);
      return cams ? { kind: "quad", cams } : null;
    }
    case "grid": {
      const cams = refs(raw.cams ?? [], 0, 8);
      return cams ? { kind: "grid", cams } : null;
    }
    case "speaker-slides": {
      const speaker = ref(raw.speaker);
      const slides = ref(raw.slides);
      return speaker && slides
        ? { kind: "speaker-slides", speaker, slides }
        : null;
    }
    case "virtual": {
      const cam = ref(raw.cam);
      if (!cam) return null;
      const shot: ObShotOf<C> = { kind: "virtual", cam };
      if (ATTENTION.includes(raw.target as ObAttentionTarget))
        shot.target = raw.target as ObAttentionTarget;
      if (ZOOMS.includes(raw.zoom as ObZoom)) shot.zoom = raw.zoom as ObZoom;
      return shot;
    }
    default:
      return null;
  }
}

const isCamId = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 80;

/** Parse a resolved shot (camera ids). */
export function parseObShot(raw: unknown): ObShot | null {
  return parseObShotOf(raw, isCamId);
}

/** Camera ids a shot puts on screen, in layout order, deduplicated. */
export function obShotCams<C>(shot: ObShotOf<C>): C[] {
  let cams: C[];
  switch (shot.kind) {
    case "solo":
    case "virtual":
      cams = [shot.cam];
      break;
    case "split":
      cams = [...shot.cams];
      break;
    case "pip":
      cams = [shot.main, shot.inset];
      break;
    case "quad":
    case "grid":
      cams = [...shot.cams];
      break;
    case "speaker-slides":
      cams = [shot.slides, shot.speaker];
      break;
  }
  return cams.filter((c, i) => cams.indexOf(c) === i);
}

export function obShotsEqual(a: ObShot | null, b: ObShot | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── Rules ────────────────────────────────────────────────────────────────

function parseLeaf(raw: unknown, where: string, warn: (m: string) => void): ObConditionLeaf | null {
  if (!isRec(raw)) {
    warn(`${where}: condition is not an object`);
    return null;
  }
  if (!OB_SIGNAL_KINDS.includes(raw.signal as never)) {
    warn(`${where}: unknown signal ${JSON.stringify(raw.signal)}`);
    return null;
  }
  const leaf: ObConditionLeaf = { signal: raw.signal as ObConditionLeaf["signal"] };
  if (raw.cam !== undefined) {
    if (!isObCamSelector(raw.cam)) {
      warn(`${where}: unknown camera selector ${JSON.stringify(raw.cam)}`);
      return null;
    }
    leaf.cam = raw.cam;
  }
  if (raw.op !== undefined) {
    if (!OB_OPS.includes(raw.op as never)) {
      warn(`${where}: unknown operator ${JSON.stringify(raw.op)}`);
      return null;
    }
    leaf.op = raw.op as ObConditionLeaf["op"];
  }
  if (
    typeof raw.value === "number" ||
    typeof raw.value === "string" ||
    typeof raw.value === "boolean"
  )
    leaf.value = typeof raw.value === "string" ? raw.value.slice(0, 60) : raw.value;
  const forMs = num(raw.forMs);
  if (forMs !== undefined && forMs > 0)
    leaf.forMs = Math.round(clamp(forMs, OB_RULESET_LIMITS.forMs));
  return leaf;
}

function parseCondition(raw: unknown, where: string, warn: (m: string) => void): ObCondition | null {
  if (!isRec(raw)) {
    warn(`${where}: missing condition`);
    return null;
  }
  for (const key of ["all", "any"] as const) {
    if (key in raw) {
      if (!Array.isArray(raw[key]) || (raw[key] as unknown[]).length === 0) {
        warn(`${where}: "${key}" must be a non-empty list`);
        return null;
      }
      const leaves = (raw[key] as unknown[]).map((l, i) =>
        parseLeaf(l, `${where}.${key}[${i}]`, warn),
      );
      if (leaves.some((l) => l === null)) return null;
      return key === "all"
        ? { all: leaves as ObConditionLeaf[] }
        : { any: leaves as ObConditionLeaf[] };
    }
  }
  if ("not" in raw) {
    const leaf = parseLeaf(raw.not, `${where}.not`, warn);
    return leaf ? { not: leaf } : null;
  }
  return parseLeaf(raw, where, warn);
}

function parseEffects(raw: unknown): Partial<ObEffects> | undefined {
  if (!isRec(raw)) return undefined;
  const out: Partial<ObEffects> = {};
  if (OB_GRADES.includes(raw.grade as never)) out.grade = raw.grade as ObEffects["grade"];
  if (typeof raw.spotlight === "boolean") out.spotlight = raw.spotlight;
  if (typeof raw.softBackground === "boolean") out.softBackground = raw.softBackground;
  return Object.keys(out).length ? out : undefined;
}

function parsePacingPatch(raw: unknown): Partial<ObPacing> | undefined {
  if (!isRec(raw)) return undefined;
  const out: Partial<ObPacing> = {};
  const min = num(raw.minHoldMs);
  const max = num(raw.maxHoldMs);
  const tms = num(raw.transitionMs);
  const ant = num(raw.anticipateMs);
  if (min !== undefined) out.minHoldMs = Math.round(clamp(min, OB_RULESET_LIMITS.minHoldMs));
  if (max !== undefined) out.maxHoldMs = Math.round(clamp(max, OB_RULESET_LIMITS.maxHoldMs));
  if (OB_TRANSITION_TYPES.includes(raw.transition as never))
    out.transition = raw.transition as ObTransitionType;
  if (tms !== undefined) out.transitionMs = Math.round(clamp(tms, OB_RULESET_LIMITS.transitionMs));
  if (ant !== undefined) out.anticipateMs = Math.round(clamp(ant, OB_RULESET_LIMITS.anticipateMs));
  return Object.keys(out).length ? out : undefined;
}

function parseAction(raw: unknown, where: string, warn: (m: string) => void): ObAction | null {
  if (!isRec(raw)) {
    warn(`${where}: missing action`);
    return null;
  }
  const action: ObAction = {};
  if (raw.shot !== undefined) {
    const shot = parseObShotOf(raw.shot, isObCamSelector);
    if (!shot) {
      warn(`${where}: unreadable shot ${JSON.stringify(raw.shot)}`);
      return null;
    }
    action.shot = shot;
  }
  if (isRec(raw.transition)) {
    const t = raw.transition;
    const type = t.type ?? t.kind;
    if (OB_TRANSITION_TYPES.includes(type as never)) {
      action.transition = { type: type as ObTransitionType };
      const d = num(t.durationMs);
      if (d !== undefined)
        action.transition.durationMs = Math.round(clamp(d, OB_RULESET_LIMITS.transitionMs));
    }
  }
  const effects = parseEffects(raw.effects);
  if (effects) action.effects = effects;
  if (isRec(raw.lowerThird) && isObCamSelector(raw.lowerThird.cam)) {
    const mode = raw.lowerThird.mode === "off" ? "off" : "talent";
    action.lowerThird = { cam: raw.lowerThird.cam, mode };
    const h = num(raw.lowerThird.holdMs);
    if (h !== undefined) action.lowerThird.holdMs = Math.round(clamp(h, { min: 1000, max: 30000 }));
  }
  if (isRec(raw.replay) && isObCamSelector(raw.replay.cam)) {
    action.replay = {
      cam: raw.replay.cam,
      beforeMs: Math.round(clamp(num(raw.replay.beforeMs) ?? 4000, { min: 1000, max: 10000 })),
      afterMs: Math.round(clamp(num(raw.replay.afterMs) ?? 1000, { min: 0, max: 5000 })),
    };
  }
  const pacing = parsePacingPatch(raw.pacing);
  if (pacing) action.pacing = pacing;
  if (!action.shot && !action.effects && !action.lowerThird && !action.replay && !action.pacing) {
    warn(`${where}: action does nothing`);
    return null;
  }
  return action;
}

function parseRule(raw: unknown, index: number, warn: (m: string) => void): ObRule | null {
  const where = `rule ${index + 1}`;
  if (!isRec(raw)) {
    warn(`${where}: not an object`);
    return null;
  }
  const id = str(raw.id, 40)?.replace(/[^\w-]/g, "-") ?? `rule-${index + 1}`;
  const label = `${where} (${id})`;
  const when = parseCondition(raw.when, label, warn);
  const then = parseAction(raw.then, label, warn);
  if (!when || !then) return null;
  const rule: ObRule = {
    id,
    name: str(raw.name, 60) ?? id,
    when,
    then,
    priority: Math.round(clamp(num(raw.priority) ?? 50, OB_RULESET_LIMITS.priority)),
  };
  const cd = num(raw.cooldownMs);
  if (cd !== undefined && cd > 0) rule.cooldownMs = Math.round(clamp(cd, OB_RULESET_LIMITS.cooldownMs));
  const hold = num(raw.holdMs);
  if (hold !== undefined && hold > 0) {
    if (then.shot || then.replay)
      rule.holdMs = Math.round(clamp(hold, OB_RULESET_LIMITS.holdMs));
    else warn(`${label}: holdMs ignored — the action changes no picture`);
  }
  if (raw.enabled === false) rule.enabled = false;
  return rule;
}

function parseWeights(raw: unknown, fallback: ObWeights): ObWeights {
  const out: ObWeights = { ...fallback, roleBias: { ...(fallback.roleBias ?? {}) } };
  if (!isRec(raw)) return out;
  for (const k of ["speech", "motion", "people", "ball", "novelty", "stay"] as const) {
    const v = num(raw[k]);
    if (v !== undefined) out[k] = clamp(v, OB_RULESET_LIMITS.weight);
  }
  if (isRec(raw.roleBias)) {
    // Overlay on the fallback biases: a partial roleBias from the LLM or the
    // editor must not wipe the roles it does not mention (slides/tape stay
    // negative unless changed explicitly).
    const bias: Partial<Record<ObFixedCamRole, number>> = {
      ...(fallback.roleBias ?? {}),
    };
    for (const role of OB_CAM_ROLES) {
      const v = num(raw.roleBias[role]);
      if (v !== undefined) bias[role] = clamp(v, OB_RULESET_LIMITS.weight);
    }
    out.roleBias = bias;
  }
  return out;
}

function conditionLeaves(cond: ObCondition): ObConditionLeaf[] {
  if ("all" in cond) return cond.all;
  if ("any" in cond) return cond.any;
  if ("not" in cond) return [cond.not];
  return [cond];
}

/**
 * Keyword groups replace the fallback's wholesale, so a ruleset (typically
 * LLM-written) can keep a `keyword has "tape"` rule while dropping or renaming
 * the `tape` group — the rule then silently never fires. Repair each keyword
 * leaf: fix the case, restore a missing group from the fallback, or warn.
 */
function repairKeywordRules(
  ruleset: ObRuleset,
  fallback: ObRuleset,
  warn: (m: string) => void,
): void {
  const fallbackKeywords = fallback.keywords ?? {};
  const keyFor = (value: string): string | undefined => {
    const lower = value.toLowerCase();
    return Object.keys(ruleset.keywords ?? {}).find((k) => k.toLowerCase() === lower);
  };
  for (const rule of ruleset.rules) {
    if (rule.enabled === false) continue;
    for (const leaf of conditionLeaves(rule.when)) {
      if (leaf.signal !== "keyword" || typeof leaf.value !== "string") continue;
      const value = leaf.value;
      if (ruleset.keywords?.[value]) continue;
      const existing = keyFor(value);
      if (existing) {
        leaf.value = existing;
        warn(`rule "${rule.id}": keyword group "${value}" matched "${existing}" (case fixed)`);
        continue;
      }
      const restored = Object.keys(fallbackKeywords).find(
        (k) => k.toLowerCase() === value.toLowerCase(),
      );
      if (restored) {
        ruleset.keywords = {
          ...ruleset.keywords,
          [restored]: [...fallbackKeywords[restored]],
        };
        if (restored !== value) leaf.value = restored;
        warn(`rule "${rule.id}": keyword group "${restored}" restored from the preset`);
        continue;
      }
      warn(
        `rule "${rule.id}": keyword group "${value}" is not defined — this rule may never fire`,
      );
    }
  }
}

export type ObRulesetParse = {
  ruleset: ObRuleset | null;
  warnings: string[];
  errors: string[];
};

/**
 * Parse and normalise a ruleset: clamp to limits, fill pacing / weights from
 * `fallback`, drop unreadable rules (warnings), dedupe ids, sort by priority
 * (highest first). Disabled rules are kept (the editor toggles them).
 */
export function parseObRuleset(raw: unknown, fallback: ObRuleset): ObRulesetParse {
  const warnings: string[] = [];
  const errors: string[] = [];
  const warn = (m: string) => warnings.push(m);
  if (!isRec(raw)) {
    return { ruleset: null, warnings, errors: ["ruleset must be a JSON object"] };
  }
  const pacingPatch = parsePacingPatch(raw.pacing) ?? {};
  const pacing: ObPacing = { ...fallback.pacing, ...pacingPatch };
  if (pacing.maxHoldMs < pacing.minHoldMs) {
    pacing.maxHoldMs = Math.min(OB_RULESET_LIMITS.maxHoldMs.max, pacing.minHoldMs * 2);
    warn("pacing: maxHoldMs raised above minHoldMs");
  }
  const rawRules = Array.isArray(raw.rules) ? raw.rules : [];
  if (!Array.isArray(raw.rules)) warn("no rules list — scoring only");
  const rules: ObRule[] = [];
  const seen = new Set<string>();
  rawRules.slice(0, OB_RULESET_LIMITS.rules.max).forEach((r, i) => {
    const rule = parseRule(r, i, warn);
    if (!rule) return;
    let id = rule.id;
    for (let n = 2; seen.has(id); n++) id = `${rule.id}-${n}`;
    seen.add(id);
    rules.push({ ...rule, id });
  });
  if (rawRules.length > OB_RULESET_LIMITS.rules.max)
    warn(`only the first ${OB_RULESET_LIMITS.rules.max} rules are kept`);
  if (rawRules.length > 0 && rules.length === 0)
    errors.push("none of the rules could be read");
  rules.sort((a, b) => b.priority - a.priority);

  let keywords: Record<string, string[]> | undefined;
  if (isRec(raw.keywords)) {
    keywords = {};
    for (const [group, list] of Object.entries(raw.keywords).slice(0, OB_RULESET_LIMITS.keywordGroups.max)) {
      if (!Array.isArray(list)) continue;
      const words = list
        .map((w) => str(w, 40)?.toLowerCase())
        .filter((w): w is string => !!w)
        .slice(0, OB_RULESET_LIMITS.keywordsPerGroup.max);
      if (words.length) keywords[group.slice(0, 24)] = words;
    }
  } else if (fallback.keywords) {
    keywords = { ...fallback.keywords };
  }

  const behaviours = isRec(raw.behaviours)
    ? {
        // Merge over the fallback: leaving a behaviour out keeps it; only an
        // explicit boolean changes it.
        ...fallback.behaviours,
        ...Object.fromEntries(
          ["monologueLock", "dialogueSplit", "onsetCuts", "anticipate", "burstReplay"]
            .filter((k) => typeof (raw.behaviours as Rec)[k] === "boolean")
            .map((k) => [k, (raw.behaviours as Rec)[k] as boolean]),
        ),
      }
    : fallback.behaviours;

  const ruleset: ObRuleset = {
    id: str(raw.id, 40) ?? "custom",
    name: str(raw.name, 60) ?? "Custom rules",
    preset: PRESETS.includes(raw.preset as ObPresetId) ? (raw.preset as ObPresetId) : "custom",
    pacing,
    weights: parseWeights(raw.weights, fallback.weights),
    rules,
  };
  if (behaviours) ruleset.behaviours = behaviours;
  if (keywords) ruleset.keywords = keywords;
  if (!errors.length) repairKeywordRules(ruleset, fallback, warn);
  return { ruleset: errors.length ? null : ruleset, warnings, errors };
}
