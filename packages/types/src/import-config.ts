import type { Layout, LayerBehaviorConfig } from './layout.js';
import type { ShaderConfig } from './shader.js';
import type { InputType } from './input.js';
import type { SnakeEventShaderConfig } from './snake-game.js';

export type ImportConfigInput = {
  type: InputType;
  title: string;
  description: string;
  volume: number;
  showTitle?: boolean;
  shaders: ShaderConfig[];
  channelId?: string;
  url?: string;
  imageId?: string;
  mp4FileName?: string;
  audioFileName?: string;
  text?: string;
  textAlign?: 'left' | 'center' | 'right';
  textColor?: string;
  needsConnection?: boolean;
  textMaxLines?: number;
  textScrollSpeed?: number;
  textScrollLoop?: boolean;
  textFontSize?: number;
  borderColor?: string;
  borderWidth?: number;
  gameBackgroundColor?: string;
  gameCellGap?: number;
  gameBoardBorderColor?: string;
  gameBoardBorderWidth?: number;
  gameGridLineColor?: string;
  gameGridLineAlpha?: number;
  snakeEventShaders?: SnakeEventShaderConfig;
  snake1Shaders?: ShaderConfig[];
  snake2Shaders?: ShaderConfig[];
  attachedInputIndices?: number[];
  absolutePosition?: boolean;
  absoluteTop?: number;
  absoluteLeft?: number;
  absoluteWidth?: number;
  absoluteHeight?: number;
  absoluteTransitionDurationMs?: number;
  absoluteTransitionEasing?: string;
  cropTop?: number;
  cropLeft?: number;
  cropRight?: number;
  cropBottom?: number;
};

export type ImportConfigTimeline = {
  totalDurationMs: number;
  pixelsPerSecond: number;
  keyframeInterpolationMode?: 'step' | 'smooth';
  tracks: {
    label: string;
    clips: {
      inputIndex: number;
      startMs: number;
      endMs: number;
      blockSettings?: Record<string, unknown>;
      keyframes?: { id: string; timeMs: number; blockSettings: Record<string, unknown> }[];
    }[];
  }[];
};

export type ImportConfigTransitionSettings = {
  swapDurationMs?: number;
  swapOutgoingEnabled?: boolean;
  swapFadeInDurationMs?: number;
  swapFadeOutDurationMs?: number;
};

export type ImportConfigLayerInput = {
  inputIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  transitionDurationMs?: number;
  transitionEasing?: string;
  cropTop?: number;
  cropLeft?: number;
  cropRight?: number;
  cropBottom?: number;
};

export type ImportConfigLayer = {
  id: string;
  inputs: ImportConfigLayerInput[];
  behavior?: LayerBehaviorConfig;
};

export type ImportConfigRequest = {
  config: {
    version: 1;
    layout: Layout;
    inputs: ImportConfigInput[];
    layers?: ImportConfigLayer[];
    resolution?: { width: number; height: number };
    transitionSettings?: ImportConfigTransitionSettings;
    viewport?: {
      viewportTop?: number;
      viewportLeft?: number;
      viewportWidth?: number;
      viewportHeight?: number;
      viewportTransitionDurationMs?: number;
      viewportTransitionEasing?: string;
    };
    timeline?: ImportConfigTimeline;
    outputPlayer?: { muted: boolean; volume: number };
    outputShaders?: ShaderConfig[];
    exportedAt: string;
  };
  oldInputIds: string[];
  timelineAtZero?: {
    hiddenInputIds: number[];
    blockSettingsEntries: [number, Record<string, unknown>][];
  };
};

export type ImportConfigProgressEvent = {
  phase: string;
  current: number;
  total: number;
};

export type ImportConfigDoneEvent = {
  done: true;
  indexToInputId: Record<number, string>;
  pendingWhipData: {
    id: string;
    title: string;
    position: number;
    volume: number;
    showTitle: boolean;
    shaders: ShaderConfig[];
  }[];
  errors: string[];
};

export type ImportConfigStreamEvent = ImportConfigProgressEvent | ImportConfigDoneEvent;
