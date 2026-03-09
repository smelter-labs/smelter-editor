import type { RoomInputState, InputOrientation } from './roomState';
import type { ShaderConfig } from '../types';
import type { SnakeEventShaderConfig } from '../snakeGame/types';
import { toPublicSnakeGameInputState } from '../snakeGame/publicSnakeGameState';

/** API DTO for a single input; single source of truth for RoomInputState → response mapping */
export type PublicInputState = {
  inputId: string;
  title: string;
  description: string;
  showTitle: boolean;
  sourceState: 'live' | 'offline' | 'unknown' | 'always-live';
  status: 'disconnected' | 'pending' | 'connected';
  volume: number;
  type: RoomInputState['type'];
  shaders: ShaderConfig[];
  orientation: InputOrientation;
  channelId?: string;
  imageId?: string;
  text?: string;
  textAlign?: 'left' | 'center' | 'right';
  textColor?: string;
  textMaxLines?: number;
  textScrollSpeed?: number;
  textScrollLoop?: boolean;
  textFontSize?: number;
  borderColor?: string;
  borderWidth?: number;
  attachedInputIds?: string[];
  hidden?: boolean;
  gameBackgroundColor?: string;
  gameCellGap?: number;
  gameBoardBorderColor?: string;
  gameBoardBorderWidth?: number;
  gameGridLineColor?: string;
  gameGridLineAlpha?: number;
  snakeEventShaders?: SnakeEventShaderConfig;
  snake1Shaders?: ShaderConfig[];
  snake2Shaders?: ShaderConfig[];
  snakePlayerColors?: string[];
  absolutePosition?: boolean;
  absoluteTop?: number;
  absoluteLeft?: number;
  absoluteWidth?: number;
  absoluteHeight?: number;
  absoluteTransitionDurationMs?: number;
  absoluteTransitionEasing?: string;
  motionScore?: number;
  motionEnabled?: boolean;
};

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
    orientation: input.orientation,
    borderColor: input.borderColor,
    borderWidth: input.borderWidth,
    attachedInputIds: input.attachedInputIds,
    hidden: input.hidden,
    absolutePosition: input.absolutePosition,
    absoluteTop: input.absoluteTop,
    absoluteLeft: input.absoluteLeft,
    absoluteWidth: input.absoluteWidth,
    absoluteHeight: input.absoluteHeight,
    absoluteTransitionDurationMs: input.absoluteTransitionDurationMs,
    absoluteTransitionEasing: input.absoluteTransitionEasing,
    motionScore: input.motionScore,
    motionEnabled: input.motionEnabled,
  };
  switch (input.type) {
    case 'local-mp4':
      return { ...base, sourceState: 'always-live' as const };
    case 'image':
      return { ...base, sourceState: 'always-live' as const, imageId: input.imageId };
    case 'twitch-channel':
    case 'kick-channel':
      return {
        ...base,
        sourceState: input.monitor.isLive() ? 'live' : 'offline',
        channelId: input.channelId,
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
        textFontSize: input.textFontSize,
      };
    case 'game':
      return {
        ...base,
        sourceState: 'always-live' as const,
        ...toPublicSnakeGameInputState(input),
      };
    default:
      throw new Error('Unknown input state');
  }
}
