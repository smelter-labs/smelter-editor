/**
 * OB Van — server-internal contracts between the controller
 * (`ObVanController.ts`), the signal aggregation (`signals.ts`), the auto
 * pilot brain (`brain.ts`) and the LLM layer (`llm/`). Each side is built and
 * tested on its own against these types; RoomState wires the real
 * implementations together.
 *
 * Clock: every signal is placed on the AIR clock = wall-clock ms at which the
 * frame / audio it describes is presented on the program output. The side
 * channel hands frames to the worker `delayMs` (3 s for WHIP) BEFORE they
 * air, so the freshest signals sit ~3 s in the future: `lookaheadMs()`.
 */
import type {
  ObActionSource,
  ObAttentionTarget,
  ObCamRole,
  ObEffects,
  ObLlmStatus,
  ObLogEntry,
  ObOperatorCommand,
  ObPacing,
  ObPhase,
  ObPresetId,
  ObRuleset,
  ObShot,
  ObTransition,
  ObSignalSummary,
  ObStats,
} from '@smelter-editor/types';

// ── Signals ────────────────────────────────────────────────────────────

/** Normalised box (0..1 of the frame). */
export type ObBox = {
  x: number;
  y: number;
  w: number;
  h: number;
  conf?: number;
};
export type ObTrackedBox = ObBox & { id: number };

/** Worker audio hop (10 Hz). */
export type ObAudioSample = {
  kind: 'audio';
  ptsNanos?: number;
  /** Date.now() when Node received it. */
  arrivalMs: number;
  procMs: number;
  rms: number; // dBFS, floor −90
  speechProb: number; // 0..1 (Silero VAD, max over the hop)
  speech: boolean; // gated with hysteresis
  onset: boolean; // energy onset inside the hop
  bands?: number[]; // 4 band energies 0..1
};
/** Worker video sample (~5 Hz). */
export type ObVideoSample = {
  kind: 'video';
  ptsNanos?: number;
  arrivalMs: number;
  procMs: number;
  frameW: number;
  frameH: number;
  persons: ObBox[];
  ball: ObBox | null;
  motion: number; // 0..1
};
/** A caption line (lands at air time). */
export type ObTranscriptSample = {
  kind: 'transcript';
  airMs: number;
  text: string;
  durationMs: number;
};
export type ObSignalSample = ObAudioSample | ObVideoSample | ObTranscriptSample;

/** Everything the brain knows about one camera, on the air clock. */
export type ObSignalState = {
  camId: string;
  lastAudioAirMs: number | null;
  lastVideoAirMs: number | null;
  staleAudio: boolean;
  staleVideo: boolean;
  /** Both streams silent ≥ 10 s — the camera is ignored by the brain. */
  offline: boolean;
  speech: boolean;
  speechSinceAirMs: number | null;
  silenceSinceAirMs: number | null;
  /** Fraction of the last 10 s with speech. */
  speechShare10s: number;
  speechProb: number;
  rmsDb: number;
  rmsEma: number;
  lastOnsetAirMs: number | null;
  onsetsPerSec: number;
  beat: {
    periodMs: number | null;
    phaseAirMs: number | null;
    confidence: number;
  };
  motion: number;
  motionEma: number;
  motionSpike: boolean;
  burst: {
    active: boolean;
    sinceAirMs: number | null;
    endedAirMs: number | null;
    peak: number;
  };
  people: {
    count: number;
    largest: ObTrackedBox | null;
    centroid: { x: number; y: number } | null;
    tracks: ObTrackedBox[];
  };
  ball: { x: number; y: number; conf: number; ageMs: number } | null;
  frame: { w: number; h: number } | null;
  /** Keyword hits from transcripts, last 15 s (group = ruleset keyword group). */
  keywords: { word: string; group: string; airMs: number }[];
  /** The LLM-confirmed host is on this camera (set by the controller). */
  host: {
    active: boolean;
    trackId: number | null;
    confidence: number;
    sinceAirMs: number | null;
  };
};

export interface ObClock {
  /** Air time of a worker sample. */
  airMsOf(
    camId: string,
    s: { ptsNanos?: number; arrivalMs: number; procMs: number },
  ): number;
  nowAir(): number;
  /** How far ahead of `nowAir()` the freshest signals are (≈ delay − procMs). */
  lookaheadMs(): number;
}

/** Signal aggregation (implemented by `signals.ts`, class `ObSignals`). */
export interface ObSignalsApi {
  ingest(camId: string, sample: ObSignalSample): void;
  /** Expire stale streams; call once per tick. */
  expire(nowAirMs: number): void;
  view(): Record<string, ObSignalState>;
  /** UI summary per camera (for `ob_signals`). */
  summary(): Record<string, ObSignalSummary>;
  setKeywordGroups(groups: Record<string, string[]> | undefined): void;
  /** Mark the confirmed host's camera (null clears every camera). */
  setHost(
    camId: string | null,
    info?: { trackId: number | null; confidence: number },
  ): void;
  /**
   * Person tracks that appeared since the last drain, debounced (a track must
   * survive `newPersonMinAgeMs` first). The controller drains once per tick.
   */
  drainNewPersons(): { camId: string; trackId: number; airMs: number }[];
  removeCam(camId: string): void;
  reset(): void;
}

