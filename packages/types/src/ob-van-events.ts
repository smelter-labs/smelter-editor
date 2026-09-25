// OB Van — an AI director for multi-camera events (conferences, sports,
// theatre, concerts). Cameras are phones over WHIP (QR join), file cams (local
// mp4 with a role) or adopted room inputs. A manual desk (program / preview
// buses, TAKE / CUT, shots, transitions, effects, lower thirds, audio policy,
// tally on the phones) is always available; the auto pilot cuts from
// per-camera signals (speech, loudness, onsets, motion, people, ball,
// transcript keywords) through a small rules DSL, and an optional LLM turns a
// natural-language brief into a ruleset and nudges the show every ~30 s.

// ── Cameras ──────────────────────────────────────────────────────────────

export type ObFixedCamRole =
  | "wide"
  | "speaker"
  | "guest"
  | "audience"
  | "slides"
  | "stage-left"
  | "stage-right"
  | "goal-left"
  | "goal-right";
/** A fixed role or `custom:<name>`. */
export type ObCamRole = ObFixedCamRole | `custom:${string}`;
export const OB_CAM_ROLES: readonly ObFixedCamRole[] = [
  "wide",
  "speaker",
  "guest",
  "audience",
  "slides",
  "stage-left",
  "stage-right",
  "goal-left",
  "goal-right",
];
export function isObCamRole(v: unknown): v is ObCamRole {
  if (typeof v !== "string") return false;
  if ((OB_CAM_ROLES as readonly string[]).includes(v)) return true;
  return /^custom:[\w .-]{1,24}$/.test(v);
}

/** Where a camera's picture comes from. */
export type ObCamKind = "whip" | "file" | "adopted";
/** Tally light: red on program, green on preview. */
export type ObTally = "program" | "preview" | "off";

export const OB_MAX_CAMS = 8;

export type ObCam = {
  /** Stable camera id (exists before a phone publishes). */
  id: string;
  /** Bus number 1..8 (buttons, keyboard, LLM references). */
  number: number;
  inputId: string | null;
  role: ObCamRole;
  name: string;
  /** Person on this camera — the lower third's name. */
  talent: string | null;
  kind: ObCamKind;
  /** Phone socket attached (always true for file / adopted cams). */
  connected: boolean;
  /** Picture flowing (WHIP heartbeat / file input connected). */
  live: boolean;
  tally: ObTally;
  fileName?: string;
  width?: number;
  height?: number;
  /** Side-channel delay registered for this camera's input (ms). */
  delayMs: number;
  /** The signal worker has reported for this camera recently. */
  signals: boolean;
};

// ── Shots ────────────────────────────────────────────────────────────────

export type ObPipCorner = "tl" | "tr" | "bl" | "br";
export type ObPipSize = "S" | "M" | "L";
/** What a virtual camera (digital pan/zoom of a wide camera) follows. */
export type ObAttentionTarget =
  | "speaker"
  | "largest"
  | "ball"
  | "centroid"
  | "motion";
export type ObZoom = "tight" | "normal" | "wide";

/** A shot over camera references `C` (camera ids on air, selectors in rules). */
export type ObShotOf<C> =
  | { kind: "solo"; cam: C }
  | { kind: "split"; cams: [C, C] }
  | {
      kind: "pip";
      main: C;
      inset: C;
      corner?: ObPipCorner;
      size?: ObPipSize;
    }
  | { kind: "quad"; cams: C[] }
  /** `cams: []` = every live camera. */
  | { kind: "grid"; cams: C[] }
  | { kind: "speaker-slides"; speaker: C; slides: C }
  | { kind: "virtual"; cam: C; target?: ObAttentionTarget; zoom?: ObZoom };

/** A resolved shot: camera ids. */
export type ObShot = ObShotOf<string>;
export type ObShotKind = ObShot["kind"];
export const OB_SHOT_KINDS: readonly ObShotKind[] = [
  "solo",
  "split",
  "pip",
  "quad",
  "grid",
  "speaker-slides",
  "virtual",
];

// ── Transitions, effects, graphics, audio ────────────────────────────────

/**
 * `cut` hard cut · `dissolve` A/B crossfade · `wipe` A/B wipe · `fade`
 * through black · `dip` to black and hold · `zoom-punch` incoming punches in
 * from an overscan.
 */
