export type PongSide = "left" | "right";

export type PongGamePhase =
  | "idle"
  | "countdown"
  | "playing"
  | "pointScored"
  | "matchOver";

export type PongBounceKind = "wall" | "paddle";

export type PongBounceEvent = {
  time: number;
  x: number;
  y: number;
  kind: PongBounceKind;
};

export type PongBall = {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

export type PongNetGameState = {
  ball: PongBall;
  paddles: { left: { y: number }; right: { y: number } };
  score: { left: number; right: number };
  phase: PongGamePhase;
  phaseTime: number;
  now: number;
  servingSide: PongSide;
  lastWinner: PongSide | null;
  lastBounce: PongBounceEvent | null;
};

export type PongLobbyPlayer = {
  clientId: string;
  side: PongSide;
  ready: boolean;
  name: string | null;
};

export type PongLobbyState = {
  players: PongLobbyPlayer[];
  hostClientId: string | null;
  gameStarted: boolean;
};

// Client -> Server
export type PongJoinMessage = { type: "pong_join"; side: PongSide };
export type PongReadyMessage = { type: "pong_ready" };
export type PongLeaveMessage = { type: "pong_leave" };
export type PongPaddleInputMessage = { type: "pong_paddle_input"; y: number };
export type PongGameStateMessage = {
  type: "pong_game_state";
  state: PongNetGameState;
};
export type PongResetMessage = { type: "pong_reset" };

export type PongClientMessage =
  | PongJoinMessage
  | PongReadyMessage
  | PongLeaveMessage
  | PongPaddleInputMessage
  | PongGameStateMessage
  | PongResetMessage;

// Server -> Client
export type PongLobbyUpdatedEvent = {
  type: "pong_lobby_updated";
  roomId: string;
  lobby: PongLobbyState;
};

export type PongGameStartedEvent = {
  type: "pong_game_started";
  roomId: string;
};

export type PongRemotePaddleEvent = {
  type: "pong_paddle_input";
  roomId: string;
  clientId: string;
  y: number;
};

export type PongRemoteGameStateEvent = {
  type: "pong_game_state";
  roomId: string;
  state: PongNetGameState;
};

export type PongGameResetReason = "manual" | "player_left" | "host_left";

export type PongGameResetEvent = {
  type: "pong_game_reset";
  roomId: string;
  reason: PongGameResetReason;
};

export type PongPlayerDisconnectedEvent = {
  type: "pong_player_disconnected";
  roomId: string;
  clientId: string;
  wasHost: boolean;
};

export type PongServerEvent =
  | PongLobbyUpdatedEvent
  | PongGameStartedEvent
  | PongRemotePaddleEvent
  | PongRemoteGameStateEvent
  | PongGameResetEvent
  | PongPlayerDisconnectedEvent;
