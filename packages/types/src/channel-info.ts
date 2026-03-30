/** Shared shape for live stream metadata from Twitch/Kick APIs. */
export type ChannelInfo = {
  streamId: string;
  displayName: string;
  title: string;
  category: string;
  thumbnailUrl?: string;
};