// ── Brain ──────────────────────────────────────────────────────────────

export type ObBrainCam = {
  camId: string;
  number: number;
  role: ObCamRole;
  name: string;
  talent: string | null;
  /** Picture flowing and an input exists. */
  live: boolean;
};

export type ObBrainProgram = {
  shot: ObShot | null;
  sinceAirMs: number;
  history: { shot: ObShot; atAirMs: number }[];
  /** An auto cut is scheduled and not yet on air (the brain must not stack another). */
  pending: boolean;
  /** Operator override: auto pilot is paused until this air time. */
  manualUntilAirMs: number | null;
  /** A rule's hold: no auto change before this air time. */
  holdUntilAirMs: number | null;
};

export type ObBrainContext = {
  nowAir: number;
  lookaheadMs: number;
  cams: ObBrainCam[];
  signals: Record<string, ObSignalState>;
  program: ObBrainProgram;
  ruleset: ObRuleset;
  segment: { index: number; title: string } | null;
  /** Operator pacing dial (× min / max hold). */
  pacingFactor: number;
  overrides: {
    preferCam?: { camId: string; untilAirMs: number; boost: number };
    pacing?: Partial<ObPacing>;
  };
};

export type ObDecisionSource = 'rule' | 'score' | 'maxHold' | 'behaviour';

/** What the auto pilot wants on air, and when. */
export type ObDecision = {
  /** Air time the change should land at (≥ now; the controller schedules it). */
  atAirMs: number;
  shot?: ObShot;
  transition?: ObTransition;
  effects?: Partial<ObEffects>;
  lowerThird?: { camId: string; mode: 'talent' | 'off'; holdMs?: number };
  replay?: { camId: string; beforeMs: number; afterMs: number };
  pacing?: Partial<ObPacing>;
  /** No auto change before `atAirMs + holdMs`. */
  holdMs: number;
  /** One line for the log: 'CAM 2 · speech 2.4 s · faces 1 · held CAM 1 12 s'. */
  reason: string;
  reasons: string[];
  source: ObDecisionSource;
  ruleId?: string;
  score?: number;
};

/** Stateful auto pilot (implemented by `brain.ts` → `createObBrain`). */
export interface ObBrain {
  step(ctx: ObBrainContext): ObDecision | null;
  setRuleset(ruleset: ObRuleset): void;
  reset(): void;
}

/** Where a virtual camera should look on a camera (implemented in `brain.ts`). */
export type ObAttentionFn = (
  state: ObSignalState | undefined,
  target: ObAttentionTarget,
) => ObBox | null;

// ── LLM ────────────────────────────────────────────────────────────────

/** Compact situation report the LLM analyst reads. */
export type ObSituation = {
  atMs: number;
  phase: ObPhase;
  eventName: string;
  brief: string;
  presetId: ObPresetId;
  segment: { index: number; title: string } | null;
  rundown: string[];
  cams: {
    number: number;
    camId: string;
    name: string;
    role: ObCamRole;
    talent: string | null;
    live: boolean;
    onProgram: boolean;
    onPreview: boolean;
    /** 10 s means. */
    signals: {
      speechShare: number;
      rmsDb: number;
      motion: number;
      people: number;
    } | null;
  }[];
  program: { shot: ObShot | null; sinceMs: number; source: ObActionSource };
  pacing: { minHoldMs: number; maxHoldMs: number };
  lowerThird: { name: string; camNumber: number | null } | null;
  lastCuts: ObLogEntry[];
};

export type ObLlmDeps = {
  getSituation: () => ObSituation;
  /** Apply a bounded action through the controller (source 'llm'). */
  apply: (cmd: ObOperatorCommand, reasons: string[]) => void;
  log: (entry: Omit<ObLogEntry, 'id' | 'atMs'>) => void;
  onStatus: (status: ObLlmStatus) => void;
  now?: () => number;
};

export type ObBriefResult = {
  ruleset: ObRuleset;
  rationale: string;
  warnings: string[];
};

/** LLM layer owned by the controller (implemented by `llm/index.ts` → `createObLlm`). */
export interface ObLlmModule {
  status(): ObLlmStatus;
  generateRuleset(input: {
    brief: string;
    presetId: ObPresetId;
    cams: ObSituation['cams'];
    /** Ruleset the model adapts (the room's, overrides included); falls back to the plain preset. */
    base?: ObRuleset;
  }): Promise<ObBriefResult>;
  setAnalyst(enabled: boolean, intervalS?: number): void;
  /**
   * Host identification (vision): one snapshot + the host description →
   * `{isHost, confidence, reason}`, or null when the model refused / answered
   * without the tool. Rejects like the other one-shots (`busy`, `budget`,
   * `llm_unavailable`, transport errors).
   */
  identifyHost(input: {
    imageB64: string;
    hostDescription: string;
    camLabel: string;
  }): Promise<{ isHost: boolean; confidence: number; reason: string } | null>;
  onTranscript(camNumber: number, text: string, airMs: number): void;
  setPhase(phase: ObPhase): void;
  wrapNotes(input: {
    stats: ObStats;
    log: ObLogEntry[];
    brief: string;
    eventName: string;
  }): Promise<string>;
  kill(): void;
  dispose(): void;
}
