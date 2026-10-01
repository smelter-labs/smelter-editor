/**
 * OB Van — rules DSL evaluation: condition leaves over camera signals, `forMs`
 * persistence, the `trigger` binding and camera-selector / shot resolution.
 * Pure functions over an `ObRuleEnv` snapshot the brain builds once per tick;
 * the only state is the caller's `since` map (leaf → air time it started
 * holding), which the caller keeps between ticks.
 */
import type {
  ObCamSelector,
  ObCondition,
  ObConditionLeaf,
  ObFixedCamRole,
  ObOp,
  ObShot,
  ObShotTemplate,
  ObSignalKind,
} from '@smelter-editor/types';
import { OB_CAM_ROLES } from '@smelter-editor/types';
import type { ObBrainCam, ObSignalState } from './contracts';

/** An onset counts while the freshest audio is at most this far past it. */
export const ONSET_RECENT_MS = 250;
/** A burst still counts this long after it ended (the calm after it matters). */
export const BURST_RECENT_MS = 6000;
/** A keyword counts from this long before now up to the lookahead edge. */
export const KEYWORD_RECENT_MS = 4000;

export type ObDialogue = {
  /** The two cameras trading speech, older speaker first. */
  cams: [string, string];
  /** The camera a `dialogue` leaf binds as trigger: the pair camera off program (else the newest speaker). */
  partner: string;
  switches: number;
};

/** Everything a rule can look at, frozen for one brain tick. */
export type ObRuleEnv = {
  /** Evaluation time on the air clock: now + lookahead (the freshest signals). */
  T: number;
  nowAir: number;
  /** Every camera, by bus number. */
  cams: ObBrainCam[];
  signals: Record<string, ObSignalState>;
  /** Cameras on the program shot (main first). */
  programCams: string[];
  programMain: string | null;
  /** How long the program shot has been on air at T (Infinity when nothing is). */
  holdMs: number;
  segment: { index: number; title: string } | null;
  dialogue: ObDialogue | null;
  /** Utility score per camera (for `any` / `not-program` in shots). */
  scores: Record<string, number>;
};

export type ObSinceMemory = Record<string, number>;

// ── Cameras ──────────────────────────────────────────────────────────────

/** Picture flowing and the signals (if any) not gone offline. */
export function isProposable(env: ObRuleEnv, cam: ObBrainCam): boolean {
  return cam.live && !env.signals[cam.camId]?.offline;
}

/** Cameras a signal leaf can look at: proposable and analysed. */
function analysedCams(env: ObRuleEnv): ObBrainCam[] {
  return env.cams.filter(
    (c) => isProposable(env, c) && env.signals[c.camId] !== undefined,
  );
}

const isFixedRole = (s: string): s is ObFixedCamRole =>
  (OB_CAM_ROLES as readonly string[]).includes(s);

/** A selector naming one camera (role, `id:`, `cam:`), or null for the others. */
function namedCam(
  env: ObRuleEnv,
  selector: ObCamSelector,
): ObBrainCam | null | undefined {
  if (selector.startsWith('id:')) {
    const id = selector.slice(3);
    return env.cams.find((c) => c.camId === id) ?? null;
  }
  if (selector.startsWith('cam:')) {
    const n = Number(selector.slice(4));
    return env.cams.find((c) => c.number === n) ?? null;
  }
  if (isFixedRole(selector) || selector.startsWith('custom:')) {
    return (
      env.cams.find((c) => c.role === selector && isProposable(env, c)) ?? null
    );
  }
  return undefined;
}

/** Tie-break among cameras that satisfy a leaf: louder voice, then more motion, then bus number. */
export function rankCams(env: ObRuleEnv, camIds: string[]): string[] {
  const number = (id: string) =>
    env.cams.find((c) => c.camId === id)?.number ?? 99;
  const key = (id: string) => {
    const s = env.signals[id];
    return s ? [s.speechProb, s.motionEma] : [0, 0];
  };
  return [...camIds].sort((a, b) => {
    const [pa, ma] = key(a);
    const [pb, mb] = key(b);
    return pb - pa || mb - ma || number(a) - number(b);
  });
}

