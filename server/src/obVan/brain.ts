/**
 * OB Van — the auto pilot. `stepBrain` is a pure, deterministic function of
 * (context, memory, seed): the same inputs always give the same decision.
 * `createObBrain` wraps it in the stateful `ObBrain` the controller ticks.
 *
 * One tick, all on the air clock (T = nowAir + lookahead = the air time of the
 * freshest signals):
 *   1. remember speech turns (dialogue detection), evaluate EVERY rule so the
 *      `forMs` timers stay continuous;
 *   2. gates: a scheduled cut still pending, the operator's pause, a rule's
 *      hold → no decision;
 *   3. rules by priority — the first that fires wins; a rule whose shot is
 *      already on air holds the picture; shot changes wait for the min hold
 *      (and never leave a monologue) unless priority ≥ 80;
 *   4. behaviours: burst replay fallback, dialogue split / its end;
 *   5. utility scoring with hysteresis, max hold forcing a change;
 *   6. landing time: the trigger's air time, pulled before a speech onset
 *      (`anticipate`) or snapped to the beat (`onsetCuts`).
 */
import type {
  ObAction,
  ObConditionLeaf,
  ObFixedCamRole,
  ObPacing,
  ObRule,
  ObRuleset,
  ObShot,
  ObShotTemplate,
  ObTransition,
  ObTransitionType,
} from '@smelter-editor/types';
import {
  OB_CAM_ROLES,
  OB_RULESET_LIMITS,
  obShotCams,
  obShotsEqual,
} from '@smelter-editor/types';
import type {
  ObBrain,
  ObBrainCam,
  ObBrainContext,
  ObDecision,
  ObDecisionSource,
  ObSignalState,
} from './contracts';
import {
  camFacts,
  camLabel,
  heldFact,
  reasonLine,
  scoreFact,
  shotLabel,
  timingFact,
} from './explain';
import {
  conditionLeaves,
  evalCondition,
  isProposable,
  latestKeywordAirMs,
  mainCamOf,
  resolveCam,
  resolveShot,
  type ConditionResult,
  type ObDialogue,
  type ObRuleEnv,
} from './rules';

export const OB_BRAIN_TUNING = {
  /** A camera must beat the program by this much to take over. */
  switchMargin: 0.15,
  noveltyTauMs: 20000,
  /** Rules / behaviours at or above this priority cut through min hold and a monologue. */
  cutThroughPriority: 80,
  dialogueWindowMs: 6000,
  dialogueMinSwitches: 2,
  /** A split ends when one side speaks alone this long. */
  dialogueEndMs: 8000,
  dialogueCooldownMs: 10000,
  /** One camera on air speaking this long locks the picture (monologueLock). */
  monologueMs: 2000,
  /** Only a speech onset this recent is anticipated. */
  anticipateWindowMs: 3000,
  /** Never schedule closer to now than this. */
  minLeadMs: 50,
  /** Without a beat estimate, an onset this recent is a cut point (onsetCuts). */
  onsetWaitMs: 150,
  /** Rules without a shot and without a cooldown fire at most this often. */
  shotlessCooldownMs: 3000,
  /** A rule's pacing patch lasts at least this long. */
  rulePacingMs: 10000,
  burstCalmMs: 1500,
  burstRecentMs: 6000,
  burstReplayCooldownMs: 40000,
  burstReplay: { beforeMs: 4000, afterMs: 1000, holdMs: 5000 },
  noteEveryMs: 10000,
  turnMemoryMs: 10000,
};

export const OB_DEFAULT_TRANSITION_MS: Record<ObTransitionType, number> = {
  cut: 0,
  dissolve: 500,
  fade: 600,
  wipe: 400,
  dip: 800,
  'zoom-punch': 250,
};

// ── Memory ───────────────────────────────────────────────────────────────

export type ObBrainMemory = {
  /** Condition leaf key → air time it started holding (`forMs`). */
  since: Record<string, number>;
  /** Rule / behaviour id → air time it last fired (cooldowns). */
  firedAtAirMs: Record<string, number>;
  /** Speech onsets per camera, newest last (dialogue detection). */
  turns: { camId: string; airMs: number }[];
  /** A rule's pacing patch, active until the given air time. */
  rulePacing: { patch: Partial<ObPacing>; untilAirMs: number } | null;
  /** Note key → air time it was last emitted (throttling). */
  notedAtAirMs: Record<string, number>;
};

export function createBrainMemory(): ObBrainMemory {
  return {
    since: {},
    firedAtAirMs: {},
    turns: [],
    rulePacing: null,
    notedAtAirMs: {},
  };
}