export type ObTransitionType =
  | "cut"
  | "fade"
  | "dissolve"
  | "wipe"
  | "dip"
  | "zoom-punch";
export const OB_TRANSITION_TYPES: readonly ObTransitionType[] = [
  "cut",
  "dissolve",
  "wipe",
  "fade",
  "dip",
  "zoom-punch",
];
export type ObTransition = {
  type: ObTransitionType;
  durationMs: number;
  /** `dip` only: how long the black holds. */
  holdMs?: number;
};
export const OB_TRANSITION_LIMITS = {
  durationMs: { min: 0, max: 3000 },
  holdMs: { min: 0, max: 5000 },
} as const;

export type ObGrade = "none" | "warm" | "cool" | "mono" | "vhs" | "neon";
export const OB_GRADES: readonly ObGrade[] = [
  "none",
  "warm",
  "cool",
  "mono",
  "vhs",
  "neon",
];
export type ObEffects = {
  grade: ObGrade;
  /** Vignette on the program picture. */
  spotlight: boolean;
  /** Blurred copy of the main camera behind split / PiP / portrait shots. */
  softBackground: boolean;
};

export type ObLowerThird = {
  name: string;
  subtitle: string | null;
  /** null = until cleared. */
  durationMs: number | null;
};
export type ObActiveLowerThird = ObLowerThird & {
  camId: string | null;
  startedAtMs: number;
  untilMs: number | null;
};

export type ObTitleBug = {
  event: string;
  segment: string | null;
  visible: boolean;
};

export type ObAudioPolicy =
  | { mode: "follow" }
  | { mode: "master"; cam: string }
  | { mode: "mix" };

// ── Show flow ────────────────────────────────────────────────────────────

export type ObPhase = "setup" | "on-air" | "wrap";
export type ObActionSource = "operator" | "auto" | "llm" | "system";
export type ObPresetId = "talk" | "match" | "stage" | "gig" | "custom";
export const OB_PRESET_IDS: readonly Exclude<ObPresetId, "custom">[] = [
  "talk",
  "match",
  "stage",
  "gig",
];
/** Operator pacing dial: multiplies the ruleset's min / max hold. */
export type ObPacingDial = "calm" | "lively" | "frantic";
export const OB_PACING_DIAL_FACTOR: Record<ObPacingDial, number> = {
  calm: 1.6,
  lively: 1,
  frantic: 0.6,
};

export type ObRundownItem = {
  id: string;
  title: string;
  /** Switch the auto pilot to this preset's rules when the segment goes. */
  preset?: Exclude<ObPresetId, "custom">;
};

// ── Rules DSL (the auto pilot) ───────────────────────────────────────────

/**
 * Camera selector inside rules: a role (first live camera with it), `any`,
 * `program` (a camera on air), `not-program` (best-scoring camera off air),
 * `trigger` (the camera that satisfied the rule's condition) or `id:<camId>`
 * / `cam:<number>`.
 */
export type ObCamSelector =
  | ObCamRole
  | "any"
  | "program"
  | "not-program"
  | "trigger"
  | `id:${string}`
  | `cam:${number}`;

export type ObSignalKind =
  | "speech"
  | "silence"
  | "speechShare"
  | "rms"
  | "onset"
  | "onsetsPerSec"
  | "motion"
  | "motionSpike"
  | "burst"
  | "people"
  | "ball"
  | "ballAge"
  | "keyword"
  | "hold"
  | "segment"
  | "dialogue";
export const OB_SIGNAL_KINDS: readonly ObSignalKind[] = [
  "speech",
  "silence",
  "speechShare",
  "rms",
  "onset",
  "onsetsPerSec",
  "motion",
  "motionSpike",
  "burst",
  "people",
  "ball",
  "ballAge",
  "keyword",
  "hold",
  "segment",
  "dialogue",
];
export type ObOp = ">" | ">=" | "<" | "<=" | "==" | "!=" | "has";
export const OB_OPS: readonly ObOp[] = [">", ">=", "<", "<=", "==", "!=", "has"];

export type ObConditionLeaf = {
  signal: ObSignalKind;
  cam?: ObCamSelector;
  op?: ObOp;
  value?: number | string | boolean;
  /** Condition must hold continuously this long. */
  forMs?: number;
};
/** One level only — no recursion (keeps the JSON schema LLM-safe). */
export type ObCondition =
  | ObConditionLeaf
  | { all: ObConditionLeaf[] }
  | { any: ObConditionLeaf[] }
  | { not: ObConditionLeaf };

