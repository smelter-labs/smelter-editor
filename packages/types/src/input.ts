import type { ShaderConfig } from './shader.js';
import type { SnakeEventShaderConfig } from './snake-game.js';

export type InputOrientation = 'horizontal' | 'vertical';

export type InputType =
  | 'local-mp4'
  | 'twitch-channel'
  | 'kick-channel'
  | 'hls'
  | 'whip'
  | 'image'
  | 'text-input'
  | 'game'
  | 'hands';

export type InputStatus = 'disconnected' | 'pending' | 'connected';

export type InputSourceState = 'live' | 'offline' | 'unknown' | 'always-live';

export type InputDisplayProperties = {
  volume: number;
  showTitle: boolean;
  shaders: ShaderConfig[];
  orientation: InputOrientation;
};

export type TextInputProperties = {
  text: string;
  textAlign: 'left' | 'center' | 'right';
  textColor: string;
  textMaxLines: number;
  textScrollSpeed: number;
  textScrollLoop: boolean;
  textScrollNudge: number;
  textFontSize: number;
};

export type AbsolutePositionProperties = {
  absolutePosition: boolean;
  absoluteTop: number;
  absoluteLeft: number;
  absoluteWidth: number;
  absoluteHeight: number;
  absoluteTransitionDurationMs: number;
  absoluteTransitionEasing: string;
};

export type CropProperties = {
  cropTop: number;
  cropLeft: number;
  cropRight: number;
  cropBottom: number;
};

export type BorderProperties = {
  borderColor: string;
  borderWidth: number;
};

export type SnakeGameDisplayProperties = {
  gameBackgroundColor: string;
  gameCellGap: number;
  gameBoardBorderColor: string;
  gameBoardBorderWidth: number;
  gameGridLineColor: string;
  gameGridLineAlpha: number;
  snakeEventShaders: SnakeEventShaderConfig;
  snake1Shaders: ShaderConfig[];
  snake2Shaders: ShaderConfig[];
  snakePlayerColors: string[];
};

export type MotionProperties = {
  motionScore: number;
  motionEnabled: boolean;
};

export type HandsProperties = {
  handsSourceInputId?: string;
};
