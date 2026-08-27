// Kettlebell Tournament — a QR-joinable arcade game (like Duck Hunter) where
// each player's phone camera becomes a WHIP input with the kettlebell-coach
// model attached. The tournament controller consumes the coach's debounced
// `kettlebell_rep_completed` events and turns them into points, heats and a
// ranking. Events are designed as a feed for a future AI commentator too.

import type {
  KettlebellExercise,
  KettlebellIssueCode,
} from "./kettlebell-events.js";

/** Exercises that can score points (the coach's classes minus 'idle'). */
export type KbtExerciseKey = "swing" | "clean" | "snatch";

export const KBT_EXERCISE_KEYS: KbtExerciseKey[] = ["swing", "clean", "snatch"];

/** Signature color per exercise (matches the broadcast HUD's rep tracker). */
export const KBT_EXERCISE_COLORS: Record<KbtExerciseKey, string> = {
  swing: "#38E08A",
  clean: "#FFB800",
  snatch: "#FF5A1F",
};

/** Scoring rule for one exercise. Disabled reps still count, but score 0. */
export type KbtScoringRule = { enabled: boolean; points: number };

/** Which way competitors stand relative to their phone camera. Side-on
 * enables the full technique judge; facing keeps only height checks. */
export type KbtCameraView = "front" | "side";

/**
 * Performance knobs for experimenting with output smoothness under AI load.
 * analysisFpsOverride / animTickHz / hudPublishHz apply live (mid-heat);
 * recordingPreset / recordingScale apply from the next recording start.
 */
export type KbtPerfConfig = {
  /** Coach analysis rate override; null = auto by heat size (14/12/10).
   * Clamped server-side to 8..16. */
  analysisFpsOverride: number | null;
  /** Overlay animation tick rate (skeleton rig, rep floats, shake). Scene
   * pushes are throttled to ~33 Hz by the engine SDK, so 60 mostly buys
   * smoother easing math, not smoother output. */
  animTickHz: 60 | 30 | 15;
  /** Periodic HUD publish rate during heats (reps and scene flips always
   * publish immediately). */
  hudPublishHz: 10 | 5 | 2;
  /** x264 preset for the MP4 recording output. Slower presets look better
   * but risk falling behind real-time next to the live encode + AI. */
  recordingPreset: "ultrafast" | "superfast" | "veryfast" | "fast" | "medium";
  /** MP4 recording resolution as a fraction of the room resolution. */
  recordingScale: 1 | 0.75 | 0.5;
};

export type KbtConfig = {
  scoring: Record<KbtExerciseKey, KbtScoringRule>;
  /** When true, reps judged 'incorrect' score floor(points / 2). */
  strictTechnique: boolean;
  /** AMRAP heat length, clamped server-side to 30s..10min. */
  heatDurationMs: number;
  /** Players per heat, clamped server-side to 2..4. */
  heatSize: number;
  cameraView: KbtCameraView;
  /** When true, the coach saves a still of each counted rep at its apex. */
  repScreenshots: boolean;
  /** When true, every 5th rep of an exercise fires an on-air celebration
   * (aura in the exercise's color + tile shake). */
  milestoneFx: boolean;
  /** When true, every scored rep floats game-style text up the tile
   * ("SNATCH +3"; incorrect reps show "SNATCH*", or a struck-out name when
   * countIncorrectReps is off). */
  repFloatText: boolean;
  /** When false, reps judged 'incorrect' add no reps and no points (they
   * still reset the streak and show struck-out on air). */
  countIncorrectReps: boolean;
  perf: KbtPerfConfig;
};

/** Defaults: harder lifts pay more; technique is forgiving (easy to play). */
export const KBT_DEFAULT_CONFIG: KbtConfig = {
  scoring: {
    swing: { enabled: true, points: 1 },
    clean: { enabled: true, points: 2 },
    snatch: { enabled: true, points: 3 },
  },
  strictTechnique: false,
  heatDurationMs: 60_000,
  heatSize: 2,
  cameraView: "front",
  repScreenshots: false,
  milestoneFx: true,
  repFloatText: true,
  countIncorrectReps: true,
  perf: {
    analysisFpsOverride: null,
    animTickHz: 60,
    hudPublishHz: 10,
    recordingPreset: "ultrafast",
    recordingScale: 1,
  },
};

