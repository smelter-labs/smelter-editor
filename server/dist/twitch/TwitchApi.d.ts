export declare function getTopStreamsFromCategory(categoryId: string, count?: number): Promise<string[]>;
export declare function getTwitchStreamInfo(twitchChannelId: string): Promise<TwitchStreamInfo | undefined>;
export interface TwitchStreamInfo {
    streamId: string;
    displayName: string;
    title: string;
    category: string;
}
