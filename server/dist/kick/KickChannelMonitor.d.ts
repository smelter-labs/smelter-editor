import type { KickStreamInfo } from '../kick/KickApi';
declare class KickChannelSuggestionsMonitor {
    private topStreams;
    monitor(): Promise<void>;
    getTopStreams(): KickStreamInfo[];
    private refreshCategoryInfo;
}
export declare class KickChannelMonitor {
    private channelId;
    private streamInfo;
    private isStreamLive;
    private shouldStop;
    private onUpdateFn?;
    private constructor();
    static startMonitor(channelId: string): Promise<KickChannelMonitor>;
    stop(): void;
    isLive(): boolean;
    onUpdate(onUpdateFn: (streamInfo: KickStreamInfo, isLive: boolean) => void): void;
    private monitor;
}
export declare const KickChannelSuggestions: KickChannelSuggestionsMonitor;
export {};
