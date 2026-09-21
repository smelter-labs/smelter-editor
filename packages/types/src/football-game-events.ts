// Football Game ("Touchline") — a broadcast production for a football match
// played from dataset file cameras (Alfheim: a stitched stadium panorama, or
// three fixed cameras), with a virtual director cutting a 16:9 window out of
// the panorama that follows the ball, AI EVENTS (chance / shot / corner / goal
// candidate / sprint / attack) fired from the clip's annotated telemetry with
// banners, a ledger and instant replay, and a tracking minimap of the tagged
// (home) players. A moderator panel confirms goal candidates, edits the
// ledger, drives the clock and picks the view.

export type FbTeamId = "A" | "B";
export const FB_TEAM_IDS: FbTeamId[] = ["A", "B"];

/**
 * File camera roles. `pano` = the stitched panorama (one source, virtual
 * views); `left` / `centre` / `right` = the three fixed cameras of a
 * three-camera session (the director cuts between them).
 */
export type FbCamRole = "pano" | "left" | "centre" | "right";
export const FB_CAM_ROLES: FbCamRole[] = ["pano", "left", "centre", "right"];

/** Which kind of footage is attached (from the clip's `.alfheim.json`). */
export type FbSession = "pano" | "tricam";

/** Goal ends of the picture: `left` = the goal on the left of the panorama / the left camera. */
export type FbSide = "left" | "right";

/**
 * Match flow: 'lobby' = file cams attaching; 'live' = a half is running;
 * 'paused' = clock frozen; 'halftime' = between the halves; 'ended' = full time.
 */
export type FbPhase = "lobby" | "live" | "paused" | "halftime" | "ended";
export type FbPeriod = 1 | 2;

/**
 * Event kinds. `goal` lands as a REF CALL (pending) unless entered by the
 * moderator; `chance` / `shot` / `corner` / `goal_kick` are confirmed plays;
 * `sprint` / `attack` come from the player telemetry; `out` is ledger-only.
 */
export type FbEventKind =
  | "goal"
  | "chance"
  | "shot"
  | "corner"
  | "goal_kick"
  | "sprint"
  | "attack"
  | "out";
export const FB_EVENT_KINDS: readonly FbEventKind[] = [
  "goal",
  "chance",
  "shot",
  "corner",
  "goal_kick",
  "sprint",
  "attack",
  "out",
];

/**
 * Broadcast views. Panorama session: `auto` (the director follows the ball
 * and widens on set pieces), `wide` (whole pitch), `follow`, `left-goal` /
 * `right-goal` (fixed crops on a penalty area). Three-camera session: `auto`
 * (cut by where the play is) or a fixed camera.
 */
export type FbView =
  | "auto"
  | "wide"
  | "follow"
  | "left-goal"
  | "right-goal"
  | "left"
  | "centre"
  | "right";
export const FB_PANO_VIEWS: readonly FbView[] = [
  "auto",
  "follow",
  "wide",
  "left-goal",
  "right-goal",
];
export const FB_TRICAM_VIEWS: readonly FbView[] = [
  "auto",
  "left",
  "centre",
  "right",
];

export type FbTeamConfig = {
  name: string;
  /** Score-bug abbreviation (3–4 letters). */
  short: string;
  /** Kit colour, `#rrggbb` — HUD stripes and the minimap dots. */
  color: string;
};

export type FbDirectorZoom = "tight" | "normal" | "wide";
export type FbDirectorSmoothing = "snappy" | "smooth";
export type FbDirectorSwitch = "glide" | "cut";

/** Virtual director knobs (panorama session; the cut rule for three cameras). */
export type FbDirectorConfig = {
  zoom: FbDirectorZoom;
  /** View switches glide (eased move) or hard-cut with a fade. */
  switchStyle: FbDirectorSwitch;
  /** How far ahead of the on-air frame the follow window aims (the ball's future is known). */
  lookaheadMs: number;
  /** How far behind the on-air frame the ball track is averaged into the follow target. */
  averageMs: number;
  /** Time the follow window takes to settle on its target (critically damped). */
  smoothTimeMs: number;
  /** The ball may wander this far (full-panorama px) before the window moves. */
  deadZonePx: number;
  /** Follow window speed limit (full-panorama px/s). */
  maxSpeedPxS: number;
  /** Long balls: settle faster and lift the speed limit while the window is far behind. */
  catchUp: boolean;
};

