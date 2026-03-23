import type {
  Resolution,
  PendingWhipInputData,
  RoomNameEntry,
} from '@smelter-editor/types';
import type { Input } from './input';
import type { Layer, Layout } from './layout';

export type {
  PendingWhipInputData,
  RoomNameEntry,
} from '@smelter-editor/types';

export type RoomState = {
  inputs: Input[];
  layers: Layer[];
  /** @deprecated Kept for room-config presets and voice commands; use `layers` for live layout. */
  layout?: Layout;
  whepUrl: string;
  roomName?: RoomNameEntry;
  pendingDelete?: boolean;
  isPublic?: boolean;
  resolution?: Resolution;
  swapDurationMs?: number;
  swapOutgoingEnabled?: boolean;
  swapFadeInDurationMs?: number;
  swapFadeOutDurationMs?: number;
  newsStripFadeDuringSwap?: boolean;
  newsStripEnabled?: boolean;
  pendingWhipInputs?: PendingWhipInputData[];
  isRecording?: boolean;
  isFrozen?: boolean;
};

export type AddInputResponse = {
  inputId: string;
  bearerToken: string;
  whipUrl: string;
};

export type ChannelSuggestion = {
  streamId: string;
  displayName: string;
  title: string;
  category: string;
};

export type InputSuggestions = {
  twitch: ChannelSuggestion[];
};

export type KickSuggestions = {
  kick: ChannelSuggestion[];
};

export type MP4Suggestions = {
  mp4s: string[];
};

export type PictureSuggestions = {
  pictures: string[];
};

export type CreateRoomOptions = {
  initInputs?: import('./input').RegisterInputOptions[];
  skipDefaultInputs?: boolean;
  resolution?: import('@smelter-editor/types').ResolutionPreset | Resolution;
};

export type UpdateRoomOptions = {
  inputOrder?: string[];
  layers?: Layer[];
  /** @deprecated Kept for room-config presets and voice commands; use `layers` for live layout. */
  layout?: Layout;
  isPublic?: boolean;
  swapDurationMs?: number;
  swapOutgoingEnabled?: boolean;
  swapFadeInDurationMs?: number;
  swapFadeOutDurationMs?: number;
  newsStripFadeDuringSwap?: boolean;
  newsStripEnabled?: boolean;
};

export type StartRecordingResponse = {
  status: 'recording' | 'error';
  fileName?: string;
  message?: string;
};

export type StopRecordingResponse = {
  status: 'stopped' | 'error';
  fileName?: string;
  downloadUrl?: string;
  message?: string;
};

export type RecordingInfo = {
  fileName: string;
  roomId: string;
  createdAt: number;
  size: number;
};

/** @deprecated Use `SavedItemInfo` from `@/lib/storage-client` instead */
export type { SavedItemInfo as SavedConfigInfo } from '../storage-client';
