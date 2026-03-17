export enum ConnectionStatus {
  Idle = "idle",
  Connecting = "connecting",
  Connected = "connected",
  Failed = "failed",
  Disconnected = "disconnected",
}

export interface RoomConfig {
  roomId: string;
  serverUrl: string;
  name?: string;
}

export interface ConnectedPeer {
  clientId: string;
  name: string;
}

export interface AuthToken {
  token: string;
  expiresAt?: number;
}