function cloneMemory(m: ObBrainMemory): ObBrainMemory {
  return {
    since: { ...m.since },
    firedAtAirMs: { ...m.firedAtAirMs },
    turns: m.turns.map((t) => ({ ...t })),
    rulePacing: m.rulePacing
      ? {
          patch: { ...m.rulePacing.patch },
          untilAirMs: m.rulePacing.untilAirMs,
        }
      : null,
    notedAtAirMs: { ...m.notedAtAirMs },
  };
}

export type ObBrainStep = {
  decision: ObDecision | null;
  memory: ObBrainMemory;
  /** Throttled diagnostics (monologue lock, unresolvable rules). */
  notes: string[];
};

// ── Small pure helpers ───────────────────────────────────────────────────

type EffectivePacing = ObPacing & { minHoldMs: number; maxHoldMs: number };

const clamp = (v: number, lim: { min: number; max: number }) =>
  Math.min(lim.max, Math.max(lim.min, v));

export function effectivePacing(
  ctx: ObBrainContext,
  memory: ObBrainMemory,
  T: number,
): EffectivePacing {
  const rulePatch =
    memory.rulePacing && memory.rulePacing.untilAirMs > T
      ? memory.rulePacing.patch
      : {};
  const merged: ObPacing = {
    ...ctx.ruleset.pacing,
    ...rulePatch,
    ...ctx.overrides.pacing,
  };
  const factor = ctx.pacingFactor > 0 ? ctx.pacingFactor : 1;
  const minHoldMs = Math.round(
    clamp(merged.minHoldMs * factor, OB_RULESET_LIMITS.minHoldMs),
  );
  const maxHoldMs = Math.max(
    minHoldMs + 1000,
    Math.round(clamp(merged.maxHoldMs * factor, OB_RULESET_LIMITS.maxHoldMs)),
  );
  return { ...merged, minHoldMs, maxHoldMs };
}

const isFixedRole = (role: string): role is ObFixedCamRole =>
  (OB_CAM_ROLES as readonly string[]).includes(role);

const speaking = (s: ObSignalState | undefined): s is ObSignalState =>
  !!s && !s.staleAudio && !s.offline && s.speech;

/** Deterministic tiny tie-breaker per (seed, camera). */
function jitter(seed: number, camId: string): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < camId.length; i++) {
    h ^= camId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) * 1e-7;
}

function programCamsOf(ctx: ObBrainContext): string[] {
  const shot = ctx.program.shot;
  if (!shot) return [];
  if (shot.kind === 'grid' && shot.cams.length === 0)
    return ctx.cams.filter((c) => c.live).map((c) => c.camId);
  return obShotCams(shot);
}

/** Air time each camera last left the program (null = never on air). */
function lastOffAir(ctx: ObBrainContext, T: number): Record<string, number> {
  const entries = [...ctx.program.history].sort(
    (a, b) => a.atAirMs - b.atAirMs,
  );
  const current = ctx.program.shot;
  const last = entries[entries.length - 1];
  if (
    current &&
    !(
      last &&
      obShotsEqual(last.shot, current) &&
      last.atAirMs === ctx.program.sinceAirMs
    )
  ) {
    entries.push({ shot: current, atAirMs: ctx.program.sinceAirMs });
  }
  const out: Record<string, number> = {};
  entries.forEach((entry, i) => {
    const end = entries[i + 1]?.atAirMs ?? T;
    for (const camId of obShotCams(entry.shot)) out[camId] = end;
  });
  return out;
}

export type ObCamScore = {
  camId: string;
  total: number;
  parts: Record<string, number>;
};

/**
 * Utility of putting a camera on air:
 * speech·(0.7·speaking + 0.3·share) + motion·motionEma + people·min(1, n/4)
 * + ball·conf·(1 − age/2 s) − novelty (recently used / held long) + role bias
 * + stay (on program) + operator preference.
 */