export type ObShotTemplate = ObShotOf<ObCamSelector>;

export type ObAction = {
  shot?: ObShotTemplate;
  transition?: { type: ObTransitionType; durationMs?: number };
  effects?: Partial<ObEffects>;
  lowerThird?: {
    cam: ObCamSelector;
    mode: "talent" | "off";
    holdMs?: number;
  };
  replay?: { cam: ObCamSelector; beforeMs: number; afterMs: number };
  pacing?: Partial<ObPacing>;
};

export type ObRule = {
  id: string;
  name: string;
  when: ObCondition;
  then: ObAction;
  /** 0..100; ≥ 80 cuts through min hold. */
  priority: number;
  cooldownMs?: number;
  /** Auto pilot holds the result at least this long. */
  holdMs?: number;
  enabled?: boolean;
};

export type ObPacing = {
  minHoldMs: number;
  maxHoldMs: number;
  transition: ObTransitionType;
  transitionMs?: number;
  /** Pull a speech-onset cut this much before the onset airs. */
  anticipateMs?: number;
};

export type ObWeights = {
  speech: number;
  motion: number;
  people: number;
  ball: number;
  novelty: number;
  stay: number;
  roleBias?: Partial<Record<ObFixedCamRole, number>>;
};

export type ObBehaviours = {
  monologueLock?: boolean;
  dialogueSplit?: boolean;
  onsetCuts?: boolean;
  anticipate?: boolean;
  burstReplay?: boolean;
};

export type ObRuleset = {
  id: string;
  name: string;
  preset: ObPresetId;
  pacing: ObPacing;
  weights: ObWeights;
  behaviours?: ObBehaviours;
  /** Keyword groups matched in transcripts (`keyword has <group>`). */
  keywords?: Record<string, string[]>;
  rules: ObRule[];
};

export const OB_RULESET_LIMITS = {
  minHoldMs: { min: 500, max: 15000 },
  maxHoldMs: { min: 2000, max: 60000 },
  transitionMs: { min: 0, max: 3000 },
  anticipateMs: { min: 0, max: 1000 },
  priority: { min: 0, max: 100 },
  cooldownMs: { min: 0, max: 120000 },
  holdMs: { min: 0, max: 60000 },
  forMs: { min: 0, max: 30000 },
  weight: { min: -3, max: 3 },
  rules: { max: 24 },
  keywordGroups: { max: 8 },
  keywordsPerGroup: { max: 16 },
} as const;

// ── Config ───────────────────────────────────────────────────────────────

export type ObConfig = {
  eventName: string;
  presetId: ObPresetId;
  /** null = the preset's ruleset. */
  ruleset: ObRuleset | null;
  pacingDial: ObPacingDial;
  autoPilot: boolean;
  /** A manual action pauses the auto pilot this long. */
  resumeAfterMs: number;
  /** TAKE transition. */
  transition: ObTransition;
  audio: ObAudioPolicy;
  effects: ObEffects;
  /** Default lower-third duration. */
  lowerThirdMs: number;
  titleBugVisible: boolean;
  /** Transcribe speaker / guest / wide cams (keywords, LLM names). Delays every camera to 8 s. */
  captions: boolean;
  /** The host's natural-language brief (LLM input). */
  brief: string;
  rundown: ObRundownItem[];
  llm: { analyst: boolean; analystIntervalS: number };
  joinUrls?: { cam?: string };
};

export type ObConfigPatch = {
  eventName?: string;
  presetId?: ObPresetId;
  ruleset?: ObRuleset | null;
  pacingDial?: ObPacingDial;
  autoPilot?: boolean;
  resumeAfterMs?: number;
  transition?: Partial<ObTransition>;
  audio?: ObAudioPolicy;
  effects?: Partial<ObEffects>;
  lowerThirdMs?: number;
  titleBugVisible?: boolean;
  captions?: boolean;
  brief?: string;
  rundown?: ObRundownItem[];
  llm?: Partial<ObConfig["llm"]>;
  joinUrls?: { cam?: string };
};