const bestScoring = (env: ObRuleEnv, cams: ObBrainCam[]): string | null =>
  cams
    .map((c) => c.camId)
    .sort(
      (a, b) => (env.scores[b] ?? -Infinity) - (env.scores[a] ?? -Infinity),
    )[0] ?? null;

/**
 * A camera for a shot slot. `trigger` = the camera that satisfied the rule,
 * `program` = the main camera on air, `not-program` = best-scoring camera off
 * air, `any` = best-scoring camera. Null when nothing proposable matches.
 */
export function resolveCam(
  env: ObRuleEnv,
  selector: ObCamSelector,
  trigger: string | null,
): string | null {
  const proposable = env.cams.filter((c) => isProposable(env, c));
  const ok = (id: string | null) =>
    id && proposable.some((c) => c.camId === id) ? id : null;
  switch (selector) {
    case 'trigger':
      return ok(trigger);
    case 'program':
      return ok(env.programMain);
    case 'not-program':
      return bestScoring(
        env,
        proposable.filter((c) => !env.programCams.includes(c.camId)),
      );
    case 'any':
      return bestScoring(env, proposable);
    default: {
      const cam = namedCam(env, selector);
      return cam ? ok(cam.camId) : null;
    }
  }
}

const distinct = (ids: string[]) => new Set(ids).size === ids.length;

/** Template → concrete shot; null when a slot cannot be filled or cameras repeat. */
export function resolveShot(
  env: ObRuleEnv,
  template: ObShotTemplate,
  trigger: string | null,
): ObShot | null {
  const cam = (s: ObCamSelector) => resolveCam(env, s, trigger);
  switch (template.kind) {
    case 'solo': {
      const c = cam(template.cam);
      return c ? { kind: 'solo', cam: c } : null;
    }
    case 'virtual': {
      const c = cam(template.cam);
      if (!c) return null;
      const shot: ObShot = { kind: 'virtual', cam: c };
      if (template.target) shot.target = template.target;
      if (template.zoom) shot.zoom = template.zoom;
      return shot;
    }
    case 'split': {
      const [a, b] = [cam(template.cams[0]), cam(template.cams[1])];
      return a && b && a !== b ? { kind: 'split', cams: [a, b] } : null;
    }
    case 'pip': {
      const [main, inset] = [cam(template.main), cam(template.inset)];
      if (!main || !inset || main === inset) return null;
      const shot: ObShot = { kind: 'pip', main, inset };
      if (template.corner) shot.corner = template.corner;
      if (template.size) shot.size = template.size;
      return shot;
    }
    case 'speaker-slides': {
      const [speaker, slides] = [cam(template.speaker), cam(template.slides)];
      return speaker && slides && distinct([speaker, slides])
        ? { kind: 'speaker-slides', speaker, slides }
        : null;
    }
    case 'quad':
    case 'grid': {
      const cams = template.cams.map(cam);
      if (cams.some((c) => c === null)) return null;
      const ids = [...new Set(cams.filter((c): c is string => c !== null))];
      if (template.kind === 'quad' && ids.length === 0) return null;
      return { kind: template.kind, cams: ids };
    }
  }
}

/** The camera a shot is "about": the speaker of speaker-slides, the main of a PiP, the first otherwise. */
export function mainCamOf(shot: ObShot): string | null {
  switch (shot.kind) {
    case 'solo':
    case 'virtual':
      return shot.cam;
    case 'split':
      return shot.cams[0];
    case 'pip':
      return shot.main;
    case 'speaker-slides':
      return shot.speaker;
    case 'quad':
    case 'grid':
      return shot.cams[0] ?? null;
  }
}

// ── Leaves ───────────────────────────────────────────────────────────────

type LeafValue = number | boolean | string[] | null;

const GLOBAL_SIGNALS: readonly ObSignalKind[] = ['hold', 'segment', 'dialogue'];

/** Leaves without a camera that look at the whole show rather than "any camera". */
function isGlobalLeaf(leaf: ObConditionLeaf): boolean {
  if (GLOBAL_SIGNALS.includes(leaf.signal)) return true;
  return (
    leaf.cam === undefined &&
    (leaf.signal === 'silence' || leaf.signal === 'keyword')
  );
}

function keywordGroups(env: ObRuleEnv, s: ObSignalState): string[] {
  return s.keywords
    .filter(
      (k) => k.airMs >= env.nowAir - KEYWORD_RECENT_MS && k.airMs <= env.T,
    )
    .map((k) => k.group);
}

