import type {
  InputDisplayProperties,
  TextInputProperties,
  AbsolutePositionProperties,
  CropProperties,
  BorderProperties,
  SnakeGameDisplayProperties,
  InputOrientation,
} from "./input.js";
import type { YoloSearchConfig } from "./yolo.js";

// Allow `null` as an explicit reset sentinel for absolute-position and crop
// fields.  When the server receives `null` it clears the stored value back to
// `undefined` (matches the pre-play snapshot), which is what the timeline
// restore path needs to avoid sticky absolute-position state after the
// timeline finishes playing.
type NullableAbsolutePositionProperties = {
  [K in keyof AbsolutePositionProperties]: AbsolutePositionProperties[K] | null;
};

type NullableCropProperties = {
  [K in keyof CropProperties]: CropProperties[K] | null;
};

export type UpdateInputOptions = {
  title: string;
  attachedInputIds: string[];
  activeTransition: {
    type: string;
    durationMs: number;
    direction: "in" | "out";
  };
  orientation: InputOrientation;
  yoloSearchConfig: YoloSearchConfig | null;
  nativeWidth: number;
  nativeHeight: number;
} & InputDisplayProperties &
  TextInputProperties &
  NullableAbsolutePositionProperties &
  NullableCropProperties &
  BorderProperties &
  SnakeGameDisplayProperties;

export type RegisterInputOptions =
  | { type: "twitch-channel"; channelId: string }
  | { type: "kick-channel"; channelId: string }
  | { type: "hls"; url: string; sideChannelEnabled?: boolean }
  | {
      type: "whip";
      username: string;
      orientation?: InputOrientation;
      nativeWidth?: number;
      nativeHeight?: number;
      sideChannelEnabled?: boolean;
    }
  | {
      type: "local-mp4";
      source: { fileName?: string; audioFileName?: string; url?: string };
      sideChannelEnabled?: boolean;
    }
  | { type: "image"; fileName?: string; imageId?: string }
  | {
      type: "text-input";
      text: string;
      textAlign?: "left" | "center" | "right";
      textColor?: string;
      textMaxLines?: number;
      textScrollEnabled?: boolean;
      textScrollSpeed?: number;
      textScrollLoop?: boolean;
      textFontSize?: number;
    }
  | { type: "game"; title?: string }
  | { type: "hands"; sourceInputId: string };

export type PendingWhipInputData = {
  id: string;
  title: string;
  position: number;
} & InputDisplayProperties;
