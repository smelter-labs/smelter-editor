export declare class WhipInputMonitor {
    private username;
    private isStreamLive;
    private onUpdateFn?;
    private lastAckTimestamp;
    private constructor();
    static startMonitor(username: string): Promise<WhipInputMonitor>;
    getLastAckTimestamp(): number;
    isLive(): boolean;
    touch(): void;
}
