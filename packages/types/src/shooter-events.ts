// Ghost Shooter — a Duck-Hunt-style game where phones (gyroscope) aim a
// crosshair at the Pac-Man ghosts on the Smelter output and tap to shoot.

export type ShooterPlayer = {
  clientId: string;
  name: string;
  /** Hex color assigned to this player's crosshair + scoreboard row. */
  color: string;
  score: number;
};

// Client -> Server
export type ShooterJoinMessage = { type: "shoot_join"; name: string };
/** Aim position in normalized content space [0,1] (0,0 = top-left). */
export type ShooterAimMessage = { type: "shoot_aim"; x: number; y: number };
export type ShooterFireMessage = { type: "shoot_fire" };
export type ShooterLeaveMessage = { type: "shoot_leave" };

export type ShooterClientMessage =
  | ShooterJoinMessage
  | ShooterAimMessage
  | ShooterFireMessage
  | ShooterLeaveMessage;

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

export type ShooterServerEvent =
  | ShooterStateEvent
  | ShooterHitEvent
  | ShooterMissEvent;
