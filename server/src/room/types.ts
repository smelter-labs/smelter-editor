import type {
  ShaderConfig,
  StreamMonitor,
  WhipMonitor,
  ActiveTransition,
} from '../types';
import type { TwitchStreamInfo } from '../twitch/TwitchApi';
import type {
  SnakeGameState,
  SnakeEventShaderConfig,
  ActiveSnakeEffect,
} from '../snakeGame/types';

export type InputOrientation = 'horizontal' | 'vertical';

export type RoomInputState = {
  inputId: string;
  type:
    | 'local-mp4'
    | 'twitch-channel'
    | 'kick-channel'
    | 'whip'
    | 'image'
    | 'text-input'
    | 'game';
  status: 'disconnected' | 'pending' | 'connected';
  volume: number;
  showTitle: boolean;
  shaders: ShaderConfig[];
  orientation: InputOrientation;
  borderColor: string;
  borderWidth: number;
  hidden: boolean;
  attachedInputIds?: string[];
  absolutePosition?: boolean;
  absoluteTop?: number;
  absoluteLeft?: number;
  absoluteWidth?: number;
  absoluteHeight?: number;
  absoluteTransitionDurationMs?: number;
  absoluteTransitionEasing?: string;
  activeTransition?: ActiveTransition;
  restartFading?: boolean;
  motionScore?: number;
  motionEnabled: boolean;
  metadata: {
    title: string;
    description: string;
  };
} & TypeSpecificState;

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
    };

export type PendingWhipInputData = {
  id: string;
  title: string;
  volume: number;
  showTitle: boolean;
  shaders: ShaderConfig[];
  orientation: InputOrientation;
  position: number;
};

export type UpdateInputOptions = {
  volume: number;
  showTitle: boolean;
  shaders: ShaderConfig[];
  orientation: InputOrientation;
  attachedInputIds: string[];
  text: string;
  textAlign: 'left' | 'center' | 'right';
  textColor: string;
  textMaxLines: number;
  textScrollSpeed: number;
  textScrollLoop: boolean;
  textScrollNudge: number;
  textFontSize: number;
  borderColor: string;
  borderWidth: number;
  gameBackgroundColor: string;
  gameCellGap: number;
  gameBoardBorderColor: string;
  gameBoardBorderWidth: number;
  gameGridLineColor: string;
  gameGridLineAlpha: number;
  snakeEventShaders: SnakeEventShaderConfig;
  snake1Shaders: ShaderConfig[];
  snake2Shaders: ShaderConfig[];
  absolutePosition: boolean;
  absoluteTop: number;
  absoluteLeft: number;
  absoluteWidth: number;
  absoluteHeight: number;
  absoluteTransitionDurationMs: number;
  absoluteTransitionEasing: string;
  activeTransition: {
    type: string;
    durationMs: number;
    direction: 'in' | 'out';
  };
};

export type RegisterInputOptions =
  | {
      type: 'twitch-channel';
      channelId: string;
    }
  | {
      type: 'kick-channel';
      channelId: string;
    }
  | {
      type: 'whip';
      username: string;
    }
  | {
      type: 'local-mp4';
      source: {
        fileName?: string;
        url?: string;
      };
    }
  | {
      type: 'image';
      fileName?: string;
      imageId?: string;
    }
  | {
      type: 'text-input';
      text: string;
      textAlign?: 'left' | 'center' | 'right';
      textColor?: string;
      textMaxLines?: number;
      textScrollSpeed?: number;
      textScrollLoop?: boolean;
      textFontSize?: number;
    }
  | {
      type: 'game';
      title?: string;
    };
