import type { ControlPanelActions } from './actions-context';
import type { StorageClient } from '@/lib/storage-client';
import type { ShaderConfig } from '@/lib/types';
import {
  getRoomInfo,
  updateRoom,
  updateInput as updateInputAction,
  removeInput as removeInputAction,
  disconnectInput,
  connectInput,
  hideInput as hideInputAction,
  showInput as showInputAction,
  addTwitchInput,
  addKickInput,
  addMP4Input,
  addAudioInput,
  addImageInput,
  addTextInput,
  addSnakeGameInput,
  addHlsInput,
  addCameraInput,
  deleteRoom,
  startRecording,
  stopRecording,
  getRecordings,
  getRoomRecordings,
  getAvailableShaders,
  getTwitchSuggestions,
  getKickSuggestions,
  getMP4Suggestions,
  getPictureSuggestions,
  getAudioSuggestions,
  acknowledgeWhipInput,
  setPendingWhipInputs,
  restartMp4Input,
  saveRemoteConfig,
  listRemoteConfigs,
  loadRemoteConfig,
  deleteRemoteConfig,
  saveShaderPreset,
  listShaderPresets,
  loadShaderPreset,
  updateShaderPreset,
  deleteShaderPreset,
  saveDashboardLayout,
  listDashboardLayouts,
  loadDashboardLayout,
  deleteDashboardLayout,
  saveHlsStream,
  listHlsStreams,
  loadHlsStream,
  updateHlsStream,
  deleteHlsStream,
  restartService,
  restartSmelter,
} from '@/app/actions/actions';

// id for browser session.  Sent as `x-source-id` on every update request
export const SESSION_SOURCE_ID =
  typeof crypto !== 'undefined' ? crypto.randomUUID() : undefined;

const configStorage: StorageClient<object> = {
  save: saveRemoteConfig,
  list: listRemoteConfigs,
  load: loadRemoteConfig,
  update: (_fileName, name, payload) => saveRemoteConfig(name, payload),
  remove: deleteRemoteConfig,
};

const shaderPresetStorage: StorageClient<ShaderConfig[]> = {
  save: saveShaderPreset,
  list: listShaderPresets,
  load: loadShaderPreset,
  update: updateShaderPreset,
  remove: deleteShaderPreset,
};

const dashboardLayoutStorage: StorageClient<object> = {
  save: saveDashboardLayout,
  list: listDashboardLayouts,
  load: loadDashboardLayout,
  update: (_fileName, name, payload) => saveDashboardLayout(name, payload),
  remove: deleteDashboardLayout,
};

const hlsStreamStorage: StorageClient<{ url: string }> = {
  save: saveHlsStream,
  list: listHlsStreams,
  load: loadHlsStream,
  update: updateHlsStream,
  remove: deleteHlsStream,
};

export const defaultActions: ControlPanelActions = {
  getRoomInfo,
  updateRoom,
  updateInput: (roomId, inputId, opts) =>
    updateInputAction(roomId, inputId, opts, SESSION_SOURCE_ID),
  removeInput: (roomId, inputId) =>
    removeInputAction(roomId, inputId, SESSION_SOURCE_ID),
  disconnectInput,
  connectInput,
  hideInput: (roomId, inputId) =>
    hideInputAction(roomId, inputId, SESSION_SOURCE_ID),
  showInput: (roomId, inputId) =>
    showInputAction(roomId, inputId, SESSION_SOURCE_ID),
  addTwitchInput,
  addKickInput,
  addMP4Input,
  addAudioInput,
  addImageInput,
  addTextInput,
  addSnakeGameInput,
  addHlsInput,
  addCameraInput,
  deleteRoom,
  startRecording,
  stopRecording,
  getRecordings,
  getRoomRecordings,
  getAvailableShaders,
  getTwitchSuggestions,
  getKickSuggestions,
  getMP4Suggestions,
  getPictureSuggestions,
  getAudioSuggestions,
  restartMp4Input,
  acknowledgeWhipInput,
  setPendingWhipInputs,
  configStorage,
  shaderPresetStorage,
  dashboardLayoutStorage,
  hlsStreamStorage,
  restartService,
  restartSmelter,
};
