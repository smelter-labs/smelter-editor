export type { Resolution, ResolutionPreset } from "./resolution.js";
export { RESOLUTION_PRESETS } from "./resolution.js";

export type { ChannelInfo } from "./channel.js";

export type {
  ConnectedPeer,
  ConnectedEvent,
  InputUpdatedEvent,
  InputDeletedEvent,
  RoomUpdatedEvent,
  PeersUpdatedEvent,
  TimelinePlaybackUpdatedEvent,
  NormalizationProgressEvent,
  NormalizationDoneEvent,
  RoomEvent,
} from "./events.js";

export type { RoomNameEntry } from "./room-names.js";

export { Layouts } from "./layout.js";
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
} from "./layout.js";

export { computeLayout, computeAddInput } from "./layer-behavior.js";
export type { ComputeLayoutResult } from "./layer-behavior.js";

export type {
  ShaderParamConfig,
  ShaderParam,
  ShaderParamDefinition,
  ShaderConfig,
  ShaderPreset,
} from "./shader.js";

export type {
  TransitionType,
  TransitionConfig,
  ActiveTransition,
} from "./transition.js";
export { isTransitionType, parseTransitionConfig } from "./transition.js";

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
  InputOrientation,
  ViewportProperties,
} from "./input.js";

export { AUDIO_BAND_COUNT } from "./audio.js";
export type { AudioBands } from "./audio.js";

export type {
  SnakeEventType,
  SnakeEventApplicationMode,
  SnakeEventShaderMapping,
  SnakeEventShaderConfig,
} from "./snake-game.js";

export type { PublicInputState } from "./public-input-state.js";

export type {
  UpdateInputOptions,
  RegisterInputOptions,
  PendingWhipInputData,
} from "./input-options.js";

export type { YoloSearchConfig, YoloBoundingBox } from "./yolo.js";

export type {
  TimelineBlockSettings,
  TimelineKeyframe,
  TimelineClip,
  TimelineTrack,
  TimelineKeyframeInterpolationMode,
  TimelineConfig,
} from "./timeline.js";

export {
  OUTPUT_TRACK_INPUT_ID,
  OUTPUT_TRACK_ID,
  OUTPUT_CLIP_ID,
  isOutputTrackClip,
} from "./timeline.js";

export type {
  ImportConfigInput,
  ImportConfigLayerInput,
  ImportConfigLayer,
  ImportConfigTimeline,
  ImportConfigTransitionSettings,
  ImportConfigRequest,
  ImportConfigProgressEvent,
  ImportConfigDoneEvent,
  ImportConfigStreamEvent,
} from "./import-config.js";
