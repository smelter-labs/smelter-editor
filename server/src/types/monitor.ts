export interface StreamMonitor {
  isLive(): boolean;
  stop(): void;
}

export interface WhipMonitor {
  isLive(): boolean;
  touch(): { previousAckTimestamp: number; currentAckTimestamp: number };
  getUsername(): string;
  getLastAckTimestamp(): number;
  /** Registration-time stamp: starts the stale grace without claiming a live publish. */
  seed(): void;
  /** The publisher acked at least once and within ttlMs. */
  isPublishLive(ttlMs: number): boolean;
  wasExternallyAcked(): boolean;
}