/**
 * Tournament flow: 'roster' = registration open (QR screen); 'heats' =
 * qualification heats run one at a time; 'final' = top players re-run;
 * 'podium' = done. Standings between heats are a host-page screen, not a
 * server phase — the server just reports scores.
 */
export type KbtTournamentPhase = "roster" | "heats" | "final" | "podium";

/** Host commands for the tournament match endpoint. */
export type KbtMatchAction =
  | "roster"
  | "assign_heats"
  | "start_heat"
  | "begin_heat"
  | "stop_heat"
  | "next_heat"
  | "start_final"
  | "podium"
  | "reset"
  // Recovery controls: drop a stuck participant, re-run a heat that never
  // finished, or start despite a dead phone (host's explicit call).
  | "kick_player"
  | "restart_heat"
  | "force_begin";

/**
 * One heat's lifecycle: 'idle' = scheduled, not started; 'intro' = players on
 * the stage grid, AI warming up, pose checks; then the AMRAP round proper.
 */
export type KbtHeatPhase = "idle" | "intro" | "countdown" | "playing" | "ended";

/**
 * Broadcast scene names. lobby/solo/grid/board/podium are derived from the
 * tournament phase; 'caster' (fullscreen commentator) and 'split'
 * (commentator + featured lifter) only ever come from a view override.
 */
export type KbtSceneName =
  | "lobby"
  | "solo"
  | "grid"
  | "board"
  | "podium"
  | "caster"
  | "split";

/**
 * Commentator panel view control. 'auto' returns the broadcast to the derived
 * scene; the rest force a scene until cleared — by 'auto', by any match
 * action, or by the referenced participant leaving.
 */
export type KbtViewOverride =
  | { mode: "auto" }
  | { mode: "caster" }
  | { mode: "player_solo"; playerId: string }
  | { mode: "split"; playerId: string }
  | { mode: "grid" }
  | { mode: "board" };

/** Skeleton overlay draw mode on heat tiles (mirrors the coach model param). */
export type KbtSkeletonMode = "off" | "lines" | "neon";

export type KbtHypeBannerId =
  | "new_leader"
  | "final_30"
  | "last_10"
  | "photo_finish"
  | "record_pace"
  | "make_noise";

/**
 * Predefined on-air hype banners: the server renders text/color, the panel
 * renders one button per entry. Predefined-only — no free text on air.
 */
export const KBT_HYPE_BANNERS: Record<
  KbtHypeBannerId,
  { text: string; color: string }
> = {
  new_leader: { text: "NEW LEADER!", color: "#FF5A1F" },
  final_30: { text: "FINAL 30 SECONDS", color: "#FFB800" },
  last_10: { text: "LAST 10 — EMPTY THE TANK!", color: "#FF4030" },
  photo_finish: { text: "PHOTO FINISH!", color: "#FF5A1F" },
  record_pace: { text: "RECORD PACE", color: "#38E08A" },
  make_noise: { text: "MAKE SOME NOISE!", color: "#E8E4DA" },
};

/**
 * Commentator-driven output overlay — a single exclusive slot on the program
 * output. Replaced on every send; cleared by `{ kind: 'none' }`, by any match
 * action, or by the referenced player leaving.
 */
export type KbtCommentatorOverlay =
  | {
      kind: "rep_shot";
      playerId: string;
      /** 0-based position in the player's shot list (server clamps). */
      index: number;
      /** Show the AI verdict + technique issues on the output. */
      showVerdict: boolean;
    }
  | { kind: "spotlight"; playerId: string }
  | { kind: "h2h"; playerIdA: string; playerIdB: string }
  | { kind: "none" };