/** A camera's value for a signal; null = unknown (stale stream) → the leaf is false. */
export function camSignalValue(
  env: ObRuleEnv,
  signal: ObSignalKind,
  s: ObSignalState,
): LeafValue {
  const audio = !s.staleAudio;
  const video = !s.staleVideo;
  switch (signal) {
    case 'speech':
      return audio ? s.speech : null;
    case 'silence':
      return audio ? !s.speech : null;
    case 'speechShare':
      return audio ? s.speechShare10s : null;
    case 'rms':
      return audio ? s.rmsDb : null;
    case 'onset':
      return audio
        ? s.lastOnsetAirMs !== null &&
            s.lastAudioAirMs !== null &&
            s.lastAudioAirMs - s.lastOnsetAirMs <= ONSET_RECENT_MS
        : null;
    case 'onsetsPerSec':
      return audio ? s.onsetsPerSec : null;
    case 'motion':
      return video ? s.motionEma : null;
    case 'motionSpike':
      return video ? s.motionSpike : null;
    case 'burst':
      return video
        ? s.burst.active ||
            (s.burst.endedAirMs !== null &&
              s.lastVideoAirMs !== null &&
              s.lastVideoAirMs - s.burst.endedAirMs <= BURST_RECENT_MS)
        : null;
    case 'people':
      return video ? s.people.count : null;
    case 'ball':
      return video ? s.ball !== null : null;
    case 'ballAge':
      return video ? (s.ball?.ageMs ?? Infinity) : null;
    case 'keyword':
      return keywordGroups(env, s);
    case 'hold':
    case 'segment':
    case 'dialogue':
      return null;
  }
}

const truthy = (v: number | string | boolean): boolean =>
  typeof v === 'string'
    ? v.toLowerCase() !== 'false' && v !== '0' && v !== ''
    : Boolean(v);

function compareNumber(
  actual: number,
  op: ObOp | undefined,
  value: number | string | boolean | undefined,
): boolean {
  if (value === undefined) return actual > 0;
  const expected = Number(value);
  if (!Number.isFinite(expected)) return false;
  switch (op ?? '>=') {
    case '>':
      return actual > expected;
    case '>=':
      return actual >= expected;
    case '<':
      return actual < expected;
    case '<=':
      return actual <= expected;
    case '==':
      return actual === expected;
    case '!=':
      return actual !== expected;
    case 'has':
      return false;
  }
}

/** `leaf.op leaf.value` applied to a value (defaults: booleans `== true`, numbers `> 0` / `>=`). */
export function compareValue(
  actual: Exclude<LeafValue, null>,
  op: ObOp | undefined,
  value: number | string | boolean | undefined,
): boolean {
  if (Array.isArray(actual)) {
    const has = value !== undefined && actual.includes(String(value));
    if (op === '!=') return !has;
    return op === undefined || op === 'has' || op === '==' ? has : false;
  }
  if (typeof actual === 'boolean') {
    const expected = value === undefined ? true : truthy(value);
    if (op === '!=') return actual !== expected;
    return op === undefined || op === '==' || op === 'has'
      ? actual === expected
      : false;
  }
  return compareNumber(actual, op, value);
}

function segmentMatches(env: ObRuleEnv, leaf: ObConditionLeaf): boolean {
  if (!env.segment) return false;
  if (typeof leaf.value === 'string') {
    const title = env.segment.title.toLowerCase();
    const wanted = leaf.value.toLowerCase();
    if (leaf.op === 'has') return title.includes(wanted);
    return leaf.op === '!=' ? title !== wanted : title === wanted;
  }
  return compareNumber(env.segment.index, leaf.op, leaf.value);
}

/** Does the leaf ask for speech (true) or for silence (false)? Null for other signals. */
function speechPolarity(leaf: ObConditionLeaf): boolean | null {
  if (leaf.signal !== 'speech' && leaf.signal !== 'silence') return null;
  const wantsTrue = leaf.value === undefined ? true : truthy(leaf.value);
  const positive = leaf.op === '!=' ? !wantsTrue : wantsTrue;
  return leaf.signal === 'speech' ? positive : !positive;
}

