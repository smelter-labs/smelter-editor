/**
 * Server room state types.
 * These represent the shape of data returned by the backend.
 */

import { StreamMonitor, WhipMonitor } from "./monitor";
import { TwitchStreamInfo } from "./twitchApi";

export interface RoomResolution {
  width: number;
  height: number;
}

/**
 * PublicInputState returned by the server.
 * Maps to what the backend sends via toPublicInputState().
 */
export interface PublicInputState {
  inputId: string;
  title: string;
  description: string;
  showTitle: boolean;
  sourceState: "live" | "offline" | "unknown" | "always-live";
  status: "disconnected" | "pending" | "connected";
  volume: number;
  type: RoomInputState["type"];
  shaders: ShaderConfig[];
  orientation: InputOrientation;
  channelId?: string;
  imageId?: string;
  text?: string;
  textAlign?: "left" | "center" | "right";
  textColor?: string;
  textMaxLines?: number;
  textScrollSpeed?: number;
  textScrollLoop?: boolean;
  textFontSize?: number;
  borderColor?: string;
  borderWidth?: number;
  attachedInputIds?: string[];
  hidden?: boolean;
  gameBackgroundColor?: string;
  gameCellGap?: number;
  gameBoardBorderColor?: string;
  gameBoardBorderWidth?: number;
  gameGridLineColor?: string;
  gameGridLineAlpha?: number;
  snakeEventShaders?: any; // TODO - define type if we keep this
  snake1Shaders?: ShaderConfig[];
  snake2Shaders?: ShaderConfig[];
  snakePlayerColors?: string[];
  absolutePosition?: boolean;
  absoluteTop?: number;
  absoluteLeft?: number;
  absoluteWidth?: number;
  absoluteHeight?: number;
  absoluteTransitionDurationMs?: number;
  absoluteTransitionEasing?: string;
  motionScore?: number;
  motionEnabled?: boolean;
}

/**
 * Full room state response from GET /room/:roomId.
 */
export interface RoomState {
  roomName: string;
  inputs: PublicInputState[];
  layout: LayoutResponse;
  whepUrl: string;
  pendingDelete: boolean;
  isPublic: boolean;
  resolution: RoomResolution;
  pendingWhipInputs: unknown[];
  swapDurationMs: number;
  swapOutgoingEnabled: boolean;
  swapFadeInDurationMs: number;
  newsStripFadeDuringSwap: boolean;
  swapFadeOutDurationMs: number;
  newsStripEnabled: boolean;
  isRecording: boolean;
}

export interface LayoutResponse {
  items?: Array<{
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    label?: string;
  }>;
  columns?: number;
  rows?: number;
  [key: string]: unknown;
}

export type InputOrientation = "horizontal" | "vertical";

export type RoomInputState = {
  inputId: string;
  type:
    | "local-mp4"
    | "twitch-channel"
    | "kick-channel"
    | "whip"
    | "image"
    | "text-input"
    | "game";
  status: "disconnected" | "pending" | "connected";
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
  activeTransition?: {
    type: string;
    durationMs: number;
    direction: "in" | "out";
  };
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
      type: "local-mp4";
      mp4FilePath: string;
      registeredAtPipelineMs?: number;
      playFromMs?: number;
    }
  | {
      type: "twitch-channel";
      channelId: string;
      hlsUrl: string;
      monitor: StreamMonitor & {
        onUpdate(
          fn: (streamInfo: TwitchStreamInfo, isLive: boolean) => void,
        ): void;
      };
    }
  | {
      type: "kick-channel";
      channelId: string;
      hlsUrl: string;
      monitor: StreamMonitor & {
        onUpdate(fn: (streamInfo: any, isLive: boolean) => void): void;
      };
    }
  | { type: "whip"; whipUrl: string; monitor: WhipMonitor }
  | { type: "image"; imageId: string }
  | {
      type: "text-input";
      text: string;
      textAlign: "left" | "center" | "right";
      textColor: string;
      textMaxLines: number;
      textScrollSpeed: number;
      textScrollLoop: boolean;
      textScrollNudge: number;
      textFontSize: number;
    };

export type ShaderParamConfig = {
  paramName: string;
  /** number for numeric params, string (e.g. hex) for color params */
  paramValue: number | string;
};

export type ShaderConfig = {
  shaderName: string;
  shaderId: string;
  enabled: boolean;
  params: ShaderParamConfig[];
};
