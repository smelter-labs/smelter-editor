export type { Resolution, ResolutionPreset } from './resolution.js';
export { RESOLUTION_PRESETS } from './resolution.js';

export { Layouts } from './layout.js';
export type {
  Layout,
  Layer,
  LayerInput,
  LayerBehaviorConfig,
  EqualGridConfig,
  PreserveApproximateAspectGridConfig,
  PreserveExactAspectGridConfig,
  PictureInPictureConfig,
  ObjectFit,
  BehaviorInputInfo,
} from './layout.js';

export { computeLayout, computeAddInput } from './layer-behavior.js';
export type { ComputeLayoutResult } from './layer-behavior.js';

export type { ShaderParamConfig, ShaderParam, ShaderParamDefinition, ShaderConfig, ShaderPreset } from './shader.js';

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

export type { ChannelInfo } from './channel.js';

export type { RoomNameEntry } from './room-names.js';

export type {
  ConnectedPeer,
  ConnectedEvent,
  InputUpdatedEvent,
  InputDeletedEvent,
  RoomUpdatedEvent,
  PeersUpdatedEvent,
  RoomEvent,
} from './events.js';
