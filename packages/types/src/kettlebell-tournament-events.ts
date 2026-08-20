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

/** Scoring rule for one exercise. Disabled reps still count, but score 0. */
export type KbtScoringRule = { enabled: boolean; points: number };

export type KbtConfig = {
  scoring: Record<KbtExerciseKey, KbtScoringRule>;
  /** When true, reps judged 'incorrect' score floor(points / 2). */
  strictTechnique: boolean;
  /** AMRAP heat length, clamped server-side to 30s..10min. */
  heatDurationMs: number;
  /** Players per heat, clamped server-side to 2..4. */
  heatSize: number;
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
  | "reset";

/**
 * One heat's lifecycle: 'idle' = scheduled, not started; 'intro' = players on
 * the stage grid, AI warming up, pose checks; then the AMRAP round proper.
 */
export type KbtHeatPhase = "idle" | "intro" | "countdown" | "playing" | "ended";

export type KbtPlayer = {
  clientId: string;
  name: string;
  /** Hex color for this player's tile chrome + scoreboard rows. */
  color: string;
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
};

export type KbtHeatSummary = {
  index: number;
  final: boolean;
  phase: KbtHeatPhase;
  playerIds: string[];
  scores: Record<string, KbtScoreBreakdown>;
};

// ── Client -> Server (room WS, `kbt_` prefix) ────────────────────────────────

export type KbtJoinMessage = { type: "kbt_join"; name: string };
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
};
/** Same offer flow as players: server replies with `kbt_cam_offer`. */
export type KbtCommentatorCamRequestMessage = {
  type: "kbt_commentator_cam_request";
  nativeWidth?: number;
  nativeHeight?: number;
};
export type KbtCommentatorLeaveMessage = { type: "kbt_commentator_leave" };

export type KbtClientMessage =
  | KbtJoinMessage
  | KbtCamRequestMessage
  | KbtCamStopMessage
  | KbtBriefedMessage
  | KbtLeaveMessage
  | KbtSpectateMessage
  | KbtCommentatorJoinMessage
  | KbtCommentatorCamRequestMessage
  | KbtCommentatorLeaveMessage;

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
  | KbtCamOfferEvent
  | KbtMatchEvent
  | KbtRepEvent
  | KbtPoseEvent
  | KbtLeadChangeEvent
  | KbtStreakEvent;
