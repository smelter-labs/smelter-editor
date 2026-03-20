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
  EqualizerConfig,
} from '../types';
import type { StoreApi } from 'zustand';
import type { HandsStore } from '../hands/handStore';
import type { TwitchStreamInfo } from '../twitch/TwitchApi';
import type {
  SnakeGameState,
  SnakeEventShaderConfig,
  ActiveSnakeEffect,
} from '../snakeGame/types';

import type { Layout } from '../types';

export type { InputOrientation } from '../types';
export type {
  UpdateInputOptions,
  RegisterInputOptions,
  PendingWhipInputData,
} from '../types';

export type RoomSnapshot = {
  inputs: RoomInputState[];
  layout: Layout;
  swapDurationMs: number;
  swapOutgoingEnabled: boolean;
  swapFadeInDurationMs: number;
  newsStripFadeDuringSwap: boolean;
  swapFadeOutDurationMs: number;
  newsStripEnabled: boolean;
};

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
      registeredAtPipelineMs?: number;
      playFromMs?: number;
      mp4DurationMs?: number;
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
  | { type: 'whip'; whipUrl: string; monitor: WhipMonitor }
  | { type: 'image'; imageId: string }
  | {
      type: 'text-input';
      text: string;
      textAlign: 'left' | 'center' | 'right';
      textColor: string;
      textMaxLines: number;
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
      type: 'equalizer';
      equalizerConfig: EqualizerConfig;
    }
  | {
      type: 'hands';
      sourceInputId: string;
      handsStore: StoreApi<HandsStore>;
    };