/** Clamp ranges of the numeric director knobs (shared by the server and the editor). */
export const FB_DIRECTOR_LIMITS = {
  lookaheadMs: { min: 0, max: 2000, step: 100 },
  averageMs: { min: 0, max: 1500, step: 100 },
  smoothTimeMs: { min: 100, max: 3000, step: 50 },
  deadZonePx: { min: 0, max: 400, step: 10 },
  maxSpeedPxS: { min: 200, max: 5000, step: 100 },
} as const;

/** Legacy `smoothing` preset → smooth time (still accepted in a config patch). */
export const FB_SMOOTHING_PRESET_MS: Record<FbDirectorSmoothing, number> = {
  snappy: 350,
  smooth: 600,
};

/** Tracking minimap size step: 1 = 336×218 at 1080p, 5 = the largest. */
export type FbMinimapSize = 1 | 2 | 3 | 4 | 5;
export const FB_MINIMAP_SIZES: readonly FbMinimapSize[] = [1, 2, 3, 4, 5];

/** AI EVENTS: what fires from the clip's telemetry and which kinds get a replay. */
export type FbAiConfig = {
  events: boolean;
  kinds: FbEventKind[];
  replayOn: FbEventKind[];
};

export type FbPerfConfig = {
  animTickHz: 60 | 30 | 15;
  hudPublishHz: 10 | 5 | 2;
  recordingPreset: "ultrafast" | "superfast" | "veryfast" | "fast" | "medium";
  recordingScale: 1 | 0.75 | 0.5;
};

export type FbConfig = {
  teams: Record<FbTeamId, FbTeamConfig>;
  /** Half length; clamped server-side to 1..60 min. */
  halfMs: number;
  /** Take the match clock from the clip (its events sidecar names the kick-off). */
  clockFromClip: boolean;
  /**
   * Which team attacks the LEFT goal of the picture in the first half; null
   * = whatever the clip's events sidecar says (Tromsø's own half from ZXY).
   */
  attacksLeft: FbTeamId | null;
  director: FbDirectorConfig;
  ai: FbAiConfig;
  /** Instant replay window after a replay-worthy event. */
  replay: boolean;
  /** How long the banner shows alone before the REPLAY window opens. */
  replayDelayMs: number;
  /** Tracking minimap on air. */
  minimap: boolean;
  minimapSize: FbMinimapSize;
  perf: FbPerfConfig;
};

export type FbDirectorPatch = Partial<FbDirectorConfig> & {
  /** Legacy preset; sets `smoothTimeMs`. */
  smoothing?: FbDirectorSmoothing;
};

/** Partial config as accepted by POST /room/:id/football-game/config. */
export type FbConfigPatch = {
  teams?: Partial<Record<FbTeamId, Partial<FbTeamConfig>>>;
  halfMs?: number;
  clockFromClip?: boolean;
  attacksLeft?: FbTeamId | null;
  director?: FbDirectorPatch;
  ai?: Partial<FbAiConfig>;
  replay?: boolean;
  replayDelayMs?: number;
  minimap?: boolean;
  minimapSize?: number;
  perf?: Partial<FbPerfConfig>;
  /** Moderator panel join URL — the server renders it as the lobby QR. */
  joinUrls?: Partial<Record<"commentator", string>>;
  joinLabel?: string;
};

/** Ledger edit as accepted by POST /room/:id/football-game/event. */
export type FbEventEdit = {
  op: "resolve" | "add" | "undo";
  eventId?: string;
  team?: FbTeamId | null;
  kind?: FbEventKind;
  voided?: boolean;
};

