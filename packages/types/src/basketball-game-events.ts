// Basketball Game ("Blacktop") — a QR-joinable arcade production for one-hoop
// streetball (FIBA 3x3 rules): two teams, phone cameras on the hoop and the
// court, a commentator, and the basketball-scorer model counting made baskets
// from the hoop camera and attributing them to a team by jersey colour. The
// moderator panel confirms low-confidence makes and corrects the ledger.

export type BbTeamId = "A" | "B";
export const BB_TEAM_IDS: BbTeamId[] = ["A", "B"];

/** Phone camera roles. `hoop` runs the AI, `court` is the wide broadcast picture. */
export type BbCamRole = "hoop" | "court";
export const BB_CAM_ROLES: BbCamRole[] = ["hoop", "court"];

/**
 * Match flow: 'lobby' = cameras joining + calibration; 'live' = regulation
 * clock running; 'paused' = clock frozen (shots still land as pending);
 * 'overtime' = untimed, first team to `otWinPoints`; 'ended' = final.
 */
export type BbPhase = "lobby" | "live" | "paused" | "overtime" | "ended";
export type BbPeriod = "reg" | "ot";

/** Rim ellipse in the hoop camera's normalized frame space (0..1). */
export type BbRim = { cx: number; cy: number; rx: number; ry: number };

export type BbBallDetector = "auto" | "yolo" | "hsv";
export type BbYoloWeights = "auto" | "yolo11n.pt" | "yolo11s.pt" | "yolo11m.pt";

export type BbTeamConfig = {
  name: string;
  /** Jersey/bib colour, `#rrggbb` — drives HUD chrome AND the AI classifier. */
  color: string;
};

/** Detection knobs forwarded (flattened) to the basketball-scorer worker. */
export type BbDetectorConfig = {
  ballDetector: BbBallDetector;
  yoloWeights: BbYoloWeights;
  /** YOLO inference size; higher catches a smaller ball, slower on CPU. */
  imgsz: number;
  ballConf: number;
  /** Analysis rate ceiling, clamped server-side to 8..30. */
  analysisFps: number;
};

export type BbPerfConfig = {
  animTickHz: 60 | 30 | 15;
  hudPublishHz: 10 | 5 | 2;
  recordingPreset: "ultrafast" | "superfast" | "veryfast" | "fast" | "medium";
  recordingScale: 1 | 0.75 | 0.5;
};

export type BbConfig = {
  teams: Record<BbTeamId, BbTeamConfig>;
  /** Players per side (display only in v1). */
  teamSize: 1 | 2 | 3;
  /** First team to reach this wins (FIBA 3x3: 21). Clamped 1..99. */
  targetPoints: number;
  /** Regulation length; clamped server-side to 30 s..30 min. */
  durationMs: number;
  /** Overtime: first team to score this many points wins (FIBA 3x3: 2). */
  otWinPoints: number;
  /** Points the moderator's "beyond the arc" button applies. */
  arcPoints: 1 | 2;
  /** AI team attribution at or above this confidence is auto-confirmed;
   * below it the make lands in the moderator's pending queue. */
  autoAssignMinConf: number;
  /** Save make + release stills for the HUD / moderator queue. */
  shotFrames: boolean;
  /** How long the hoop cam stays featured after a make lands on air. */
  scoreLingerMs: number;
  /** Calibrated rim ellipse; null until the hoop phone calibrates. */
  rim: BbRim | null;
  detector: BbDetectorConfig;
  perf: BbPerfConfig;
};

/** Partial config as accepted by POST /room/:id/basketball-game/config. */
export type BbConfigPatch = {
  teams?: Partial<Record<BbTeamId, Partial<BbTeamConfig>>>;
  teamSize?: number;
  targetPoints?: number;
  durationMs?: number;
  otWinPoints?: number;
  arcPoints?: number;
  autoAssignMinConf?: number;
  shotFrames?: boolean;
  scoreLingerMs?: number;
  rim?: BbRim | null;
  detector?: Partial<BbDetectorConfig>;
  perf?: Partial<BbPerfConfig>;
  /** Phone join URLs per role — the server renders them as the lobby QRs. */
  joinUrls?: Partial<Record<"hoop" | "court" | "commentator", string>>;
  joinLabel?: string;
};

