export type { Resolution, ResolutionPreset } from './resolution.js';
export { RESOLUTION_PRESETS } from './resolution.js';

export { Layouts } from './layout.js';
export type { Layout, Layer, LayerInput } from './layout.js';

export type { ShaderParamConfig, ShaderConfig, ShaderPreset } from './shader.js';

export type {
  TransitionType,
  TransitionConfig,
  ActiveTransition,
} from './transition.js';
export { isTransitionType, parseTransitionConfig } from './transition.js';

export type {
  InputOrientation,
  InputType,
  InputStatus,
  InputSourceState,
  InputDisplayProperties,
  TextInputProperties,
  AbsolutePositionProperties,
  BorderProperties,
  SnakeGameDisplayProperties,
  MotionProperties,
} from './input.js';

export type {
  SnakeEventType,
  SnakeEventApplicationMode,
  SnakeEventShaderMapping,
  SnakeEventShaderConfig,
} from './snake-game.js';

export type { PublicInputState } from './public-input-state.js';

export type {
  UpdateInputOptions,
  RegisterInputOptions,
  PendingWhipInputData,
} from './input-options.js';

export type {
  TimelineBlockSettings,
  TimelineKeyframe,
  TimelineClip,
  TimelineTrack,
  TimelineKeyframeInterpolationMode,
  TimelineConfig,
} from './timeline.js';