export const FB_TEAM_COLOR_PRESETS: {
  id: string;
  label: string;
  color: string;
}[] = [
  { id: "red", label: "RED", color: "#d7263d" },
  { id: "navy", label: "NAVY", color: "#132257" },
  { id: "white", label: "WHITE", color: "#f4f1e8" },
  { id: "sky", label: "SKY", color: "#6cabdd" },
  { id: "yellow", label: "YELLOW", color: "#ffd21f" },
  { id: "green", label: "GREEN", color: "#2fbf71" },
  { id: "orange", label: "ORANGE", color: "#ff6a1f" },
  { id: "black", label: "BLACK", color: "#141416" },
];

export const FB_DEFAULT_CONFIG: FbConfig = {
  teams: {
    A: { name: "TROMSØ", short: "TIL", color: "#d7263d" },
    B: { name: "TOTTENHAM", short: "TOT", color: "#132257" },
  },
  halfMs: 45 * 60_000,
  clockFromClip: true,
  attacksLeft: null,
  director: {
    zoom: "normal",
    switchStyle: "glide",
    lookaheadMs: 500,
    averageMs: 200,
    smoothTimeMs: 600,
    deadZonePx: 60,
    maxSpeedPxS: 1200,
    catchUp: true,
  },
  ai: {
    events: true,
    kinds: ["goal", "chance", "shot", "corner", "sprint"],
    replayOn: ["shot", "goal"],
  },
  replay: true,
  replayDelayMs: 1500,
  minimap: true,
  minimapSize: 1,
  perf: {
    animTickHz: 60,
    hudPublishHz: 5,
    recordingPreset: "ultrafast",
    recordingScale: 1,
  },
};

export type FbEventStatus = "pending" | "confirmed" | "voided";

/**
 * One ledger entry. Scores are derived from confirmed goals, so every
 * moderator correction (assign / void / undo) is an edit here.
 */
export type FbEventEntry = {
  id: string;
  /** 1-based position in the ledger (stable across edits). */
  index: number;
  /** Server epoch ms when the event was ingested. */
  atMs: number;
  /** Clip media time (ms) of the driving file cam at ingest. */
  mediaMs?: number;
  kind: FbEventKind;
  team: FbTeamId | null;
  /** Goal end the play happened at, when it has one. */
  side?: FbSide;
  status: FbEventStatus;
  source: "ai" | "manual";
  /** The AI's confidence in the call (deterministic per play). */
  aiConfidence: number;
  /** One-line detail for the ledger / AI log. */
  detail?: string;
  /** sprint: player tag + top speed. */
  tag?: number;
  topKmh?: number;
  /** shot: ball speed and whether it reached the goal mouth. */
  speedMs?: number;
  onTarget?: boolean;
  period: FbPeriod;
  /** Match clock at ingest (ms elapsed in the period). */
  clockMs: number;
  /** An instant replay was shown for it. */
  replayed?: boolean;
};

export type FbTeamStats = {
  name: string;
  short: string;
  color: string;
  score: number;
  chances: number;
  shots: number;
  shotsOnTarget: number;
  corners: number;
  sprints: number;
};

/** Per-player telemetry summary (tagged team only). */
export type FbTrackingStats = {
  tag: number;
  topKmh: number;
  meters: number;
  sprints: number;
};

/**
 * Playhead of a file camera's clip, derived from the engine registration:
 * media time now = playFromMs + (now − anchor), modulo durationMs when looping.
 */
export type FbClipClock = {
  playFromMs: number;
  mediaMs: number;
  durationMs: number | null;
  /** Side-channel delay (ms): frames air this long after the AI sees them (0 without a model). */
  delayMs: number;
};

/** Public camera slot info in `fb_state`. */
export type FbCam = {
  role: FbCamRole;
  /** The file input is registered and connected. */
  connected: boolean;
  source: "file";
  /** Path relative to data/mp4s. */
  fileName?: string;
  clip?: FbClipClock;
  camWidth?: number;
  camHeight?: number;
  /** From the clip's `.alfheim.json`. */
  session?: FbSession;
  /** Which sidecars were found next to the clip. */
  telemetry?: { zxy: boolean; ball: boolean; zones: boolean; events: boolean };
};

export type FbCommentator = {
  name: string;
  connected: boolean;
};