export function scoreCams(
  ctx: ObBrainContext,
  T: number,
  seed: number,
): Record<string, ObCamScore> {
  const w = ctx.ruleset.weights;
  const onAir = new Set(programCamsOf(ctx));
  const offAt = lastOffAir(ctx, T);
  const hold = ctx.program.shot ? T - ctx.program.sinceAirMs : 0;
  const tau = OB_BRAIN_TUNING.noveltyTauMs;
  const prefer =
    ctx.overrides.preferCam && ctx.overrides.preferCam.untilAirMs > T
      ? ctx.overrides.preferCam
      : null;
  const out: Record<string, ObCamScore> = {};
  for (const cam of ctx.cams) {
    const s = ctx.signals[cam.camId];
    const audio = s && !s.staleAudio && !s.offline ? s : null;
    const video = s && !s.staleVideo && !s.offline ? s : null;
    const on = onAir.has(cam.camId);
    const parts: Record<string, number> = {
      speech: audio
        ? w.speech * (0.7 * (audio.speech ? 1 : 0) + 0.3 * audio.speechShare10s)
        : 0,
      motion: video ? w.motion * video.motionEma : 0,
      people: video ? w.people * Math.min(1, video.people.count / 4) : 0,
      ball: video?.ball
        ? w.ball * video.ball.conf * Math.max(0, 1 - video.ball.ageMs / 2000)
        : 0,
      novelty: on
        ? -w.novelty * (1 - Math.exp(-hold / tau))
        : offAt[cam.camId] !== undefined
          ? -w.novelty * Math.exp(-(T - offAt[cam.camId]) / tau)
          : 0,
      role: isFixedRole(cam.role) ? (w.roleBias?.[cam.role] ?? 0) : 0,
      stay: on ? w.stay : 0,
      prefer: prefer && prefer.camId === cam.camId ? prefer.boost : 0,
    };
    const total =
      Object.values(parts).reduce((a, b) => a + b, 0) + jitter(seed, cam.camId);
    out[cam.camId] = { camId: cam.camId, total, parts };
  }
  return out;
}

/** Speech onsets seen so far (one entry per camera per onset), trimmed to the memory window. */
function recordTurns(
  memory: ObBrainMemory,
  ctx: ObBrainContext,
  T: number,
): void {
  for (const cam of ctx.cams) {
    const s = ctx.signals[cam.camId];
    if (!cam.live || !speaking(s) || s.speechSinceAirMs === null) continue;
    const at = s.speechSinceAirMs;
    if (!memory.turns.some((t) => t.camId === cam.camId && t.airMs === at)) {
      memory.turns.push({ camId: cam.camId, airMs: at });
    }
  }
  memory.turns.sort((a, b) => a.airMs - b.airMs);
  memory.turns = memory.turns.filter(
    (t) => t.airMs >= T - OB_BRAIN_TUNING.turnMemoryMs,
  );
}

/**
 * Two cameras trading speech: in the last 6 s the speaker sequence ends with
 * ≥ 2 switches between the same two cameras. The camera a `dialogue` leaf
 * binds is the one of the pair that is off program (else the newest speaker).
 */
export function detectDialogue(
  turns: { camId: string; airMs: number }[],
  T: number,
  programMain: string | null,
  isLive: (camId: string) => boolean,
): ObDialogue | null {
  const seq: string[] = [];
  for (const t of turns) {
    if (t.airMs < T - OB_BRAIN_TUNING.dialogueWindowMs || t.airMs > T) continue;
    if (seq[seq.length - 1] !== t.camId) seq.push(t.camId);
  }
  if (seq.length < 3) return null;
  const [a, b] = [seq[seq.length - 2], seq[seq.length - 1]];
  let switches = 0;
  for (
    let i = seq.length - 1;
    i > 0 && [a, b].includes(seq[i - 1]) && [a, b].includes(seq[i]);
    i--
  )
    switches++;
  if (
    switches < OB_BRAIN_TUNING.dialogueMinSwitches ||
    !isLive(a) ||
    !isLive(b)
  )
    return null;
  const partner = programMain === b ? a : b;
  return { cams: [a, b], partner, switches };
}

function transitionFor(
  action: ObAction['transition'] | undefined,
  pacing: ObPacing,
): ObTransition {
  const type = action?.type ?? pacing.transition;
  const durationMs =
    action?.durationMs ??
    (type === pacing.transition && pacing.transitionMs !== undefined
      ? pacing.transitionMs
      : OB_DEFAULT_TRANSITION_MS[type]);
  return { type, durationMs };
}

function describeTemplate(t: ObShotTemplate): string {
  switch (t.kind) {
    case 'solo':
    case 'virtual':
      return `${t.kind} ${t.cam}`;
    case 'split':
      return `split ${t.cams.join(' + ')}`;
    case 'pip':
      return `pip ${t.main} + ${t.inset}`;
    case 'speaker-slides':
      return `speaker-slides ${t.speaker} + ${t.slides}`;
    case 'quad':
    case 'grid':
      return `${t.kind} ${t.cams.join(' + ') || 'all'}`;
  }
}

// ── One tick ─────────────────────────────────────────────────────────────

type Landing = { atAirMs: number; timing: string | null };

