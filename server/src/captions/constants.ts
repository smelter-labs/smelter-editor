import type { InputType } from '../types';

/** Smelter side-channel audio delay — must match Python sidecar wait time. */
export const CAPTIONS_SIDE_CHANNEL_DELAY_MS = 8000;

/** Input types that can expose audio on the captions side channel. */
export const TRANSCRIPTION_INPUT_TYPES: InputType[] = [
  'local-mp4',
  'twitch-channel',
  'kick-channel',
  'hls',
  'whip',
];

export function supportsTranscription(type: InputType): boolean {
  return TRANSCRIPTION_INPUT_TYPES.includes(type);
}

export function hasTranscription(input: {
  type: InputType;
  transcription?: boolean;
}): boolean {
  return supportsTranscription(input.type) && !!input.transcription;
}
