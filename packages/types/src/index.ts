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
  BroadcastTilesUpdatedEvent,
  RoomEvent,
} from "./events.js";

export type { RoomNameEntry } from "./room-names.js";

export { Layouts } from "./layout.js";
export type {
  Layout,
  Layer,
  LayerInput,
  LayerBehaviorConfig,
  CarouselConfig,
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
  AIModelConfig,
  AIModelStatus,
  AIModelInfo,
  ModelParamSpec,
  NumberParamSpec,
  SelectParamSpec,
  ColorParamSpec,
  ModelParamValue,
} from "./ai-models.js";

export type {
  UpdateInputOptions,
  RegisterInputOptions,
  PendingWhipInputData,
} from "./input-options.js";

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

export type { BroadcastTile } from "./broadcast.js";

export type {
  PongSide,
  PongGamePhase,
  PongBounceKind,
  PongBounceEvent,
  PongBall,
  PongNetGameState,
  PongLobbyPlayer,
  PongLobbyState,
  PongJoinMessage,
  PongReadyMessage,
  PongLeaveMessage,
  PongPaddleInputMessage,
  PongGameStateMessage,
  PongResetMessage,
  PongClientMessage,
  PongLobbyUpdatedEvent,
  PongGameStartedEvent,
  PongRemotePaddleEvent,
  PongRemoteGameStateEvent,
  PongGameResetReason,
  PongGameResetEvent,
  PongPlayerDisconnectedEvent,
  PongServerEvent,
} from "./pong-events.js";

export type {
  ShooterPlayer,
  ShooterAmmoConfig,
  ShooterJoinMessage,
  ShooterAimMessage,
  ShooterFireMessage,
  ShooterLeaveMessage,
  ShooterSpectateMessage,
  ShooterClientMessage,
  ShooterMatchMode,
  ShooterMatchPhase,
  ShooterHostCharacter,
  ShooterMatchConfig,
  ShooterStateEvent,
  ShooterHitEvent,
  ShooterMissEvent,
  ShooterEmptyEvent,
  ShooterAmmoEvent,
  ShooterMatchEvent,
  ShooterServerEvent,
} from "./shooter-events.js";

export type {
  KettlebellExercise,
  KettlebellIssueCode,
  KettlebellRepCompletedEvent,
  KettlebellExerciseChangedEvent,
  KettlebellTechniqueAlertEvent,
  KettlebellServerEvent,
} from "./kettlebell-events.js";
export { KETTLEBELL_ISSUE_LABELS } from "./kettlebell-events.js";

export type {
  KbtExerciseKey,
  KbtScoringRule,
  KbtConfig,
  KbtTournamentPhase,
  KbtMatchAction,
  KbtHeatPhase,
  KbtPlayer,
  KbtScoreBreakdown,
  KbtHeatSummary,
  KbtJoinMessage,
  KbtCamRequestMessage,
  KbtCamStopMessage,
  KbtLeaveMessage,
  KbtSpectateMessage,
  KbtCommentatorJoinMessage,
  KbtCommentatorCamRequestMessage,
  KbtCommentatorLeaveMessage,
  KbtCommentator,
  KbtClientMessage,
  KbtStateEvent,
  KbtCamOfferEvent,
  KbtMatchEvent,
  KbtRepEvent,
  KbtPoseEvent,
  KbtLeadChangeEvent,
  KbtStreakEvent,
  KbtServerEvent,
} from "./kettlebell-tournament-events.js";
export {
  KBT_EXERCISE_KEYS,
  KBT_DEFAULT_CONFIG,
} from "./kettlebell-tournament-events.js";