/**
 * When the leaf's raw condition started holding: speech / silence leaves use
 * the worker's own onset / end air times (exact), the rest the tick at which
 * the caller first saw them true.
 */
function holdStart(
  leaf: ObConditionLeaf,
  s: ObSignalState | null,
  key: string,
  since: ObSinceMemory,
  T: number,
): number {
  const polarity = speechPolarity(leaf);
  if (s && polarity === true && s.speechSinceAirMs !== null)
    return s.speechSinceAirMs;
  if (s && polarity === false && s.silenceSinceAirMs !== null)
    return s.silenceSinceAirMs;
  since[key] ??= T;
  return since[key];
}

type LeafTrack = { since: ObSinceMemory; touched: Set<string> };

/** Raw truth + `forMs` persistence for one key. */
function persisted(
  leaf: ObConditionLeaf,
  raw: boolean,
  s: ObSignalState | null,
  key: string,
  env: ObRuleEnv,
  track: LeafTrack,
  startOverride?: number | null,
): boolean {
  track.touched.add(key);
  if (!raw) {
    delete track.since[key];
    return false;
  }
  const start = startOverride ?? holdStart(leaf, s, key, track.since, env.T);
  return env.T - start >= (leaf.forMs ?? 0);
}

export type LeafResult =
  | { kind: 'global'; ok: boolean }
  /** Cameras satisfying the leaf; `binds` = a multi-camera selector that may set the trigger. */
  | {
      kind: 'cams';
      cams: string[];
      binds: boolean;
      selector: ObCamSelector | 'dialogue';
    };

function globalSilence(env: ObRuleEnv): { raw: boolean; start: number | null } {
  const heard = analysedCams(env)
    .map((c) => env.signals[c.camId])
    .filter((s) => !s.staleAudio);
  if (heard.length === 0 || heard.some((s) => s.speech))
    return { raw: false, start: null };
  const starts = heard.map((s) => s.silenceSinceAirMs ?? env.T);
  return { raw: true, start: Math.max(...starts) };
}

function evalGlobalLeaf(
  env: ObRuleEnv,
  leaf: ObConditionLeaf,
  key: string,
  track: LeafTrack,
): LeafResult {
  switch (leaf.signal) {
    case 'silence': {
      const { raw, start } = globalSilence(env);
      return {
        kind: 'global',
        ok: persisted(leaf, raw, null, key, env, track, start),
      };
    }
    case 'keyword': {
      const raw = analysedCams(env).some((c) =>
        compareValue(
          keywordGroups(env, env.signals[c.camId]),
          leaf.op,
          leaf.value,
        ),
      );
      return {
        kind: 'global',
        ok: persisted(leaf, raw, null, key, env, track),
      };
    }
    case 'hold': {
      const raw = compareNumber(env.holdMs, leaf.op, leaf.value);
      return {
        kind: 'global',
        ok: persisted(leaf, raw, null, key, env, track),
      };
    }
    case 'segment':
      return {
        kind: 'global',
        ok: persisted(leaf, segmentMatches(env, leaf), null, key, env, track),
      };
    case 'dialogue': {
      const raw = compareValue(env.dialogue !== null, leaf.op, leaf.value);
      const ok = persisted(leaf, raw, null, key, env, track);
      const cams = ok && env.dialogue ? [env.dialogue.partner] : [];
      return env.dialogue
        ? { kind: 'cams', cams, binds: true, selector: 'dialogue' }
        : { kind: 'global', ok };
    }
    default:
      return { kind: 'global', ok: false };
  }
}

/** Cameras a leaf with this selector is evaluated on. */
function leafScope(env: ObRuleEnv, selector: ObCamSelector): ObBrainCam[] {
  const cams = analysedCams(env);
  switch (selector) {
    case 'any':
    case 'trigger':
      return cams;
    case 'program':
      return cams.filter((c) => env.programCams.includes(c.camId));
    case 'not-program':
      return cams.filter((c) => !env.programCams.includes(c.camId));
    default: {
      const named = namedCam(env, selector);
      return named ? cams.filter((c) => c.camId === named.camId) : [];
    }
  }
}

const BINDING_SELECTORS: readonly ObCamSelector[] = ['any', 'not-program'];