/**
 * Broadcast scenes: lobby (file-cam status + panel QR over the picture),
 * live (director view + score bug), replay (live layout dimmed under the
 * REPLAY window), ended (final card).
 */
export type FbSceneName = "lobby" | "live" | "replay" | "ended";

export type FbViewOverride = { mode: "auto" } | { mode: "view"; view: FbView };

/** Where the director is right now (1 Hz in `fb_state` / `fb_director`). */
export type FbDirectorState = {
  session: FbSession | null;
  /** The requested view (`auto` or an override). */
  view: FbView;
  /** What is actually on air (auto resolves to follow / wide / a camera). */
  effectiveView: FbView;
  /** Panorama session: the crop in full-panorama pixels. */
  crop: { x: number; y: number; w: number; h: number } | null;
  /** Three-camera session: the camera on air. */
  cam: FbCamRole | null;
  ballTracked: boolean;
};

export type FbMatchAction =
  | "lobby"
  | "start"
  | "pause"
  | "resume"
  | "half_time"
  | "second_half"
  | "end"
  | "reset"
  | "kick_cam"
  | "kick_commentator";

export const FB_MATCH_ACTIONS: readonly FbMatchAction[] = [
  "lobby",
  "start",
  "pause",
  "resume",
  "half_time",
  "second_half",
  "end",
  "reset",
  "kick_cam",
  "kick_commentator",
];

/**
 * AI EVENTS status: `off`; `no_clip` = on, waiting for a file cam;
 * `loading` = clip attached, sidecar being read / clip clock not ready;
 * `armed` = the clip's plays are loaded and fire at their clip time;
 * `no_events` = the clip has no events sidecar.
 */
export type FbAiEventsStatus =
  | "off"
  | "no_clip"
  | "loading"
  | "armed"
  | "no_events";

/** The armed events run (null when nothing is loaded). */
export type FbAiRunState = {
  fileName: string;
  total: number;
  fired: number;
  skipped: number;
  nextEventTMs: number | null;
  nextFireInMs: number | null;
  clockRole: FbCamRole | null;
};

// ── Client -> Server (room WS, `fb_` prefix) ─────────────────────────────────

export type FbSpectateMessage = { type: "fb_spectate" };

/** The moderator panel joins as the commentator (one slot per room). */
export type FbCommentatorJoinMessage = {
  type: "fb_commentator_join";
  name: string;
  commentatorKey?: string;
};
export type FbCommentatorLeaveMessage = { type: "fb_commentator_leave" };
export type FbCommentatorViewMessage = {
  type: "fb_commentator_view";
  override: FbViewOverride;
};
export type FbCommentatorMatchMessage = {
  type: "fb_commentator_match";
  action: FbMatchAction;
  role?: FbCamRole;
};
export type FbCommentatorAiEventsMessage = {
  type: "fb_commentator_ai_events";
  enabled: boolean;
};
export type FbCommentatorMinimapMessage = {
  type: "fb_commentator_minimap";
  enabled: boolean;
};
export type FbCommentatorMinimapSizeMessage = {
  type: "fb_commentator_minimap_size";
  size: number;
};
/** Live follow tuning from the moderator panel. */
export type FbCommentatorDirectorMessage = {
  type: "fb_commentator_director";
  director: FbDirectorPatch;
};
export type FbCommentatorReplayMessage = {
  type: "fb_commentator_replay";
  enabled: boolean;
};
export type FbTeamColorMessage = {
  type: "fb_team_color";
  team: FbTeamId;
  color: string;
};
export type FbEventResolveMessage = {
  type: "fb_event_resolve";
  eventId: string;
  team?: FbTeamId | null;
  kind?: FbEventKind;
  voided?: boolean;
};
export type FbEventAddMessage = {
  type: "fb_event_add";
  team: FbTeamId;
  kind: FbEventKind;
};
/** Void the given event, or the newest confirmed goal when omitted. */
export type FbEventUndoMessage = { type: "fb_event_undo"; eventId?: string };

