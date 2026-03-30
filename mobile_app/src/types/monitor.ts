export interface StreamMonitor {
  isLive(): boolean;
  stop(): void;
}

export interface WhipMonitor {
  isLive(): boolean;
  touch(): { previousAckTimestamp: number; currentAckTimestamp: number };
  getUsername(): string;
  getLastAckTimestamp(): number;
}