export type KbtPlayer = {
  clientId: string;
  name: string;
  /** Hex color for this player's tile chrome + scoreboard rows. */
  color: string;
  /**
   * The player's control WebSocket is currently open. Absent on older
   * servers — treat as true.
   */
  connected?: boolean;
  /** The phone published its camera and the WHIP input is receiving acks. */
  camConnected: boolean;
  /** The coach currently sees a pose on this player's input (intro checks). */
  poseTracked: boolean;
  /** The phone advanced to the briefing screen (begin_heat is gated on it). */
  briefed: boolean;
  /** Best qualification-heat score (the ranking key). */
  bestScore: number;
  /** Final-heat score; null until the player plays a final. */
  finalScore: number | null;
  /** Qualification heat this player is assigned to, if heats were drawn. */
  heatIndex: number | null;
  /**
   * Server-relative profile photo path (`/kbt-photos/…`), content-hashed so
   * the URL changes whenever the photo does. Absent on older servers.
   */
  photoUrl?: string | null;
  /**
   * Apex stills from this player's best qualification heat (or the final).
   * Only present when rep screenshots were enabled during that heat.
   */
  repShots?: KbtRepShot[];
};

/** One saved apex still of a counted rep. */
export type KbtRepShot = {
  repIndex: number;
  /** Server-relative URL (`/kbt-rep-frames/…`). */
  url: string;
  exercise: KbtExerciseKey;
  verdict: "correct" | "incorrect";
  points: number;
  /** Technique faults the judge saw on this rep (absent on older servers). */
  issues?: KettlebellIssueCode[];
};

/** Per-player score sheet within one heat. */
export type KbtScoreBreakdown = {
  points: number;
  reps: Record<KbtExerciseKey, number>;
  incorrectReps: number;
  bestStreak: number;
  /** Snapshot so rows survive a player disconnecting mid-tournament. */
  name: string;
  color: string;
  photoUrl?: string | null;
  /** Apex stills of this heat's counted reps, when rep screenshots are on. */
  repShots?: KbtRepShot[];
};

export type KbtHeatSummary = {
  index: number;
  final: boolean;
  phase: KbtHeatPhase;
  playerIds: string[];
  scores: Record<string, KbtScoreBreakdown>;
};

// ── Client -> Server (room WS, `kbt_` prefix) ────────────────────────────────

/**
 * `playerKey` is the resume token from a previous `kbt_joined` reply. When it
 * matches an existing player the join adopts that entry — even one whose old
 * socket still looks open (a fast refresh beats the stale socket's close) —
 * so scores and the heat slot follow the phone across refreshes.
 */
export type KbtJoinMessage = { type: "kbt_join"; name: string; playerKey?: string };
/**
 * (Re)request a camera slot: the server registers a fresh WHIP input for this
 * client (retiring any previous one) and replies with `kbt_cam_offer`.
 * The real track dimensions (from getSettings()) let the server register the
 * input with its true aspect — without them a portrait stream lands in a
 * landscape content box and gets cover-cropped top/bottom on the output.
 */
export type KbtCamRequestMessage = {
  type: "kbt_cam_request";
  nativeWidth?: number;
  nativeHeight?: number;
};
export type KbtCamStopMessage = { type: "kbt_cam_stop" };
/**
 * The phone reached the briefing/standing-by step ("TO THE BRIEFING").
 * One-shot: the server clears it on disconnect, kbt_cam_stop and kbt_leave;
 * the lift page re-sends it after a reconnect re-join. Gates begin_heat.
 */
export type KbtBriefedMessage = { type: "kbt_briefed" };
export type KbtLeaveMessage = { type: "kbt_leave" };
/** Subscribe-only handshake (host page): snapshot reply, never a player. */
export type KbtSpectateMessage = { type: "kbt_spectate" };

// ── Commentator role (joins via its own QR, /mobile/[roomId]/commentate) ─────
// One commentator per room: audio+video WHIP input mixed into the broadcast,
// shown as a lower-third between heats and audio-only during them. Never a
// player: no heats, no scoring, no coach AI on the input.

export type KbtCommentatorJoinMessage = {
  type: "kbt_commentator_join";
  name: string;
  /** Resume token, same contract as on `kbt_join`. */
  playerKey?: string;
};
/** Same offer flow as players: server replies with `kbt_cam_offer`. */
export type KbtCommentatorCamRequestMessage = {
  type: "kbt_commentator_cam_request";
  nativeWidth?: number;
  nativeHeight?: number;
};
export type KbtCommentatorLeaveMessage = { type: "kbt_commentator_leave" };
/**
 * Force/release the broadcast view (commentator panel). Ignored unless the
 * sender is the joined commentator.
 */
