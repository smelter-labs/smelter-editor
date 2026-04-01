import type {
  Resolution,
  ResolutionPreset,
  PendingWhipInputData,
  RoomNameEntry,
} from '@smelter-editor/types';
import type { Input, RegisterInputOptions } from './input';
import type { Layer } from './layout';

export type {
  PendingWhipInputData,
  RoomNameEntry,
} from '@smelter-editor/types';

export type RoomState = {
  inputs: Input[];
  layers: Layer[];
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
  audioAnalysisEnabled?: boolean;
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
  thumbnailUrl?: string;
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

type CreateRoomOptions = {
  initInputs?: RegisterInputOptions[];
  skipDefaultInputs?: boolean;
  resolution?: ResolutionPreset | Resolution;
};

export type UpdateRoomOptions = {
  inputOrder?: string[];
  layers?: Layer[];
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
;