type DecisionDraft = {
  source: ObDecisionSource;
  /** Air time of the triggering signal when it is not at the lookahead edge (keywords). */
  triggerAirMs?: number;
  cause: string;
  shot?: ObShot;
  transition?: ObTransition;
  effects?: ObDecision['effects'];
  lowerThird?: ObDecision['lowerThird'];
  replay?: ObDecision['replay'];
  pacing?: ObDecision['pacing'];
  holdMs: number;
  ruleId?: string;
  score?: number;
  cutThrough: boolean;
  extraReasons?: string[];
};

type RuleOutcome =
  | { kind: 'fire'; draft: DecisionDraft }
  /** The rule's shot is already on air — it holds the picture. */
  | { kind: 'held' }
  | { kind: 'blocked' }
  | { kind: 'skip'; note?: string };

class BrainTick {
  readonly T: number;
  readonly env: ObRuleEnv;
  readonly pacing: EffectivePacing;
  readonly notes: string[] = [];
  private readonly scores: Record<string, ObCamScore>;
  private readonly lock: string | null;

  constructor(
    private readonly ctx: ObBrainContext,
    readonly memory: ObBrainMemory,
    seed: number,
  ) {
    this.T = ctx.nowAir + Math.max(0, ctx.lookaheadMs);
    recordTurns(memory, ctx, this.T);
    this.pacing = effectivePacing(ctx, memory, this.T);
    this.scores = scoreCams(ctx, this.T, seed);
    const cams = [...ctx.cams].sort((a, b) => a.number - b.number);
    const programCams = programCamsOf(ctx);
    const programMain = ctx.program.shot ? mainCamOf(ctx.program.shot) : null;
    const liveIds = new Set(
      cams
        .filter((c) => c.live && !ctx.signals[c.camId]?.offline)
        .map((c) => c.camId),
    );
    this.env = {
      T: this.T,
      nowAir: ctx.nowAir,
      cams,
      signals: ctx.signals,
      programCams,
      programMain,
      holdMs: ctx.program.shot ? this.T - ctx.program.sinceAirMs : Infinity,
      segment: ctx.segment,
      dialogue: detectDialogue(memory.turns, this.T, programMain, (id) =>
        liveIds.has(id),
      ),
      scores: Object.fromEntries(
        Object.values(this.scores).map((s) => [s.camId, s.total]),
      ),
    };
    this.lock = this.monologueCam();
  }

  run(): ObDecision | null {
    const evaluated = this.evaluateRules();
    if (this.gated()) return null;
    let held = false;
    for (const { rule, result } of evaluated) {
      if (!result.ok || this.cooling(rule)) continue;
      const outcome = this.planRule(rule, result.trigger);
      if (outcome.kind === 'fire') return this.fire(outcome.draft, rule);
      if (outcome.kind === 'skip' && outcome.note)
        this.note(`rule:${rule.id}`, outcome.note);
      if (outcome.kind === 'held') {
        held = true;
        break;
      }
    }
    const behaviour =
      this.burstReplay() ?? this.dialogueEnd() ?? this.dialogueStart();
    if (behaviour) return this.finish(behaviour);
    return this.scoreOrMaxHold(held);
  }

  // ── rules ──

  private evaluateRules(): { rule: ObRule; result: ConditionResult }[] {
    const touched = new Set<string>();
    const rules = this.ctx.ruleset.rules
      .map((rule, index) => ({ rule, index }))
      .filter(({ rule }) => rule.enabled !== false)
      .sort((a, b) => b.rule.priority - a.rule.priority || a.index - b.index)
      .map(({ rule }) => ({
        rule,
        result: evalCondition(this.env, rule.when, rule.id, {
          since: this.memory.since,
          touched,
        }),
      }));
    for (const key of Object.keys(this.memory.since)) {
      if (!touched.has(key)) delete this.memory.since[key];
    }
    return rules;
  }

  private gated(): boolean {
    const p = this.ctx.program;
    if (p.pending) return true;
    if (p.manualUntilAirMs !== null && p.manualUntilAirMs > this.T) return true;
    return p.holdUntilAirMs !== null && p.holdUntilAirMs > this.T;
  }

  private cooling(rule: ObRule): boolean {
    const last = this.memory.firedAtAirMs[rule.id];
    if (last === undefined) return false;
    const cooldown =
      rule.cooldownMs ??
      (rule.then.shot ? 0 : OB_BRAIN_TUNING.shotlessCooldownMs);
    return this.T - last < cooldown;
  }

