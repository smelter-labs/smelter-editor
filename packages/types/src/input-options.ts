import type {
  InputDisplayProperties,
  TextInputProperties,
  AbsolutePositionProperties,
  CropProperties,
  BorderProperties,
  SnakeGameDisplayProperties,
} from './input.js';

export type UpdateInputOptions = {
  title: string;
  attachedInputIds: string[];
  activeTransition: {
    type: string;
    durationMs: number;
    direction: 'in' | 'out';
  };
} & InputDisplayProperties &
  TextInputProperties &
  AbsolutePositionProperties &
  CropProperties &
  BorderProperties &
  SnakeGameDisplayProperties;

export type RegisterInputOptions =
  | { type: 'twitch-channel'; channelId: string }
  | { type: 'kick-channel'; channelId: string }
  | { type: 'whip'; username: string }
  | { type: 'local-mp4'; source: { fileName?: string; url?: string } }
  | { type: 'image'; fileName?: string; imageId?: string }
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
  | { type: 'game'; title?: string }
  | { type: 'hands'; sourceInputId: string };

export type PendingWhipInputData = {
  id: string;
  title: string;
  position: number;
} & InputDisplayProperties;
