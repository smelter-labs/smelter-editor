import type { Resolution } from '@smelter-editor/types';
import type { ShaderConfig } from './shader';
import type { Input, InputOrientation } from './input';
import type { Layout } from './layout';

export type PendingWhipInputData = {
  id: string;
  title: string;
  volume: number;
  showTitle: boolean;
  shaders: ShaderConfig[];
  orientation: InputOrientation;
  position: number;
};

export type RoomNameEntry = {
  pl: string;
  en: string;
};

export type RoomState = {
  inputs: Input[];
  layout: Layout;
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