/** Ledger edit as accepted by POST /room/:id/basketball-game/shot. */
export type BbShotEdit = {
  op: "resolve" | "add" | "undo";
  shotId?: string;
  team?: BbTeamId | null;
  points?: 1 | 2;
  voided?: boolean;
};

/** Eight bib colours that stay apart on camera (streetball teams pick two). */
export const BB_TEAM_COLOR_PRESETS: { id: string; label: string; color: string }[] =
  [
    { id: "orange", label: "ORANGE", color: "#ff6a1f" },
    { id: "blue", label: "BLUE", color: "#1f7bff" },
    { id: "red", label: "RED", color: "#ff2e3d" },
    { id: "green", label: "GREEN", color: "#2ee06a" },
    { id: "yellow", label: "YELLOW", color: "#ffd21f" },
    { id: "purple", label: "PURPLE", color: "#a35bff" },
    { id: "white", label: "WHITE", color: "#f4efe6" },
    { id: "black", label: "BLACK", color: "#141416" },
  ];

export const BB_DEFAULT_CONFIG: BbConfig = {
  teams: {
    A: { name: "TEAM A", color: "#ff6a1f" },
    B: { name: "TEAM B", color: "#1f7bff" },
  },
  teamSize: 3,
  targetPoints: 21,
  durationMs: 600_000,
  otWinPoints: 2,
  arcPoints: 2,
  autoAssignMinConf: 0.6,
  shotFrames: true,
  scoreLingerMs: 2500,
  rim: null,
  detector: {
    ballDetector: "auto",
    yoloWeights: "auto",
    imgsz: 640,
    ballConf: 0.2,
    analysisFps: 20,
  },
  perf: {
    animTickHz: 60,
    hudPublishHz: 10,
    recordingPreset: "ultrafast",
    recordingScale: 1,
  },
};

export type BbShotStatus = "pending" | "confirmed" | "voided";

/**
 * One made basket in the ledger. Scores are derived from confirmed entries,
 * so every moderator correction (assign / void / 1↔2 / undo) is an edit here.
 */
export type BbShotEvent = {
  id: string;
  /** 1-based position in the ledger (stable across edits). */
  index: number;
  /** Server epoch ms when the make was ingested. */
  atMs: number;
  /** Worker frame time (seconds, pipeline clock) of the make, when from AI. */
  sourceT?: number;
  /**
   * Clip media time (ms) of the hoop file camera when the shot was ingested
   * (only when the hoop cam is a file). Replay/benchmark key — comparable to
   * ground-truth `tMs` of the same clip.
   */
  mediaMs?: number;
  team: BbTeamId | null;
  points: 1 | 2;
  /** The AI's own guess + confidence (kept after moderator edits). */
  aiTeam: BbTeamId | null;
  aiConfidence: number;
  /** Sampled jersey colour behind the guess (`#rrggbb`). */
  colorSample?: string | null;
  /** 'replay' = fired from a ground-truth events file (no model). */
  source: "ai" | "manual" | "replay";
  /** source === 'replay': the annotated value (1 free throw, 2, 3). */
  gtPoints?: 1 | 2 | 3;
  status: BbShotStatus;
  period: BbPeriod;
  /** Match clock at ingest (ms elapsed in regulation; OT counts up). */
  clockMs: number;
  /** Server-relative still URLs (`/bb-shot-frames/…`), when frames are on. */
  frameUrl?: string;
  releaseFrameUrl?: string;
};

/** A shot attempt the AI saw (made or missed) — FG% material (beta). */
export type BbAttempt = {
  index: number;
  atMs: number;
  team: BbTeamId | null;
  made: boolean;
};

