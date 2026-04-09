import type {
  ShaderConfig,
  StreamMonitor,
  WhipMonitor,
  ActiveTransition,
  InputType,
  InputStatus,
  InputDisplayProperties,
  BorderProperties,
  AbsolutePositionProperties,
  CropProperties,
  ViewportProperties,
} from '../types';
import type { StoreApi } from 'zustand';
import type { HandsStore } from '../hands/handStore';
import type { TwitchStreamInfo } from '../twitch/TwitchApi';
import type {
  SnakeGameState,
  SnakeEventShaderConfig,
  ActiveSnakeEffect,
} from '../snakeGame/types';

import type { Layer } from '../types';

export type {
  UpdateInputOptions,
  RegisterInputOptions,
  PendingWhipInputData,
} from '../types';

export type RoomSnapshot = {
  inputs: RoomInputState[];
  layers: Layer[];
  swapDurationMs: number;
  swapOutgoingEnabled: boolean;
  swapFadeInDurationMs: number;
  swapFadeOutDurationMs: number;
  outputShaders: ShaderConfig[];
} & Partial<ViewportProperties>;

export type RoomInputState = {
  inputId: string;
  type: InputType;
  status: InputStatus;
  hidden: boolean;
  attachedInputIds?: string[];
  activeTransition?: ActiveTransition;
  restartFading?: boolean;
  motionEnabled: boolean;
  motionScore?: number;
  orientation?: 'horizontal' | 'vertical';
  /** Native stream resolution width, if known. */
  nativeWidth?: number;
  /** Native stream resolution height, if known. */
  nativeHeight?: number;
  metadata: {
    title: string;
    description: string;
  };
} & InputDisplayProperties &
  BorderProperties &
  Partial<AbsolutePositionProperties> &
  Partial<CropProperties> &
  TypeSpecificState;

type TypeSpecificState =
  | {
      type: 'local-mp4';
      mp4FilePath: string;
      /** Present when the configured file was not found on disk (e.g. config import). */
      mp4AssetMissing?: boolean;
      /** When mp4AssetMissing, whether the slot was created for an audio file vs video MP4. */
      missingAssetIsAudio?: boolean;
      registeredAtPipelineMs?: number;
      playFromMs?: number;
      mp4DurationMs?: number;
      mp4VideoWidth?: number;
      mp4VideoHeight?: number;
    }
  | {
      type: 'twitch-channel';
      channelId: string;
      hlsUrl: string;
      monitor: StreamMonitor & {
        onUpdate(
          fn: (streamInfo: TwitchStreamInfo, isLive: boolean) => void,
        ): void;
      };
    }
  | {
      type: 'kick-channel';
      channelId: string;
      hlsUrl: string;
      monitor: StreamMonitor & {
        onUpdate(fn: (streamInfo: any, isLive: boolean) => void): void;
      };
    }
  | { type: 'hls'; hlsUrl: string }
  | { type: 'whip'; whipUrl: string; monitor: WhipMonitor }
  | {
      type: 'image';
      imageId: string;
      /** Present when the configured image file was not found on disk yet. */
      imageAssetMissing?: boolean;
    }
  | {
      type: 'text-input';
      text: string;
      textAlign: 'left' | 'center' | 'right';
      textColor: string;
      textMaxLines: number;
      textScrollEnabled: boolean;
      textScrollSpeed: number;
      textScrollLoop: boolean;
      textScrollNudge: number;
      textFontSize: number;
    }
  | {
      type: 'game';
      snakeGameState: SnakeGameState;
      snakeEventShaders?: SnakeEventShaderConfig;
      snake1Shaders?: ShaderConfig[];
      snake2Shaders?: ShaderConfig[];
      activeEffects: ActiveSnakeEffect[];
      effectTimers: NodeJS.Timeout[];
    }
  | {
      type: 'hands';
      sourceInputId: string;
      handsStore: StoreApi<HandsStore>;
    };
