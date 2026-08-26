import type { WhipMonitor } from '../types';

export class WhipInputMonitor implements WhipMonitor {
  private username: string;
  private isStreamLive: boolean = true;
  private onUpdateFn?: () => void;
  private lastAckTimestamp = Date.now();
  /**
   * Whether any ack ever came from the publisher itself. The registration
   * seed also stamps lastAckTimestamp (grace for the first publish), but must
   * not count as "the stream is live".
   */
  private externallyAcked = false;

  private constructor(username: string) {
    this.username = username;
  }

  public static async startMonitor(
    username: string,
  ): Promise<WhipInputMonitor> {
    return new WhipInputMonitor(username);
  }
  public getLastAckTimestamp(): number {
    return this.lastAckTimestamp;
  }

  public isLive(): boolean {
    return this.isStreamLive;
  }

  /** The publisher acked at least once and recently enough. */
  public isPublishLive(ttlMs: number): boolean {
    return this.externallyAcked && Date.now() - this.lastAckTimestamp < ttlMs;
  }

  public wasExternallyAcked(): boolean {
    return this.externallyAcked;
  }

  public getUsername(): string {
    return this.username;
  }

  /** Registration-time stamp: starts the stale-grace clock without claiming
   * a live publish. */
  public seed(): void {
    this.lastAckTimestamp = Date.now();
  }

  public touch(): {
    previousAckTimestamp: number;
    currentAckTimestamp: number;
  } {
    const previousAckTimestamp = this.lastAckTimestamp;
    const currentAckTimestamp = Date.now();
    this.lastAckTimestamp = currentAckTimestamp;
    this.externallyAcked = true;
    return { previousAckTimestamp, currentAckTimestamp };
  }
}