  private planRule(rule: ObRule, trigger: string | null): RuleOutcome {
    const action = rule.then;
    const cutThrough = rule.priority >= OB_BRAIN_TUNING.cutThroughPriority;
    let shot: ObShot | undefined;
    if (action.shot) {
      const resolved = resolveShot(this.env, action.shot, trigger);
      if (!resolved)
        return {
          kind: 'skip',
          note: `rule ${rule.id}: no camera for ${describeTemplate(action.shot)}`,
        };
      if (obShotsEqual(resolved, this.ctx.program.shot))
        return { kind: 'held' };
      if (this.blocked(resolved, cutThrough)) return { kind: 'blocked' };
      shot = resolved;
    }
    const replay = this.ruleReplay(action, trigger);
    if (action.replay && !replay)
      return { kind: 'skip', note: `rule ${rule.id}: no camera to replay` };
    if (replay && !cutThrough && this.holdTooShort())
      return { kind: 'blocked' };
    const lowerThird = this.ruleLowerThird(action, trigger);
    if (!shot && !replay && !lowerThird && !action.effects && !action.pacing)
      return { kind: 'skip' };
    return {
      kind: 'fire',
      draft: {
        source: 'rule',
        ruleId: rule.id,
        cause: `rule ${rule.id}`,
        extraReasons: [rule.name],
        triggerAirMs: usesSignal(rule, 'keyword')
          ? (latestKeywordAirMs(this.env) ?? undefined)
          : undefined,
        shot,
        transition:
          shot || replay
            ? transitionFor(action.transition, this.pacing)
            : undefined,
        effects: action.effects ? { ...action.effects } : undefined,
        lowerThird: lowerThird ?? undefined,
        replay: replay ?? undefined,
        pacing: action.pacing ? { ...action.pacing } : undefined,
        holdMs: rule.holdMs ?? (shot ? this.pacing.minHoldMs : 0),
        cutThrough,
      },
    };
  }

  private ruleReplay(
    action: ObAction,
    trigger: string | null,
  ): ObDecision['replay'] | null {
    if (!action.replay) return null;
    const camId = resolveCam(this.env, action.replay.cam, trigger);
    return camId
      ? {
          camId,
          beforeMs: action.replay.beforeMs,
          afterMs: action.replay.afterMs,
        }
      : null;
  }

  private ruleLowerThird(
    action: ObAction,
    trigger: string | null,
  ): ObDecision['lowerThird'] | null {
    const lt = action.lowerThird;
    if (!lt) return null;
    const camId = resolveCam(this.env, lt.cam, trigger);
    if (!camId) return null;
    const cam = this.cam(camId);
    if (lt.mode === 'talent' && !cam?.talent) return null;
    return lt.holdMs === undefined
      ? { camId, mode: lt.mode }
      : { camId, mode: lt.mode, holdMs: lt.holdMs };
  }

  private fire(draft: DecisionDraft, rule: ObRule): ObDecision | null {
    const decision = this.finish(draft);
    if (!decision) return null;
    this.memory.firedAtAirMs[rule.id] = this.T;
    if (rule.then.pacing) {
      this.memory.rulePacing = {
        patch: { ...rule.then.pacing },
        untilAirMs:
          this.T + Math.max(rule.cooldownMs ?? 0, OB_BRAIN_TUNING.rulePacingMs),
      };
    }
    return decision;
  }

  // ── blocking ──

  private holdTooShort(): boolean {
    return (
      this.ctx.program.shot !== null && this.env.holdMs < this.pacing.minHoldMs
    );
  }

  /** Min hold, and never away from a monologue — unless the change cuts through. */
  private blocked(shot: ObShot, cutThrough: boolean): boolean {
    if (cutThrough) return false;
    if (this.holdTooShort()) return true;
    return this.lock !== null && !obShotCams(shot).includes(this.lock);
  }

  /** A camera on program speaking for ≥ 2 s under `monologueLock`. */
  private monologueCam(): string | null {
    if (!this.ctx.ruleset.behaviours?.monologueLock) return null;
    for (const camId of this.env.programCams) {
      const s = this.ctx.signals[camId];
      if (
        speaking(s) &&
        s.speechSinceAirMs !== null &&
        this.T - s.speechSinceAirMs >= OB_BRAIN_TUNING.monologueMs
      ) {
        return camId;
      }
    }
    return null;
  }

  // ── behaviours ──

  private rulesUse(predicate: (rule: ObRule) => boolean): boolean {
    return this.ctx.ruleset.rules.some(
      (r) => r.enabled !== false && predicate(r),
    );
  }

  private firedWithin(id: string, ms: number): boolean {
    const last = this.memory.firedAtAirMs[id];
    return last !== undefined && this.T - last < ms;
  }