export type KbtCommentatorViewMessage = {
  type: "kbt_commentator_view";
  override: KbtViewOverride;
};
/**
 * Tournament flow control over the WS — same vocabulary as the host's REST
 * match endpoint. Ignored unless the sender is the joined commentator.
 */
export type KbtCommentatorMatchMessage = {
  type: "kbt_commentator_match";
  action: KbtMatchAction;
  heatIndex?: number;
};
/**
 * Set/replace/clear the commentator's output overlay (rep cam, spotlight,
 * head-to-head). Ignored unless the sender is the joined commentator.
 */
export type KbtCommentatorOverlayMessage = {
  type: "kbt_commentator_overlay";
  overlay: KbtCommentatorOverlay;
};
/** Fire a one-shot predefined hype banner on the program output. */
export type KbtCommentatorBannerMessage = {
  type: "kbt_commentator_banner";
  bannerId: KbtHypeBannerId;
};
/** Live-switch the skeleton overlay on all heat tiles. */
export type KbtCommentatorSkeletonMessage = {
  type: "kbt_commentator_skeleton";
  mode: KbtSkeletonMode;
};
/** Live-switch the floating rep text (config.repFloatText) mid-heat. */
export type KbtCommentatorRepFloatMessage = {
  type: "kbt_commentator_rep_float";
  enabled: boolean;
};
/** Toggle the commentator's picture-in-picture cam tile on the output. */
export type KbtCommentatorCasterPipMessage = {
  type: "kbt_commentator_caster_pip";
  enabled: boolean;
};

export type KbtClientMessage =
  | KbtJoinMessage
  | KbtCamRequestMessage
  | KbtCamStopMessage
  | KbtBriefedMessage
  | KbtLeaveMessage
  | KbtSpectateMessage
  | KbtCommentatorJoinMessage
  | KbtCommentatorCamRequestMessage
  | KbtCommentatorLeaveMessage
  | KbtCommentatorViewMessage
  | KbtCommentatorMatchMessage
  | KbtCommentatorOverlayMessage
  | KbtCommentatorBannerMessage
  | KbtCommentatorSkeletonMessage
  | KbtCommentatorRepFloatMessage
  | KbtCommentatorCasterPipMessage;

/** Public commentator info in `kbt_state`. */
export type KbtCommentator = {
  name: string;
  /** The commentator's WHIP input is publishing (receiving acks). */
  camConnected: boolean;
};

// ── Server -> Client ─────────────────────────────────────────────────────────

/** Full tournament snapshot. Broadcast on every roster/config/phase change. */
export type KbtStateEvent = {
  type: "kbt_state";
  roomId: string;
  tournamentPhase: KbtTournamentPhase;
  config: KbtConfig;
  players: KbtPlayer[];
  heats: KbtHeatSummary[];
  currentHeatIndex: number | null;
  /** Present when a commentator joined (absent on older servers). */
  commentator?: KbtCommentator | null;
  /** Current broadcast scene (absent on older servers). */
  scene?: KbtSceneName;
  /** Active view override; { mode: 'auto' } when none (absent on older servers). */
  viewOverride?: KbtViewOverride;
  /** Commentator output overlay; { kind: 'none' } when off (absent on older servers). */
  commentatorOverlay?: KbtCommentatorOverlay;
  /** Skeleton mode on heat tiles (absent on older servers — treat as 'neon'). */
  skeletonMode?: KbtSkeletonMode;
  /** Commentator cam PiP visible outside full-frame caster scenes (absent on
   * older servers — treat as true). */
  casterPip?: boolean;
  /** An MP4 recording of the program output is running (absent on older servers). */
  isRecording?: boolean;
};

/**
 * Reply to `kbt_join` / `kbt_commentator_join`, sent only to the joiner (the
 * playerKey is a bearer secret — never broadcast). Gives the phone its
 * authoritative clientId plus everything it needs to resume after a refresh:
 * jump straight back to the right wizard step, re-arm the camera, re-brief.
 */
