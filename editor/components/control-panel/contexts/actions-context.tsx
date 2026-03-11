'use client';

import { createContext, useContext } from 'react';
import type {
  AddInputResponse,
  AvailableShader,
  InputSuggestions,
  KickSuggestions,
  MP4Suggestions,
  PendingWhipInputData,
  PictureSuggestions,
  RecordingInfo,
  RoomState,
  ShaderConfig,
  StartRecordingResponse,
  StopRecordingResponse,
  UpdateInputOptions,
  UpdateRoomOptions,
} from '@/lib/types';
import type { StorageClient } from '@/lib/storage-client';

export interface ControlPanelActions {
  getRoomInfo(roomId: string): Promise<RoomState | 'not-found'>;
  updateRoom(
    roomId: string,
    opts: UpdateRoomOptions,
  ): Promise<{ roomId: string; whepUrl: string }>;
  updateInput(
    roomId: string,
    inputId: string,
    opts: Partial<UpdateInputOptions>,
  ): Promise<any>;
  removeInput(roomId: string, inputId: string): Promise<any>;
  disconnectInput(roomId: string, inputId: string): Promise<any>;
  connectInput(roomId: string, inputId: string): Promise<any>;
  hideInput(roomId: string, inputId: string): Promise<any>;
  showInput(roomId: string, inputId: string): Promise<any>;

  addTwitchInput(roomId: string, channelId: string): Promise<any>;
  addKickInput(roomId: string, channelId: string): Promise<any>;
  addMP4Input(roomId: string, mp4FileName: string): Promise<any>;
  addImageInput(roomId: string, imageFileNameOrId: string): Promise<any>;
  addTextInput(
    roomId: string,
    text: string,
    textAlign?: 'left' | 'center' | 'right',
  ): Promise<any>;
  addSnakeGameInput(roomId: string, title?: string): Promise<any>;
  addCameraInput(roomId: string, username?: string): Promise<AddInputResponse>;

  deleteRoom(roomId: string): Promise<any>;

  startRecording(roomId: string): Promise<StartRecordingResponse>;
  stopRecording(roomId: string): Promise<StopRecordingResponse>;
  getRecordings(): Promise<RecordingInfo[]>;
  getRoomRecordings(roomId: string): Promise<RecordingInfo[]>;

  getAvailableShaders(): Promise<AvailableShader[]>;

  getTwitchSuggestions(): Promise<InputSuggestions>;
  getKickSuggestions(): Promise<KickSuggestions>;
  getMP4Suggestions(): Promise<MP4Suggestions>;
  getPictureSuggestions(): Promise<PictureSuggestions>;

  restartMp4Input(
    roomId: string,
    inputId: string,
    playFromMs: number,
    loop: boolean,
  ): Promise<void>;

  acknowledgeWhipInput(roomId: string, inputId: string): Promise<void>;
  setPendingWhipInputs(
    roomId: string,
    pendingWhipInputs: PendingWhipInputData[],
  ): Promise<void>;

  configStorage: StorageClient<object>;
  shaderPresetStorage: StorageClient<ShaderConfig[]>;
  dashboardLayoutStorage: StorageClient<object>;

  restartService(): Promise<void>;
}

const ActionsContext = createContext<ControlPanelActions | null>(null);

export function ActionsProvider({
  actions,
  children,
}: {
  actions: ControlPanelActions;
  children: React.ReactNode;
}) {
  return (
    <ActionsContext.Provider value={actions}>
      {children}
    </ActionsContext.Provider>
  );
}

export function useActions(): ControlPanelActions {
  const ctx = useContext(ActionsContext);
  if (!ctx) {
    throw new Error('useActions must be used within an ActionsProvider');
  }
  return ctx;
}