export type FbClientMessage =
  | FbSpectateMessage
  | FbCommentatorJoinMessage
  | FbCommentatorLeaveMessage
  | FbCommentatorViewMessage
  | FbCommentatorMatchMessage
  | FbCommentatorAiEventsMessage
  | FbCommentatorMinimapMessage
  | FbCommentatorMinimapSizeMessage
  | FbCommentatorDirectorMessage
  | FbCommentatorReplayMessage
  | FbTeamColorMessage
  | FbEventResolveMessage
  | FbEventAddMessage
  | FbEventUndoMessage;

// ── Server -> Client ─────────────────────────────────────────────────────────

/** Full snapshot. Broadcast on every roster / config / phase / ledger change. */
export type FbStateEvent = {
  type: "fb_state";
  roomId: string;
  phase: FbPhase;
  period: FbPeriod;
  config: FbConfig;
  teams: Record<FbTeamId, FbTeamStats>;
  cams: Record<FbCamRole, FbCam>;
  session: FbSession | null;
  commentator: FbCommentator | null;
  scene: FbSceneName;
  viewOverride: FbViewOverride;
  director: FbDirectorState;
  minimap: boolean;
  aiEvents: FbAiEventsStatus;
  aiRun: FbAiRunState | null;
  /** Goal candidates awaiting the moderator (newest first). */
  pending: FbEventEntry[];
  /** Newest ledger entries (any status), newest first, capped. */
  recent: FbEventEntry[];
  tracking: FbTrackingStats[];
  winner: FbTeamId | null;
  isRecording?: boolean;
};

/** Reply to `fb_commentator_join`, unicast. */
export type FbCommentatorJoinedEvent = {
  type: "fb_commentator_joined";
  roomId: string;
  clientId: string;
  commentatorKey: string;
  name: string;
  phase: FbPhase;
};

/** Authoritative clock + score, at 1 Hz while a half runs and on every transition. */
export type FbMatchEvent = {
  type: "fb_match";
  roomId: string;
  phase: FbPhase;
  period: FbPeriod;
  /** Epoch ms the current half started (null in lobby). */
  startedAtMs: number | null;
  /** Ms elapsed in the current half (counts past halfMs as added time). */
  elapsedMs: number;
  halfMs: number;
  /** The clock is taken from the clip's kick-off. */
  clockFromClip: boolean;
  scores: Record<FbTeamId, number>;
  winner: FbTeamId | null;
};

/** Ledger change — the play-by-play feed. */
export type FbEventChangeEvent = {
  type: "fb_event";
  roomId: string;
  kind: "fired" | "assigned" | "voided" | "manual" | "undone";
  event: FbEventEntry;
  scores: Record<FbTeamId, number>;
};

/** Director position, 1 Hz while on air. */
export type FbDirectorEvent = {
  type: "fb_director";
  roomId: string;
  director: FbDirectorState;
};

export type FbAiLogTone = "dim" | "chalk" | "grass" | "good" | "amber" | "bad";

/** One line of the AI EVENTS log ("what fired and why"). */
export type FbAiLogEntry = {
  id: number;
  atMs: number;
  /** Clip media time (s) of the play, when it comes from the telemetry. */
  t?: number;
  kind:
    | "event"
    | "refcall"
    | "director"
    | "clock"
    | "replay"
    | "session"
    | "ai";
  tone: FbAiLogTone;
  label: string;
  text: string;
  detail?: string;
};

export type FbAiLogEvent = {
  type: "fb_ai_log";
  roomId: string;
  entries: FbAiLogEntry[];
  reset?: boolean;
};

export type FbErrorCode =
  | "not_joined"
  | "role_taken"
  | "not_commentator"
  | "invalid_view"
  | "invalid_color"
  | "invalid_event"
  | "unknown_event"
  | "bad_action"
  | "no_camera"
  | "no_telemetry";

export type FbErrorEvent = {
  type: "fb_error";
  roomId: string;
  code: FbErrorCode;
  message: string;
  context?: Record<string, string | number>;
};

export type FbServerEvent =
  | FbStateEvent
  | FbCommentatorJoinedEvent
  | FbMatchEvent
  | FbEventChangeEvent
  | FbDirectorEvent
  | FbAiLogEvent
  | FbErrorEvent;