export const OB_DEFAULT_CONFIG: ObConfig = {
  eventName: "OB VAN",
  presetId: "talk",
  ruleset: null,
  pacingDial: "lively",
  autoPilot: false,
  resumeAfterMs: 20000,
  transition: { type: "dissolve", durationMs: 400 },
  audio: { mode: "follow" },
  effects: { grade: "none", spotlight: false, softBackground: true },
  lowerThirdMs: 6000,
  titleBugVisible: true,
  captions: false,
  brief: "",
  rundown: [],
  llm: { analyst: false, analystIntervalS: 30 },
};

export const OB_CONFIG_LIMITS = {
  resumeAfterMs: { min: 0, max: 120000 },
  lowerThirdMs: { min: 1000, max: 30000 },
  analystIntervalS: { min: 10, max: 300 },
  eventName: { max: 48 },
  brief: { max: 4000 },
  rundown: { max: 20 },
} as const;

// ── Live state ───────────────────────────────────────────────────────────

/** Per-camera signal summary for the UI (~4 Hz). */
export type ObSignalSummary = {
  speech: boolean;
  speechProb: number;
  rmsDb: number;
  onset: boolean;
  motion: number;
  people: number;
  ball: boolean;
  stale: boolean;
};

export type ObLogKind =
  | "take"
  | "cut"
  | "preview"
  | "shot"
  | "transition"
  | "fx"
  | "lower_third"
  | "title"
  | "audio"
  | "auto"
  | "replay"
  | "cam"
  | "phase"
  | "segment"
  | "ruleset"
  | "pacing"
  | "llm"
  | "note"
  | "late"
  | "error";
export type ObLogTone = "dim" | "chalk" | "good" | "amber" | "bad" | "ai";
export type ObLogEntry = {
  id: number;
  atMs: number;
  source: ObActionSource;
  kind: ObLogKind;
  tone: ObLogTone;
  label: string;
  text: string;
  reasons?: string[];
  camId?: string;
};

export type ObLlmStatus = {
  /** An API key is configured on the server. */
  available: boolean;
  model: string | null;
  analyst: boolean;
  intervalS: number;
  busy: boolean;
  runs: number;
  tokensIn: number;
  tokensOut: number;
  estCostUsd: number;
  lastRunAtMs: number | null;
  lastNote: string | null;
  backoffUntilMs: number | null;
  error: string | null;
};

export type ObStats = {
  startedAtMs: number | null;
  endedAtMs: number | null;
  cuts: number;
  bySource: Record<ObActionSource, number>;
  /** Milliseconds each camera spent on program (any shot containing it). */
  onAirMsByCam: Record<string, number>;
  avgHoldMs: number;
};

export type ObState = {
  roomId: string;
  phase: ObPhase;
  config: ObConfig;
  /** The effective ruleset (config.ruleset or the preset's). */
  ruleset: ObRuleset;
  cams: ObCam[];
  program: {
    shot: ObShot | null;
    sinceMs: number;
    source: ObActionSource;
    transition: {
      type: ObTransitionType;
      startedAtMs: number;
      durationMs: number;
    } | null;
  };
  preview: ObShot | null;
  autoPilot: {
    on: boolean;
    pausedUntilMs: number | null;
    /** A scheduled auto cut (lands at air time). */
    next: { shot: ObShot | null; atMs: number; reason: string } | null;
    lastDecisionAtMs: number | null;
  };
  effects: ObEffects;
  lowerThird: ObActiveLowerThird | null;
  titleBug: ObTitleBug;
  audio: ObAudioPolicy;
  replay: { camId: string; untilMs: number } | null;
  rundown: { items: ObRundownItem[]; index: number };
  operator: { name: string } | null;
  overrides: {
    pacing: { minHoldMs?: number; maxHoldMs?: number } | null;
    preferCam: { camId: string; untilMs: number } | null;
  };
  llm: ObLlmStatus;
  stats: ObStats;
  wrapNotes: string | null;
  isRecording: boolean;
  log: ObLogEntry[];
};

// ── Commands (one vocabulary: panel WS, host REST, keyboard, LLM) ────────