  /** `burstReplay` without a replay rule: replay a camera once its burst calmed down. */
  private burstReplay(): DecisionDraft | null {
    if (
      !this.ctx.ruleset.behaviours?.burstReplay ||
      this.rulesUse((r) => !!r.then.replay)
    )
      return null;
    if (
      this.firedWithin(
        'behaviour:burst-replay',
        OB_BRAIN_TUNING.burstReplayCooldownMs,
      )
    )
      return null;
    const cam = this.env.cams.find((c) => {
      const s = this.ctx.signals[c.camId];
      if (
        !isProposable(this.env, c) ||
        !s ||
        s.staleVideo ||
        s.burst.active ||
        s.burst.endedAirMs === null
      )
        return false;
      const calm = this.T - s.burst.endedAirMs;
      return (
        calm >= OB_BRAIN_TUNING.burstCalmMs &&
        calm <= OB_BRAIN_TUNING.burstRecentMs
      );
    });
    if (!cam) return null;
    this.memory.firedAtAirMs['behaviour:burst-replay'] = this.T;
    const { beforeMs, afterMs, holdMs } = OB_BRAIN_TUNING.burstReplay;
    return {
      source: 'behaviour',
      cause: 'burst replay',
      replay: { camId: cam.camId, beforeMs, afterMs },
      transition: transitionFor({ type: 'wipe', durationMs: 300 }, this.pacing),
      holdMs,
      cutThrough: true,
    };
  }

  /** `dialogueSplit`: a split whose one side has spoken alone for 8 s goes back to that speaker. */
  private dialogueEnd(): DecisionDraft | null {
    const shot = this.ctx.program.shot;
    if (!this.ctx.ruleset.behaviours?.dialogueSplit || shot?.kind !== 'split')
      return null;
    const talking = shot.cams.filter((id) => speaking(this.ctx.signals[id]));
    if (talking.length !== 1) return null;
    const since = this.ctx.signals[talking[0]].speechSinceAirMs;
    if (since === null || this.T - since < OB_BRAIN_TUNING.dialogueEndMs)
      return null;
    const solo: ObShot = { kind: 'solo', cam: talking[0] };
    if (!this.proposable(talking[0]) || this.blocked(solo, false)) return null;
    return this.behaviourShot(solo, 'dialogue over');
  }

  /** `dialogueSplit` when no rule reacts to `dialogue`: split the two speakers. */
  private dialogueStart(): DecisionDraft | null {
    const d = this.env.dialogue;
    if (
      !this.ctx.ruleset.behaviours?.dialogueSplit ||
      !d ||
      this.rulesUse(usesDialogue)
    )
      return null;
    if (
      this.firedWithin('behaviour:dialogue', OB_BRAIN_TUNING.dialogueCooldownMs)
    )
      return null;
    const first =
      this.env.programMain && d.cams.includes(this.env.programMain)
        ? this.env.programMain
        : d.cams[0];
    const second = d.cams[0] === first ? d.cams[1] : d.cams[0];
    const split: ObShot = { kind: 'split', cams: [first, second] };
    if (
      obShotsEqual(split, this.ctx.program.shot) ||
      this.blocked(split, false)
    )
      return null;
    this.memory.firedAtAirMs['behaviour:dialogue'] = this.T;
    return this.behaviourShot(split, `dialogue ${d.switches} switches`);
  }

  private behaviourShot(shot: ObShot, cause: string): DecisionDraft {
    return {
      source: 'behaviour',
      cause,
      shot,
      transition: transitionFor(undefined, this.pacing),
      holdMs: this.pacing.minHoldMs,
      cutThrough: false,
    };
  }

  // ── scoring ──

  private scoreOrMaxHold(heldByRule: boolean): ObDecision | null {
    const programScore = this.env.programCams.length
      ? Math.max(
          ...this.env.programCams.map(
            (id) => this.scores[id]?.total ?? -Infinity,
          ),
        )
      : null;
    const candidates = this.env.cams
      .filter(
        (c) =>
          isProposable(this.env, c) && !this.env.programCams.includes(c.camId),
      )
      .map((c) => this.scores[c.camId])
      .sort((a, b) => b.total - a.total);
    const best = candidates[0];
    if (!best) return null;
    const shot: ObShot = { kind: 'solo', cam: best.camId };
    const ranking = candidates
      .slice(0, 3)
      .map((c) => `${camLabel(this.env.cams, c.camId)} ${c.total.toFixed(2)}`);
    if (this.ctx.program.shot && this.env.holdMs >= this.pacing.maxHoldMs) {
      if (this.lock) {
        this.note(
          'monologue',
          `monologue lock ${camLabel(this.env.cams, this.lock)} past max hold`,
        );
        return null;
      }
      return this.finish({
        source: 'maxHold',
        cause: 'max hold',
        shot,
        transition: transitionFor(undefined, this.pacing),
        holdMs: this.pacing.minHoldMs,
        score: best.total,
        cutThrough: false,
        extraReasons: ranking,
      });
    }
    if (heldByRule || this.holdTooShort()) return null;
    if (this.lock) {
      this.note(
        'monologue',
        `monologue lock ${camLabel(this.env.cams, this.lock)}`,
      );
      return null;
    }
    if (
      programScore !== null &&
      best.total - programScore <= OB_BRAIN_TUNING.switchMargin
    )
      return null;
    return this.finish({
      source: 'score',
      cause: scoreFact(best.total, programScore),
      shot,
      transition: transitionFor(undefined, this.pacing),
      holdMs: this.pacing.minHoldMs,
      score: best.total,
      cutThrough: false,
      extraReasons: ranking,
    });
  }

