/**
 * Server room state types.
 * These represent the shape of data returned by the backend.
 */

import type {
  InputOrientation,
  PublicInputState,
  Resolution,
  ShaderConfig,
  ShaderParamConfig,
  Layer,
} from "@smelter-editor/types";

import { StreamMonitor, WhipMonitor } from "./monitor";
import { TwitchStreamInfo } from "./twitchApi";

export type {
  InputOrientation,
  PublicInputState,
  ShaderConfig,
  ShaderParamConfig,
  Layer,
};

/**
 * Full room state response from GET /room/:roomId.
 */
export interface RoomState {
  roomName: string;
  inputs: PublicInputState[];
  layers: Layer[];
  isTimelinePlaying?: boolean;
  whepUrl: string;
  pendingDelete: boolean;
  isPublic: boolean;
  resolution: Resolution;
  pendingWhipInputs: unknown[];
  swapDurationMs: number;
  swapOutgoingEnabled: boolean;
  swapFadeInDurationMs: number;
  swapFadeOutDurationMs: number;
  isRecording: boolean;
}

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