export type KbtJoinedEvent = {
  type: "kbt_joined";
  roomId: string;
  clientId: string;
  /** Resume token — store it, send it with the next `kbt_join`. */
  playerKey: string;
  name: string;
  role: "player" | "commentator";
  briefed: boolean;
  /** The server still holds a WHIP input registered for this participant. */
  camInputActive: boolean;
  photoUrl: string | null;
  heatIndex: number | null;
  /** This participant is in the currently selected heat. */
  inCurrentHeat: boolean;
  tournamentPhase: KbtTournamentPhase;
  /** Phase of the current heat; 'idle' when no heat is active. */
  heatPhase: KbtHeatPhase;
};

export type KbtErrorCode =
  | "not_joined"
  | "not_ready"
  | "heat_not_idle"
  | "heat_not_intro"
  | "too_few_finalists"
  | "not_commentator"
  | "invalid_view"
  | "invalid_overlay"
  | "unknown_player"
  | "no_live_camera"
  | "bad_action";

/**
 * A rejected request, sent only to the acting client. Every silent no-op the
 * controller used to have now emits one of these so phones and the host page
 * can say what happened instead of appearing frozen.
 */
export type KbtErrorEvent = {
  type: "kbt_error";
  roomId: string;
  code: KbtErrorCode;
  /** English, display-ready. */
  message: string;
  context?: Record<string, string | number>;
};

/**
 * Reply to `kbt_cam_request`: WHIP endpoint + credentials for the phone to
 * publish its camera. The input is registered through InputManager so it has
 * a video side channel — the kettlebell-coach AI attaches to it during heats.
 */
export type KbtCamOfferEvent = {
  type: "kbt_cam_offer";
  roomId: string;
  clientId: string;
  inputId: string;
  whipUrl: string;
  bearerToken: string;
};

/**
 * Active heat lifecycle + clock. Broadcast on every phase transition and at
 * 1 Hz while a heat is live so pages/phones render an authoritative countdown.
 */
export type KbtMatchEvent = {
  type: "kbt_match";
  roomId: string;
  heatIndex: number | null;
  final: boolean;
  phase: KbtHeatPhase;
  /** Epoch ms when 'playing' begins (countdown end). */
  startsAtMs?: number;
  /** Epoch ms AMRAP deadline. */
  endsAtMs?: number;
  /** Server-computed remaining ms (clients interpolate between ticks). */
  remainingMs?: number;
  scores: Record<string, KbtScoreBreakdown>;
  /** 'ended' only; null = draw. */
  winner?: {
    clientId: string;
    name: string;
    color: string;
    points: number;
  } | null;
};

/** One scored rep — the play-by-play feed (phones flash on it; commentator food). */
export type KbtRepEvent = {
  type: "kbt_rep";
  roomId: string;
  clientId: string;
  name: string;
  exercise: KettlebellExercise;
  /** Points awarded for this rep (0 when the exercise is disabled). */
  points: number;
  totalPoints: number;
  verdict: "correct" | "incorrect";
  issues: KettlebellIssueCode[];
  repIndex: number;
  /** Consecutive correct reps after this one (0 on an incorrect rep). */
  streak: number;
  /** Apex still of this rep (`/kbt-rep-frames/…`), when screenshots are on. */
  screenshotUrl?: string;
};

/** Live pose visibility for the player's own intro framing check. */
export type KbtPoseEvent = {
  type: "kbt_pose";
  roomId: string;
  clientId: string;
  tracked: boolean;
  /**
   * Head + an ankle are in frame (rep counting survives worse via fallbacks,
   * but the athlete should back up). Absent on older servers — treat as true.
   */
  fullBody?: boolean;
};

export type KbtLeadChangeEvent = {
  type: "kbt_lead_change";
  roomId: string;
  clientId: string;
  name: string;
  points: number;
};

/** Milestone of consecutive correct reps (fires at 5, 10, 15, …). */
export type KbtStreakEvent = {
  type: "kbt_streak";
  roomId: string;
  clientId: string;
  name: string;
  count: number;
};

export type KbtServerEvent =
  | KbtStateEvent
  | KbtJoinedEvent
  | KbtErrorEvent
  | KbtCamOfferEvent
  | KbtMatchEvent
  | KbtRepEvent
  | KbtPoseEvent
  | KbtLeadChangeEvent
  | KbtStreakEvent;
