export type { Resolution, ResolutionPreset } from './resolution.js';
export { RESOLUTION_PRESETS } from './resolution.js';

export type { ChannelInfo } from './channel-info.js';

export type {
  ConnectedPeer,
  ConnectedEvent,
  InputUpdatedEvent,
  InputDeletedEvent,
  PeersUpdatedEvent,
  RoomEvent,
} from './room-events.js';

export type { RoomNameEntry } from './room-names.js';

export { Layouts } from './layout.js';
export type { Layout } from './layout.js';

export type {
  ShaderParam,
  ShaderParamConfig,
  ShaderConfig,
  ShaderPreset,
} from './shader.js';

export type {
  TransitionType,
  TransitionConfig,
  ActiveTransition,
} from './transition.js';
export { isTransitionType, parseTransitionConfig } from './transition.js';

export type {
  InputType,
  InputStatus,
  InputSourceState,
  InputDisplayProperties,
  TextInputProperties,
  AbsolutePositionProperties,
  CropProperties,
  BorderProperties,
  SnakeGameDisplayProperties,
  MotionProperties,
  HandsProperties,
  ViewportProperties,
} from './input.js';

export { AUDIO_BAND_COUNT } from './audio.js';
export type { AudioBands } from './audio.js';

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
export {
  OUTPUT_TRACK_INPUT_ID,
  OUTPUT_TRACK_ID,
  OUTPUT_CLIP_ID,
  isOutputTrackClip,
} from './timeline.js';

export type {
  ImportConfigInput,
  ImportConfigTimeline,
  ImportConfigTransitionSettings,
  ImportConfigRequest,
  ImportConfigProgressEvent,
  ImportConfigDoneEvent,
  ImportConfigStreamEvent,
} from './import-config.js';
