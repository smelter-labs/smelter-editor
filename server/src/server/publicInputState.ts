import path from 'path';
import type { RoomInputState } from '../room/types';
import type { PublicInputState } from '../types';
import { toPublicSnakeGameInputState } from '../snakeGame/publicSnakeGameState';

export type { PublicInputState } from '../types';

export function toPublicInputState(input: RoomInputState): PublicInputState {
  const base = {
    inputId: input.inputId,
    title: input.metadata.title,
    description: input.metadata.description,
    showTitle: input.showTitle,
    status: input.status,
    volume: input.volume,
    type: input.type,
    shaders: input.shaders,
    borderColor: input.borderColor,
    borderWidth: input.borderWidth,
    attachedInputIds: input.attachedInputIds,
    hidden: input.hidden,
    activeTransition: input.activeTransition,
    absolutePosition: input.absolutePosition,
    absoluteTop: input.absoluteTop,
    absoluteLeft: input.absoluteLeft,
    absoluteWidth: input.absoluteWidth,
    absoluteHeight: input.absoluteHeight,
    absoluteTransitionDurationMs: input.absoluteTransitionDurationMs,
    absoluteTransitionEasing: input.absoluteTransitionEasing,
    cropTop: input.cropTop,
    cropLeft: input.cropLeft,
    cropRight: input.cropRight,
    cropBottom: input.cropBottom,
    motionScore: input.motionScore,
    motionEnabled: input.motionEnabled,
  };
  switch (input.type) {
    case 'local-mp4': {
      const fileName = path.basename(input.mp4FilePath);
      const isAudio = input.mp4FilePath.includes('/audios/');
      return {
        ...base,
        sourceState: 'always-live' as const,
        sourceWidth: input.mp4VideoWidth,
        sourceHeight: input.mp4VideoHeight,
        mp4FileName: isAudio ? undefined : fileName,
        audioFileName: isAudio ? fileName : undefined,
      };
    }
    case 'image':
      return {
        ...base,
        sourceState: 'always-live' as const,
        imageId: input.imageId,
      };
    case 'twitch-channel':
    case 'kick-channel':
      return {
        ...base,
        sourceState: input.monitor.isLive() ? 'live' : 'offline',
        channelId: input.channelId,
      };
    case 'hls':
      return {
        ...base,
        sourceState: 'always-live' as const,
        url: input.hlsUrl,
      };
    case 'whip':
      return {
        ...base,
        sourceState: input.monitor.isLive() ? 'live' : 'offline',
      };
    case 'text-input':
      return {
        ...base,
        sourceState: 'always-live' as const,
        text: input.text,
        textAlign: input.textAlign,
        textColor: input.textColor,
        textMaxLines: input.textMaxLines,
        textScrollSpeed: input.textScrollSpeed,
        textScrollLoop: input.textScrollLoop,
        textScrollNudge: input.textScrollNudge,
        textFontSize: input.textFontSize,
      };
    case 'game':
      return {
        ...base,
        sourceState: 'always-live' as const,
        ...toPublicSnakeGameInputState(input),
      };
    case 'hands':
      return {
        ...base,
        sourceState: 'always-live' as const,
        handsSourceInputId: input.sourceInputId,
      };
    default:
      throw new Error('Unknown input state');
  }
}