  // ── landing time + wording ──

  /** Earliest air time a change may land at. */
  private floor(cutThrough: boolean): number {
    const p = this.ctx.program;
    const bounds = [
      this.ctx.nowAir,
      p.holdUntilAirMs ?? -Infinity,
      p.manualUntilAirMs ?? -Infinity,
    ];
    if (!cutThrough && p.shot)
      bounds.push(p.sinceAirMs + this.pacing.minHoldMs);
    return Math.max(...bounds);
  }

  /**
   * Land at T (the trigger's air time — for keyword rules the caption's own,
   * earlier air time); `anticipate` pulls a cut to a camera
   * that just started speaking `anticipateMs` before its first syllable;
   * `onsetCuts` moves it onto the next predicted beat (or the onset itself).
   * Null = not a cut point yet (onsetCuts waiting for an onset).
   */
  private landing(draft: DecisionDraft): Landing | null {
    let floor = this.floor(draft.cutThrough);
    let atAirMs = this.T;
    let timing: string | null = null;
    if (draft.triggerAirMs !== undefined) {
      floor = Math.max(floor, this.ctx.nowAir + OB_BRAIN_TUNING.minLeadMs);
      atAirMs = draft.triggerAirMs;
    }
    const main = draft.shot ? mainCamOf(draft.shot) : null;
    const onset = main ? this.freshSpeechOnset(main) : null;
    if (onset !== null && this.ctx.ruleset.behaviours?.anticipate) {
      floor = Math.max(floor, this.ctx.nowAir + OB_BRAIN_TUNING.minLeadMs);
      atAirMs = Math.max(floor, onset - (this.pacing.anticipateMs ?? 0));
      if (atAirMs < onset) timing = timingFact('anticipated', atAirMs - onset);
    }
    atAirMs = Math.max(atAirMs, floor);
    if (
      (draft.shot || draft.replay) &&
      this.ctx.ruleset.behaviours?.onsetCuts
    ) {
      const snapped = this.snapToBeat(atAirMs);
      if (!snapped) return null;
      return snapped;
    }
    return { atAirMs, timing };
  }

  /** The air time a camera started speaking, when that was recent and it is off program. */
  private freshSpeechOnset(camId: string): number | null {
    if (this.env.programCams.includes(camId)) return null;
    const s = this.ctx.signals[camId];
    if (!speaking(s) || s.speechSinceAirMs === null) return null;
    return this.T - s.speechSinceAirMs <= OB_BRAIN_TUNING.anticipateWindowMs
      ? s.speechSinceAirMs
      : null;
  }

  private snapToBeat(at: number): Landing | null {
    const heard = this.env.cams
      .filter((c) => isProposable(this.env, c))
      .map((c) => this.ctx.signals[c.camId])
      .filter((s): s is ObSignalState => !!s && !s.staleAudio);
    if (heard.length === 0) return { atAirMs: at, timing: null };
    const beatSource = heard
      .filter((s) => s.beat.periodMs !== null && s.beat.phaseAirMs !== null)
      .sort((a, b) => b.beat.confidence - a.beat.confidence)[0];
    if (beatSource?.beat.periodMs && beatSource.beat.phaseAirMs !== null) {
      const { periodMs, phaseAirMs } = beatSource.beat;
      const next =
        phaseAirMs + Math.ceil((at - phaseAirMs) / periodMs) * periodMs;
      return { atAirMs: next, timing: timingFact('beat', 0) };
    }
    const onsets = heard
      .map((s) => s.lastOnsetAirMs)
      .filter(
        (t): t is number =>
          t !== null && t >= this.T - OB_BRAIN_TUNING.onsetWaitMs,
      );
    if (onsets.length === 0) return null;
    const onset = Math.max(...onsets);
    const atAirMs = Math.max(at, onset);
    return { atAirMs, timing: timingFact('beat', atAirMs - onset) };
  }

