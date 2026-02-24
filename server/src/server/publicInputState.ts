import type { RoomInputState, InputOrientation } from './roomState';
import type { ShaderConfig } from '../shaders/shaders';

/** API DTO for a single input; single source of truth for RoomInputState → response mapping */
export type PublicInputState = {
  inputId: string;
  title: string;
  description: string;
  showTitle: boolean;
  sourceState: 'live' | 'offline' | 'unknown' | 'always-live';
  status: 'disconnected' | 'pending' | 'connected';
  volume: number;
  type: RoomInputState['type'];
  shaders: ShaderConfig[];
  orientation: InputOrientation;
  channelId?: string;
  imageId?: string;
  text?: string;
  textAlign?: 'left' | 'center' | 'right';
  textColor?: string;
  textMaxLines?: number;
  textScrollSpeed?: number;
  textScrollLoop?: boolean;
  textFontSize?: number;
  attachedInputIds?: string[];
  hidden?: boolean;
};

export function toPublicInputState(input: RoomInputState): PublicInputState {
  const base = {
    inputId: input.inputId,
    title: input.metadata.title,
    description: input.metadata.description,
    showTitle: input.showTitle,
    status: input.status,
    volume: input.volume,
    type: input.type,
    shaders: input.shaders,
    orientation: input.orientation,
    attachedInputIds: input.attachedInputIds,
    hidden: input.hidden,
  };
  switch (input.type) {
    case 'local-mp4':
      return { ...base, sourceState: 'always-live' as const };
    case 'image':
      return { ...base, sourceState: 'always-live' as const, imageId: input.imageId };
    case 'twitch-channel':
    case 'kick-channel':
      return {
        ...base,
        sourceState: input.monitor.isLive() ? 'live' : 'offline',
        channelId: input.channelId,
      };
    case 'whip':
      return {
        ...base,
        sourceState: input.monitor.isLive() ? 'live' : 'offline',
      };
    case 'text-input':
      return {
        ...base,
        sourceState: 'always-live' as const,
        text: input.text,
        textAlign: input.textAlign,
        textColor: input.textColor,
        textMaxLines: input.textMaxLines,
        textScrollSpeed: input.textScrollSpeed,
        textScrollLoop: input.textScrollLoop,
        textFontSize: input.textFontSize,
      };
    default:
      throw new Error('Unknown input state');
  }
}
