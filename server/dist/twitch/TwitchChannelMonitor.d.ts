import type { TwitchStreamInfo } from './TwitchApi';
declare class TwitchChannelSuggestionsMonitor {
    private topStreams;
    monitor(): Promise<void>;
    getTopStreams(): TwitchStreamInfo[];
    private refreshCategoryInfo;
}
export declare class TwitchChannelMonitor {
    private channelId;
    private streamInfo;
    private isStreamLive;
    private shouldStop;
    private onUpdateFn?;
    private constructor();
    static startMonitor(channelId: string): Promise<TwitchChannelMonitor>;
    stop(): void;
    isLive(): boolean;
    onUpdate(onUpdateFn: (streamInfo: TwitchStreamInfo, isLive: boolean) => void): void;
    private monitor;
}
export declare const TwitchChannelSuggestions: TwitchChannelSuggestionsMonitor;
export {};