  private finish(draft: DecisionDraft): ObDecision | null {
    const landing = this.landing(draft);
    if (!landing) return null;
    const parts = this.reasonParts(draft, landing);
    const decision: ObDecision = {
      atAirMs: Math.round(landing.atAirMs),
      holdMs: draft.holdMs,
      reason: reasonLine(parts),
      reasons: [
        ...parts.filter((p): p is string => !!p),
        ...(draft.extraReasons ?? []),
      ],
      source: draft.source,
    };
    if (draft.shot) decision.shot = draft.shot;
    if (draft.transition) decision.transition = draft.transition;
    if (draft.effects) decision.effects = draft.effects;
    if (draft.lowerThird) decision.lowerThird = draft.lowerThird;
    if (draft.replay) decision.replay = draft.replay;
    if (draft.pacing) decision.pacing = draft.pacing;
    if (draft.ruleId) decision.ruleId = draft.ruleId;
    if (draft.score !== undefined)
      decision.score = Math.round(draft.score * 100) / 100;
    return decision;
  }

  private reasonParts(
    draft: DecisionDraft,
    landing: Landing,
  ): (string | null)[] {
    const cams = this.env.cams;
    const subject = draft.shot
      ? shotLabel(cams, draft.shot)
      : draft.replay
        ? `REPLAY ${camLabel(cams, draft.replay.camId)}`
        : draft.lowerThird
          ? `L3 ${camLabel(cams, draft.lowerThird.camId)}`
          : draft.effects
            ? `FX ${Object.entries(draft.effects)
                .map(([k, v]) => `${k} ${String(v)}`)
                .join(', ')}`
            : 'PACING';
    const focus = draft.shot
      ? mainCamOf(draft.shot)
      : (draft.replay?.camId ?? null);
    const facts = focus ? camFacts(this.ctx.signals[focus], this.T) : [];
    return [
      subject,
      ...facts,
      draft.shot || draft.replay ? heldFact(this.ctx, this.T) : null,
      draft.cause,
      landing.timing,
    ];
  }

  private cam(camId: string): ObBrainCam | undefined {
    return this.env.cams.find((c) => c.camId === camId);
  }

  private proposable(camId: string): boolean {
    const cam = this.cam(camId);
    return cam !== undefined && isProposable(this.env, cam);
  }

  private note(key: string, text: string): void {
    const last = this.memory.notedAtAirMs[key];
    if (last !== undefined && this.T - last < OB_BRAIN_TUNING.noteEveryMs)
      return;
    this.memory.notedAtAirMs[key] = this.T;
    this.notes.push(text);
  }
}

const usesSignal = (rule: ObRule, signal: ObConditionLeaf['signal']): boolean =>
  conditionLeaves(rule.when).some((l) => l.signal === signal);
const usesDialogue = (rule: ObRule): boolean => usesSignal(rule, 'dialogue');

/** One auto-pilot tick. Pure: memory is copied, never mutated. */
export function stepBrain(
  ctx: ObBrainContext,
  memory: ObBrainMemory,
  seed = 0,
): ObBrainStep {
  const tick = new BrainTick(ctx, cloneMemory(memory), seed);
  const decision = tick.run();
  return { decision, memory: tick.memory, notes: tick.notes };
}

// ── Stateful adapter ─────────────────────────────────────────────────────

export type ObBrainOptions = {
  seed?: number;
  /** Throttled diagnostics (monologue lock, rules without a camera). */
  onNote?: (note: string) => void;
};

/**
 * The controller's auto pilot: holds the memory between ticks. The ruleset
 * in each step's context is authoritative; a different one (by content) —
 * or `setRuleset` — starts from fresh memory (cooldowns, `forMs` timers).
 */
export function createObBrain(
  ruleset: ObRuleset,
  opts: ObBrainOptions = {},
): ObBrain {
  let current = ruleset;
  let currentKey = JSON.stringify(ruleset);
  let memory = createBrainMemory();
  const adopt = (next: ObRuleset) => {
    if (next === current) return;
    const key = JSON.stringify(next);
    current = next;
    if (key !== currentKey) {
      currentKey = key;
      memory = createBrainMemory();
    }
  };
  return {
    step(ctx) {
      adopt(ctx.ruleset);
      const out = stepBrain(ctx, memory, opts.seed ?? 0);
      memory = out.memory;
      for (const note of out.notes) opts.onNote?.(note);
      return out.decision;
    },
    setRuleset(next) {
      adopt(next);
    },
    reset() {
      memory = createBrainMemory();
    },
  };
}
