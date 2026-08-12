// Ghost Shooter — a Duck-Hunt-style game where phones (gyroscope) aim a
// crosshair at the Pac-Man ghosts on the Smelter output and tap to shoot.

export type ShooterPlayer = {
  clientId: string;
  name: string;
  /** Hex color assigned to this player's crosshair + scoreboard row. */
  color: string;
  score: number;
};

/**
 * Room-wide ammo rules, set by the operator in the Duck Hunter panel (pushed
 * over REST, not per-player from the phone).
 */
export type ShooterAmmoConfig = { maxAmmo?: number; reloadMs?: number };

// Client -> Server
export type ShooterJoinMessage = {
  type: "shoot_join";
  name: string;
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
export type ShooterCamStartMessage = { type: "shoot_cam_start" };
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
  | ShooterAimMessage
  | ShooterFireMessage
  | ShooterLeaveMessage
  | ShooterCamStartMessage
  | ShooterCamStopMessage
  | ShooterSpectateMessage;

// Match (arcade page) — server-authoritative rounds on top of free-play.
export type ShooterMatchMode = "time" | "points";
export type ShooterMatchPhase = "idle" | "countdown" | "playing" | "ended";

/** Host identity chosen on the arcade character-select screen. */
export type ShooterHostCharacter = { id: string; name: string; color: string };

export type ShooterMatchConfig = {
  mode: ShooterMatchMode;
  /** Time mode round length, clamped server-side to 10s..10min. */
  durationMs?: number;
  /** Points mode target, clamped server-side to 1..200. */
  targetScore?: number;
  character?: ShooterHostCharacter;
};

// Server -> Client
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
  character?: ShooterHostCharacter;
  /** 'ended' only; null = draw. */
  winner?: ShooterPlayer | null;
  /** 'ended' only: scoreboard frozen at the final whistle. */
  finalScores?: ShooterPlayer[];
};

export type ShooterServerEvent =
  | ShooterStateEvent
  | ShooterHitEvent
  | ShooterMissEvent
  | ShooterEmptyEvent
  | ShooterAmmoEvent
  | ShooterCamOfferEvent
  | ShooterMatchEvent;
