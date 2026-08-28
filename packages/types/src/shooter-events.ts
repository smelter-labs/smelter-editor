// Ghost Shooter — a Duck-Hunt-style game where phones (gyroscope) aim a
// crosshair at the Pac-Man ghosts on the Smelter output and tap to shoot.

export type ShooterPlayer = {
  clientId: string;
  name: string;
  /** Hex color assigned to this player's crosshair + scoreboard row. */
  color: string;
  /** Hunter character picked on the phone (see SHOOTER_CHARACTERS). */
  characterId?: string;
  score: number;
  /**
   * The player's control socket is connected. A dropped phone stays on the
   * roster (grayed out) through the disconnect grace so its score survives a
   * reconnect; absent = true (older servers).
   */
  connected?: boolean;
  /** The player's camera WHIP publish is heartbeat-live (not just registered). */
  camLive?: boolean;
};

/**
 * Room-wide ammo rules, set by the operator in the Duck Hunter panel (pushed
 * over REST, not per-player from the phone).
 */
export type ShooterAmmoConfig = { maxAmmo?: number; reloadMs?: number };

/**
 * The playable hunter characters. Each phone picks one for its player
 * (duplicates allowed — the assigned crosshair color still separates
 * players). The server validates ids against this list; the editor keeps
 * the per-character clip/accent presentation mapping locally.
 */
export const SHOOTER_CHARACTERS = [
  {
    id: "improwizator",
    name: "IMPROWIZATOR",
    title: "DIY Ranger",
    color: "#4fc3f7",
  },
  {
    id: "crane-hunter",
    name: "CRANE HUNTER",
    title: "Kimono Blaster",
    color: "#ff9210",
  },
  {
    id: "pink-spotter",
    name: "PINK SPOTTER",
    title: "Visor Scout",
    color: "#FF4081",
  },
] as const;

export type ShooterCharacterId = (typeof SHOOTER_CHARACTERS)[number]["id"];

export const SHOOTER_CHARACTER_IDS: readonly ShooterCharacterId[] =
  SHOOTER_CHARACTERS.map((c) => c.id);

// Client -> Server
export type ShooterJoinMessage = {
  type: "shoot_join";
  name: string;
  /**
   * Resume token from a previous `shooter_joined` (persisted on the phone).
   * Lets a reconnecting/refreshing phone adopt its old player entry — score,
   * color and camera included — instead of forking a fresh one.
   */
  playerKey?: string;
  /** Hunter character picked on the phone (invalid ids are ignored). */
  characterId?: string;
};
/** Change the player's hunter character after joining (e.g. in the lobby). */
export type ShooterCharacterMessage = {
  type: "shoot_character";
  characterId: string;
};
/** Aim position in normalized content space [0,1] (0,0 = top-left). */
export type ShooterAimMessage = { type: "shoot_aim"; x: number; y: number };
export type ShooterFireMessage = { type: "shoot_fire" };
export type ShooterLeaveMessage = { type: "shoot_leave" };
/**
 * Turn the player's live front camera on: the server registers a dedicated
 * WHIP input for this client and replies with `shooter_cam_offer` so the phone
 * can publish its camera into the broadcast (shown live next to the name).
 */
export type ShooterCamStartMessage = {
  type: "shoot_cam_start";
  /**
   * Real dimensions of the camera track (`getSettings()`), so the server can
   * register the WHIP input with the exact portrait/landscape geometry instead
   * of guessing from orientation.
   */
  nativeWidth?: number;
  nativeHeight?: number;
};
/** Turn the live camera off; the server tears down the WHIP input. */
export type ShooterCamStopMessage = { type: "shoot_cam_stop" };

/**
 * Subscribe-only handshake used by the /duck-hunter arcade page: the server
 * replies with a `shooter_state` + `shooter_match` snapshot to this client
 * without creating a player. Broadcast updates then arrive like for players.
 */
export type ShooterSpectateMessage = { type: "shoot_spectate" };

export type ShooterClientMessage =
  | ShooterJoinMessage
  | ShooterCharacterMessage
  | ShooterAimMessage
  | ShooterFireMessage
  | ShooterLeaveMessage
  | ShooterCamStartMessage
  | ShooterCamStopMessage
  | ShooterSpectateMessage;

// Match (arcade page) — server-authoritative rounds on top of free-play.
export type ShooterMatchMode = "time" | "points";
/**
 * 'idle' = free-play (dashboard open range, shots always score);
 * 'lobby' = the arcade host is prepping a round (attract mode runs, phones
 * should hold on the briefing screen until 'countdown').
 */
