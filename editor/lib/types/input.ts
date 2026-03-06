import type { ShaderConfig } from './shader';
import type { SnakeEventShaderConfig } from '../game-types';

export type InputOrientation = 'horizontal' | 'vertical';

export type Input = {
  id: number;
  inputId: string;
  title: string;
  description: string;
  showTitle?: boolean;
  volume: number;
  type:
    | 'local-mp4'
    | 'twitch-channel'
    | 'kick-channel'
    | 'whip'
    | 'image'
    | 'text-input'
    | 'game';
  sourceState: 'live' | 'offline' | 'unknown' | 'always-live';
  status: 'disconnected' | 'pending' | 'connected';
  channelId?: string;
  imageId?: string;
  shaders: ShaderConfig[];
  orientation: InputOrientation;
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
};

export type RegisterInputOptions =
  | {
      type: 'twitch-channel';
      channelId: string;
    }
  | {
      type: 'kick-channel';
      channelId: string;
    }
  | {
      type: 'local-mp4';
      source: {
        fileName?: string;
        url?: string;
      };
    }
  | {
      type: 'text-input';
      text: string;
      textAlign?: 'left' | 'center' | 'right';
    }
  | {
      type: 'game';
      title?: string;
    };

export type UpdateInputOptions = {
  volume: number;
  shaders?: ShaderConfig[];
  showTitle?: boolean;
  orientation?: InputOrientation;
  text?: string;
  textAlign?: 'left' | 'center' | 'right';
  textColor?: string;
  textMaxLines?: number;
  textScrollSpeed?: number;
  textScrollLoop?: boolean;
  textScrollNudge?: number;
  textFontSize?: number;
  borderColor?: string;
  borderWidth?: number;
  attachedInputIds?: string[];
  gameBackgroundColor?: string;
  gameCellGap?: number;
  gameBoardBorderColor?: string;
  gameBoardBorderWidth?: number;
  gameGridLineColor?: string;
  gameGridLineAlpha?: number;
  snakeEventShaders?: SnakeEventShaderConfig;
  snake1Shaders?: ShaderConfig[];
  snake2Shaders?: ShaderConfig[];
};
