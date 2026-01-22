export declare function getKickTopStreamsFromCategory(categoryId: string, count?: number): Promise<any[]>;
export declare function getKickStreamInfo(kickChannelSlug: string): Promise<KickStreamInfo | undefined>;
export interface KickStreamInfo {
    streamId: string;
    displayName: string;
    title: string;
    category: string;
}
