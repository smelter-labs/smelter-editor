/** Information about a live streaming channel (Twitch, Kick, etc.). */
export type ChannelInfo = {
  streamId: string;
  displayName: string;
  title: string;
  category: string;
  thumbnailUrl: string;
};