export type BbTeamStats = {
  name: string;
  color: string;
  score: number;
  otScore: number;
  makes: number;
  /** Makes + AI-seen misses attributed to this team. */
  attempts: number;
  twos: number;
};

/**
 * Playhead of a file camera's clip, derived from the engine registration:
 * media time now = playFromMs + (now − anchor), modulo durationMs when looping.
 */
export type BbClipClock = {
  /** Media time (ms) the clip was last (re)started from. */
  playFromMs: number;
  /** Media time (ms) at snapshot time. */
  mediaMs: number;
  /** Clip length (ms), when probed. */
  durationMs: number | null;
  /** Side-channel delay (ms): frames air this long after the AI sees them. */
  delayMs: number;
};

/** Public camera slot info in `bb_state`. */
export type BbCam = {
  role: BbCamRole;
  /** Operator label (phone name); empty until someone joins. */
  name: string;
  /** Somebody holds the slot (a phone joined; may be disconnected). */
  joined: boolean;
  /** The phone's control socket is open. */
  connected: boolean;
  /** The WHIP input is publishing (receiving heartbeat acks). */
  camConnected: boolean;
  /** 'whip' = phone-published stream; 'file' = looping mp4 from data/mp4s. */
  source: 'whip' | 'file';
  /** source === 'file' only: path relative to data/mp4s. */
  fileName?: string;
  /** source === 'file' and connected: where the looping clip's playhead is. */
  clip?: BbClipClock;
  camWidth?: number;
  camHeight?: number;
  /** hoop only: a rim ellipse is calibrated. */
  calibrated: boolean;
  /** hoop only: the worker currently tracks a ball. */
  ballTracked?: boolean;
};

export type BbCommentator = {
  name: string;
  connected: boolean;
  camConnected: boolean;
};

/**
 * Broadcast scenes. lobby/live/score/ended derive from the match state;
 * hoop/court (one camera full-frame), caster (commentator full-frame) and
 * split (court + commentator) only come from the panel's view override.
 */
export type BbSceneName =
  | "lobby"
  | "live"
  | "score"
  | "hoop"
  | "court"
  | "caster"
  | "split"
  | "ended";

export type BbViewOverride =
  | { mode: "auto" }
  | { mode: "scene"; scene: "live" | "hoop" | "court" | "caster" | "split" };

export type BbMatchAction =
  | "lobby"
  | "start"
  | "pause"
  | "resume"
  | "end"
  | "start_overtime"
  | "reset"
  | "kick_cam"
  | "kick_commentator";

export const BB_MATCH_ACTIONS: readonly BbMatchAction[] = [
  "lobby",
  "start",
  "pause",
  "resume",
  "end",
  "start_overtime",
  "reset",
  "kick_cam",
  "kick_commentator",
];

// ── Client -> Server (room WS, `bb_` prefix) ─────────────────────────────────

/** Subscribe-only handshake (arcade page): snapshot reply, never a participant. */
export type BbSpectateMessage = { type: "bb_spectate" };

/**
 * A phone claims a camera role. `camKey` is the resume token from a previous
 * `bb_cam_joined`; it re-adopts the slot after a refresh even while the old
 * socket still looks open. A taken slot without the key → `role_taken`.
 */
export type BbCamJoinMessage = {
  type: "bb_cam_join";
  role: BbCamRole;
  name?: string;
  camKey?: string;
};
/** (Re)request a WHIP slot for the claimed role; server replies `bb_cam_offer`. */
export type BbCamRequestMessage = {
  type: "bb_cam_request";
  nativeWidth?: number;
  nativeHeight?: number;
};
export type BbCamStopMessage = { type: "bb_cam_stop" };
export type BbCamLeaveMessage = { type: "bb_cam_leave" };
/** Hoop phone: the rim ellipse drawn over the preview (normalized). */
export type BbRimCalibrateMessage = { type: "bb_rim_calibrate"; rim: BbRim };
/** Hoop phone or panel: a team colour sampled from the picture. */
export type BbTeamColorMessage = {
  type: "bb_team_color";
  team: BbTeamId;
  color: string;
};