export type ObOperatorCommand =
  | { op: "preview"; shot: ObShot }
  | { op: "take"; transition?: ObTransition }
  | { op: "cut" }
  | { op: "shot"; shot: ObShot; mode: "take" | "cut" | "preview" }
  | { op: "transition"; transition: Partial<ObTransition> }
  | { op: "fx"; effects: Partial<ObEffects> }
  | {
      op: "lower_third";
      camId?: string;
      name?: string;
      subtitle?: string | null;
      ms?: number | null;
      clear?: boolean;
    }
  | {
      op: "title_bug";
      event?: string;
      segment?: string | null;
      visible?: boolean;
    }
  | { op: "audio"; audio: ObAudioPolicy }
  | { op: "auto"; enabled: boolean }
  | { op: "dip"; holdMs?: number }
  | { op: "segment"; action: "next" | "prev" | "goto"; index?: number }
  | { op: "replay"; camId?: string; mediaMs?: number }
  | {
      op: "cam";
      action: "role" | "name" | "talent" | "kick";
      camId: string;
      value?: string;
    }
  | { op: "pacing"; minHoldMs?: number; maxHoldMs?: number; clear?: boolean }
  | { op: "prefer_cam"; camId: string; forMs: number; boost?: number }
  | { op: "note"; text: string };
export type ObOperatorOp = ObOperatorCommand["op"];

export type ObControlAction =
  | "setup"
  | "go_live"
  | "wrap"
  | "reset"
  | "kick_cam";
export const OB_CONTROL_ACTIONS: readonly ObControlAction[] = [
  "setup",
  "go_live",
  "wrap",
  "reset",
  "kick_cam",
];

// ── WebSocket: client → server ───────────────────────────────────────────

export type ObSpectateMessage = { type: "ob_spectate" };
export type ObOperatorJoinMessage = {
  type: "ob_operator_join";
  name: string;
  operatorKey?: string;
};
export type ObOperatorLeaveMessage = { type: "ob_operator_leave" };
export type ObOperatorCmdMessage = {
  type: "ob_operator_cmd";
  cmd: ObOperatorCommand;
};
export type ObCamJoinMessage = {
  type: "ob_cam_join";
  name: string;
  role: ObCamRole;
  talent?: string | null;
  camKey?: string;
};
export type ObCamRequestMessage = {
  type: "ob_cam_request";
  nativeWidth?: number;
  nativeHeight?: number;
};
export type ObCamStopMessage = { type: "ob_cam_stop" };
export type ObCamLeaveMessage = { type: "ob_cam_leave" };
export type ObClientMessage =
  | ObSpectateMessage
  | ObOperatorJoinMessage
  | ObOperatorLeaveMessage
  | ObOperatorCmdMessage
  | ObCamJoinMessage
  | ObCamRequestMessage
  | ObCamStopMessage
  | ObCamLeaveMessage;

// ── WebSocket: server → client ───────────────────────────────────────────

export type ObStateEvent = { type: "ob_state"; state: ObState };
export type ObCamJoinedEvent = {
  type: "ob_cam_joined";
  camId: string;
  camKey: string;
  number: number;
  role: ObCamRole;
  name: string;
  talent: string | null;
  tally: ObTally;
  phase: ObPhase;
  /** A camera input already exists for this seat (resume → republish). */
  camInputActive: boolean;
};
export type ObCamOfferEvent = {
  type: "ob_cam_offer";
  camId: string;
  inputId: string;
  whipUrl: string;
  bearerToken: string;
};
export type ObTallyEvent = {
  type: "ob_tally";
  camId: string;
  tally: ObTally;
  number: number;
};
export type ObOperatorJoinedEvent = {
  type: "ob_operator_joined";
  operatorKey: string;
  name: string;
};
export type ObLogEvent = {
  type: "ob_log";
  entries: ObLogEntry[];
  reset?: boolean;
};
export type ObSignalsEvent = {
  type: "ob_signals";
  atMs: number;
  signals: Record<string, ObSignalSummary>;
};
export type ObErrorCode =
  | "not_joined"
  | "unknown_cam"
  | "cam_not_live"
  | "room_full"
  | "invalid_shot"
  | "invalid_transition"
  | "invalid_ruleset"
  | "bad_action"
  | "bad_phase"
  | "no_file_cam"
  | "replay_busy"
  | "llm_unavailable";
export type ObErrorEvent = {
  type: "ob_error";
  code: ObErrorCode;
  message: string;
};
export type ObServerEvent =
  | ObStateEvent
  | ObCamJoinedEvent
  | ObCamOfferEvent
  | ObTallyEvent
  | ObOperatorJoinedEvent
  | ObLogEvent
  | ObSignalsEvent
  | ObErrorEvent;
