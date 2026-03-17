export type { Resolution, ResolutionPreset } from './resolution.js';
export { RESOLUTION_PRESETS } from './resolution.js';

export { Layouts } from './layout.js';
export type { Layout } from './layout.js';

export type { ShaderParamConfig, ShaderConfig, ShaderPreset } from './shader.js';

export type {
  TransitionType,
  TransitionConfig,
  ActiveTransition,
} from './transition.js';
export { isTransitionType, parseTransitionConfig } from './transition.js';

export type { InputOrientation } from './input.js';

export type {
  SnakeEventType,
  SnakeEventApplicationMode,
  SnakeEventShaderMapping,
  SnakeEventShaderConfig,
} from './snake-game.js';

export type {
  TimelineBlockSettings,
  TimelineClip,
  TimelineTrack,
  TimelineConfig,
} from './timeline.js';