// Commentator / moderator role (one slot per room; the panel joins here even
// without a camera to gain moderator rights).
export type BbCommentatorJoinMessage = {
  type: "bb_commentator_join";
  name: string;
  commentatorKey?: string;
};
export type BbCommentatorCamRequestMessage = {
  type: "bb_commentator_cam_request";
  nativeWidth?: number;
  nativeHeight?: number;
};
export type BbCommentatorLeaveMessage = { type: "bb_commentator_leave" };
export type BbCommentatorViewMessage = {
  type: "bb_commentator_view";
  override: BbViewOverride;
};
export type BbCommentatorMatchMessage = {
  type: "bb_commentator_match";
  action: BbMatchAction;
  role?: BbCamRole;
};
export type BbCommentatorCasterPipMessage = {
  type: "bb_commentator_caster_pip";
  enabled: boolean;
};

// Ledger edits (moderator). Ignored unless the sender is the joined
// commentator/moderator; the arcade host uses the REST mirror.
export type BbShotResolveMessage = {
  type: "bb_shot_resolve";
  shotId: string;
  team?: BbTeamId | null;
  points?: 1 | 2;
  voided?: boolean;
};
export type BbShotAddMessage = {
  type: "bb_shot_add";
  team: BbTeamId;
  points: 1 | 2;
};
/** Void the given shot, or the newest confirmed one when omitted. */
export type BbShotUndoMessage = { type: "bb_shot_undo"; shotId?: string };

export type BbClientMessage =
  | BbSpectateMessage
  | BbCamJoinMessage
  | BbCamRequestMessage
  | BbCamStopMessage
  | BbCamLeaveMessage
  | BbRimCalibrateMessage
  | BbTeamColorMessage
  | BbCommentatorJoinMessage
  | BbCommentatorCamRequestMessage
  | BbCommentatorLeaveMessage
  | BbCommentatorViewMessage
  | BbCommentatorMatchMessage
  | BbCommentatorCasterPipMessage
  | BbShotResolveMessage
  | BbShotAddMessage
  | BbShotUndoMessage;

// ── Server -> Client ─────────────────────────────────────────────────────────

/** Full snapshot. Broadcast on every roster / config / phase / ledger change. */
export type BbStateEvent = {
  type: "bb_state";
  roomId: string;
  phase: BbPhase;
  period: BbPeriod;
  config: BbConfig;
  teams: Record<BbTeamId, BbTeamStats>;
  cams: Record<BbCamRole, BbCam>;
  commentator: BbCommentator | null;
  scene: BbSceneName;
  viewOverride: BbViewOverride;
  casterPip: boolean;
  /** Makes awaiting a team (newest first). */
  pending: BbShotEvent[];
  /** Newest ledger entries (any status), newest first, capped. */
  recent: BbShotEvent[];
  /** Misses the AI attributed to nobody (FG% footnote). */
  unattributedMisses: number;
  leadChanges: number;
  winner: BbTeamId | null;
  isRecording?: boolean;
  /** Ground-truth replay loaded on the file cams (null when off). */
  replay: BbReplayState | null;
};

export type BbReplayBasket = "left" | "right" | "both";

/**
 * Replay from a ground-truth events file: makes/misses fire at their clip
 * media time (anchored to the file cams' playhead) instead of the model.
 */
export type BbReplayState = {
  /** Path relative to data/mp4s. */
  fileName: string;
  active: boolean;
  basket: BbReplayBasket;
  loop: boolean;
  /** Throws selected from the file (made + missed). */
  total: number;
  fired: number;
  /** Throws skipped (before START, or the playhead jumped past them). */
  skipped: number;
  /** Clip media time (ms) of the next throw, null when exhausted. */
  nextEventTMs: number | null;
  /** Wall ms until the next throw fires, null when parked (no file cam). */
  nextFireInMs: number | null;
  /** Which file cam drives the clock. */
  clockRole: BbCamRole | null;
};