export type ShooterMatchPhase =
  | "idle"
  | "lobby"
  | "countdown"
  | "playing"
  | "ended";

/**
 * One row of the global arcade TOP SCORES table. Recorded server-side by the
 * idempotent match end (never by clients), persisted across rooms/restarts.
 */
export type ShooterTopScoreEntry = {
  /** 3-char arcade initials (derived from the player name by default). */
  initials: string;
  name: string;
  characterId?: string;
  score: number;
  mode: ShooterMatchMode;
  at: number;
};

export type ShooterMatchConfig = {
  mode: ShooterMatchMode;
  /** Time mode round length, clamped server-side to 10s..10min. */
  durationMs?: number;
  /** Points mode target, clamped server-side to 1..200. */
  targetScore?: number;
};

// Server -> Client

/**
 * Private ack for `shoot_join`: the authoritative identity of this phone's
 * player. `playerKey` is the resume token the phone persists (localStorage)
 * and replays on every reconnect; `clientId` is socket-scoped and changes on
 * every reconnect, so the phone must overwrite its cached copy with this one.
 */
export type ShooterJoinedEvent = {
  type: "shooter_joined";
  roomId: string;
  clientId: string;
  playerKey: string;
  name: string;
  color: string;
  /** Hunter character on the (possibly adopted) entry, if one was picked. */
  characterId?: string;
  /** Restored score (nonzero when this join adopted an existing entry). */
  score: number;
  /** An earlier camera session is still registered for this player. */
  camInputActive: boolean;
};

/** Why a shooter request was refused (typed, so phones can show real copy). */
export type ShooterErrorCode = "room_full" | "not_joined" | "camera_failed";

export type ShooterErrorEvent = {
  type: "shooter_error";
  roomId: string;
  code: ShooterErrorCode;
  message: string;
};

export type ShooterStateEvent = {
  type: "shooter_state";
  roomId: string;
  players: ShooterPlayer[];
  /** Whether a ghost-enabled input is currently available to shoot at. */
  targetActive: boolean;
};

export type ShooterHitEvent = {
  type: "shooter_hit";
  roomId: string;
  clientId: string;
  ghostId: number;
  score: number;
};

export type ShooterMissEvent = {
  type: "shooter_miss";
  roomId: string;
  clientId: string;
};

/** Fire attempt with an empty magazine — no shot, just a click. */
export type ShooterEmptyEvent = {
  type: "shooter_empty";
  roomId: string;
  clientId: string;
};

/** Current ammo state for one player (magazine + reload progress). */
export type ShooterAmmoEvent = {
  type: "shooter_ammo";
  roomId: string;
  clientId: string;
  ammo: number;
  maxAmmo: number;
  reloadMs: number;
  /** Ms until the next round regenerates (0 when the magazine is full). */
  reloadRemainingMs: number;
};

/**
 * Reply to `shoot_cam_start`: the WHIP endpoint + credentials the phone uses to
 * publish its live front camera. The server has already registered `inputId` as
 * a Smelter whip_server input, composited only inside the player's avatar circle.
 */
export type ShooterCamOfferEvent = {
  type: "shooter_cam_offer";
  roomId: string;
  clientId: string;
  inputId: string;
  whipUrl: string;
  bearerToken: string;
};

/**
 * Match lifecycle + clock. Broadcast on every phase transition and at 1 Hz
 * while a match is live so pages/phones can render an authoritative countdown.
 */
export type ShooterMatchEvent = {
  type: "shooter_match";
  roomId: string;
  phase: ShooterMatchPhase;
  mode?: ShooterMatchMode;
  targetScore?: number;
  /** Epoch ms when 'playing' begins (countdown end). */
  startsAtMs?: number;
  /** Time mode: epoch ms deadline. */
  endsAtMs?: number;
  /** Server-computed remaining ms (clients interpolate between ticks). */
  remainingMs?: number;
  /** 'ended' only; null = draw. */
  winner?: ShooterPlayer | null;
  /** 'ended' only: scoreboard frozen at the final whistle. */
  finalScores?: ShooterPlayer[];
  /** 'ended' only: the global TOP SCORES table for this match's mode. */
  topScores?: ShooterTopScoreEntry[];
  /** 'ended' only: 1-based rank the winner took in it; null = off the table. */
  topScoreRank?: number | null;
};

export type ShooterServerEvent =
  | ShooterJoinedEvent
  | ShooterErrorEvent
  | ShooterStateEvent
  | ShooterHitEvent
  | ShooterMissEvent
  | ShooterEmptyEvent
  | ShooterAmmoEvent
  | ShooterCamOfferEvent
  | ShooterMatchEvent;
