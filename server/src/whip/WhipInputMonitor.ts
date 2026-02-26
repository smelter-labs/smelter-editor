export class WhipInputMonitor {
  private username: string;
  private isStreamLive: boolean = true;
  private onUpdateFn?: () => void;
  private lastAckTimestamp = Date.now();

  private constructor(username: string) {
    this.username = username;
  }

  public static async startMonitor(username: string): Promise<WhipInputMonitor> {
    return new WhipInputMonitor(username);
  }
  public getLastAckTimestamp(): number {
    return this.lastAckTimestamp;
  }

  public isLive(): boolean {
    return this.isStreamLive;
  }

  public getUsername(): string {
    return this.username;
  }

  public touch(): { previousAckTimestamp: number; currentAckTimestamp: number } {
    const previousAckTimestamp = this.lastAckTimestamp;
    const currentAckTimestamp = Date.now();
    this.lastAckTimestamp = currentAckTimestamp;
    return { previousAckTimestamp, currentAckTimestamp };
  }
}