export type BbReplayRequest = {
  action?: "load" | "off";
  fileName?: string;
  basket?: BbReplayBasket;
  loop?: boolean;
  /** Annotated → ledger points override (keys "1" | "2" | "3"). */
  pointsMap?: Partial<Record<"1" | "2" | "3", 1 | 2>>;
  /** Annotated team letter → ledger team. */
  teamMap?: Partial<Record<BbTeamId, BbTeamId>>;
};

/**
 * Reply to `bb_cam_join`, unicast (the camKey is a bearer secret). Carries
 * what the phone needs to resume: whether an input is still registered and
 * the rim calibration to redraw.
 */
export type BbCamJoinedEvent = {
  type: "bb_cam_joined";
  roomId: string;
  clientId: string;
  camKey: string;
  role: BbCamRole;
  name: string;
  camInputActive: boolean;
  rim: BbRim | null;
  phase: BbPhase;
};

/** Reply to `bb_commentator_join`, unicast. */
export type BbCommentatorJoinedEvent = {
  type: "bb_commentator_joined";
  roomId: string;
  clientId: string;
  commentatorKey: string;
  name: string;
  camInputActive: boolean;
  phase: BbPhase;
};

/** WHIP endpoint + credentials for a camera or the commentator. */
export type BbCamOfferEvent = {
  type: "bb_cam_offer";
  roomId: string;
  clientId: string;
  role: BbCamRole | "commentator";
  inputId: string;
  whipUrl: string;
  bearerToken: string;
};

/** Authoritative clock + score, at 1 Hz while the match runs and on every transition. */
export type BbMatchEvent = {
  type: "bb_match";
  roomId: string;
  phase: BbPhase;
  period: BbPeriod;
  /** Epoch ms regulation started (null in lobby). */
  startedAtMs: number | null;
  /** Regulation ms remaining (0 in overtime / ended). */
  remainingMs: number;
  /** Ms elapsed in the current period (OT counts up). */
  elapsedMs: number;
  scores: Record<BbTeamId, number>;
  otScores: Record<BbTeamId, number>;
  winner: BbTeamId | null;
};

/** Ledger change — the play-by-play feed. */
export type BbShotChangeEvent = {
  type: "bb_shot";
  roomId: string;
  kind:
    | "made"
    | "assigned"
    | "voided"
    | "manual"
    | "undone"
    /** A make seen outside a running match (lobby warm-up): calibration
     * feedback for the hoop phone, never in the ledger. */
    | "warmup";
  shot: BbShotEvent;
  scores: Record<BbTeamId, number>;
};

/** Hoop camera AI liveness for the phone's live HUD (debounced). */
export type BbBallEvent = {
  type: "bb_ball";
  roomId: string;
  tracked: boolean;
  zone: "above" | "rim" | "below" | "none";
  /** Worker detection source of the current ball box, for setup feedback. */
  source?: string | null;
};

export type BbLeadChangeEvent = {
  type: "bb_lead_change";
  roomId: string;
  team: BbTeamId;
  scores: Record<BbTeamId, number>;
};

export type BbErrorCode =
  | "not_joined"
  | "role_taken"
  | "not_commentator"
  | "invalid_view"
  | "invalid_rim"
  | "invalid_color"
  | "invalid_shot"
  | "unknown_shot"
  | "bad_action"
  | "no_live_camera";

export type BbErrorEvent = {
  type: "bb_error";
  roomId: string;
  code: BbErrorCode;
  /** English, display-ready. */
  message: string;
  context?: Record<string, string | number>;
};

export type BbServerEvent =
  | BbStateEvent
  | BbCamJoinedEvent
  | BbCommentatorJoinedEvent
  | BbCamOfferEvent
  | BbMatchEvent
  | BbShotChangeEvent
  | BbBallEvent
  | BbLeadChangeEvent
  | BbErrorEvent;
