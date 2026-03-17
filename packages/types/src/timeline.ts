import type { ShaderConfig } from './shader.js';
import type { TransitionConfig } from './transition.js';
import type { InputOrientation } from './input.js';
import type { SnakeEventShaderConfig } from './snake-game.js';

export type TimelineBlockSettings = {
  volume: number;
  showTitle: boolean;
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
  gameBackgroundColor?: string;
  gameCellGap?: number;
  gameBoardBorderColor?: string;
  gameBoardBorderWidth?: number;
  gameGridLineColor?: string;
  gameGridLineAlpha?: number;
  snakeEventShaders?: SnakeEventShaderConfig;
  snake1Shaders?: ShaderConfig[];
  snake2Shaders?: ShaderConfig[];
  absolutePosition?: boolean;
  absoluteTop?: number;
  absoluteLeft?: number;
  absoluteWidth?: number;
  absoluteHeight?: number;
  absoluteTransitionDurationMs?: number;
  absoluteTransitionEasing?: string;
  mp4PlayFromMs?: number;
  mp4Loop?: boolean;
  introTransition?: TransitionConfig;
  outroTransition?: TransitionConfig;
};

export type TimelineClip = {
  id: string;
  inputId: string;
  startMs: number;
  endMs: number;
  blockSettings: TimelineBlockSettings;
};

export type TimelineTrack = {
  id: string;
  clips: TimelineClip[];
};

export type TimelineConfig = {
  tracks: TimelineTrack[];
  totalDurationMs: number;
};