export function evalLeaf(
  env: ObRuleEnv,
  leaf: ObConditionLeaf,
  key: string,
  track: LeafTrack,
): LeafResult {
  if (isGlobalLeaf(leaf)) return evalGlobalLeaf(env, leaf, key, track);
  const selector = leaf.cam ?? 'any';
  const cams = leafScope(env, selector)
    .filter((c) => {
      const s = env.signals[c.camId];
      const value = camSignalValue(env, leaf.signal, s);
      const raw = value !== null && compareValue(value, leaf.op, leaf.value);
      return persisted(leaf, raw, s, `${key}:${c.camId}`, env, track);
    })
    .map((c) => c.camId);
  return {
    kind: 'cams',
    cams: rankCams(env, cams),
    binds: BINDING_SELECTORS.includes(selector),
    selector,
  };
}

// ── Conditions ───────────────────────────────────────────────────────────

/** The leaves of a (one-level) condition. */
export function conditionLeaves(cond: ObCondition): ObConditionLeaf[] {
  if ('all' in cond) return cond.all;
  if ('any' in cond) return cond.any;
  if ('not' in cond) return [cond.not];
  return [cond];
}

/** Air time of the newest keyword hit a rule can see (captions land at air time, not ahead). */
export function latestKeywordAirMs(env: ObRuleEnv): number | null {
  const hits = analysedCams(env).flatMap((c) =>
    env.signals[c.camId].keywords.filter(
      (k) => k.airMs >= env.nowAir - KEYWORD_RECENT_MS && k.airMs <= env.T,
    ),
  );
  return hits.length ? Math.max(...hits.map((k) => k.airMs)) : null;
}

export type ConditionResult = { ok: boolean; trigger: string | null };

const leafOk = (r: LeafResult) =>
  r.kind === 'global' ? r.ok : r.cams.length > 0;
const FAIL: ConditionResult = { ok: false, trigger: null };

/**
 * `all`: every leaf holds, and the camera-scoped ones agree on one trigger —
 * the first `any` / `not-program` / `dialogue` leaf proposes the candidates,
 * `trigger` leaves must hold for the same camera. Without a binding leaf the
 * trigger is the first camera-scoped leaf's best camera.
 */
function combineAll(env: ObRuleEnv, results: LeafResult[]): ConditionResult {
  if (!results.every(leafOk)) return FAIL;
  const camResults = results.filter(
    (r): r is Extract<LeafResult, { kind: 'cams' }> => r.kind === 'cams',
  );
  const binder = camResults.find((r) => r.binds);
  const triggerLeaves = camResults.filter((r) => r.selector === 'trigger');
  let candidates = binder?.cams ?? triggerLeaves[0]?.cams ?? null;
  for (const r of triggerLeaves) {
    if (candidates) candidates = candidates.filter((c) => r.cams.includes(c));
  }
  if (candidates === null)
    return { ok: true, trigger: camResults[0]?.cams[0] ?? null };
  const ranked = rankCams(env, candidates);
  return ranked.length > 0 ? { ok: true, trigger: ranked[0] } : FAIL;
}

/**
 * Evaluate a rule condition. Every leaf is evaluated on every call (no short
 * circuit) so `forMs` timers stay continuous; `track.touched` collects the
 * keys that are still alive so the caller can drop the rest.
 */
export function evalCondition(
  env: ObRuleEnv,
  cond: ObCondition,
  ruleId: string,
  track: LeafTrack,
): ConditionResult {
  if ('all' in cond) {
    return combineAll(
      env,
      cond.all.map((leaf, i) =>
        evalLeaf(env, leaf, `${ruleId}:all${i}`, track),
      ),
    );
  }
  if ('any' in cond) {
    const results = cond.any.map((leaf, i) =>
      evalLeaf(env, leaf, `${ruleId}:any${i}`, track),
    );
    const first = results.find(leafOk);
    if (!first) return FAIL;
    return { ok: true, trigger: first.kind === 'cams' ? first.cams[0] : null };
  }
  if ('not' in cond) {
    return {
      ok: !leafOk(evalLeaf(env, cond.not, `${ruleId}:not`, track)),
      trigger: null,
    };
  }
  const result = evalLeaf(env, cond, `${ruleId}:leaf`, track);
  return {
    ok: leafOk(result),
    trigger: result.kind === 'cams' ? (result.cams[0] ?? null) : null,
  };
}
