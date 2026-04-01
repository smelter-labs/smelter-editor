'use server';

import type { SpawnOptions } from 'node:child_process';
import { spawn as nodeSpawn } from 'node:child_process';
import { assert } from 'node:console';
import type { Resolution, ResolutionPreset } from '@/lib/resolution';
import { createSmelterApiClient } from '@/lib/api-client';
import type {
  AddInputResponse,
  AvailableShader,
  PendingWhipInputData,
  RoomState,
  RegisterInputOptions,
  UpdateInputOptions,
  InputSuggestions,
  KickSuggestions,
  MP4Suggestions,
  PictureSuggestions,
  AudioSuggestions,
  UpdateRoomOptions,
  StartRecordingResponse,
  StopRecordingResponse,
  RecordingInfo,
  RoomNameEntry,
  ShaderConfig,
} from '@/lib/types';
import type { SavedItemInfo, StorageResult } from '@/lib/storage-client';
import type { TimelineConfig } from '@smelter-editor/types';

const BASE_URL = process.env.SMELTER_EDITOR_SERVER_URL;

assert(BASE_URL);

const client = createSmelterApiClient(BASE_URL!);

export async function createNewRoom(
  initInputs: RegisterInputOptions[],
  skipDefaultInputs: boolean = false,
  resolution?: ResolutionPreset | Resolution,
): Promise<{
  roomId: string;
  roomName: RoomNameEntry;
  whepUrl: string;
  resolution: Resolution;
}> {
  return client.createNewRoom(initInputs, skipDefaultInputs, resolution);
}

export async function updateRoom(
  roomId: string,
  opts: UpdateRoomOptions,
): Promise<{ roomId: string; whepUrl: string }> {
  return client.updateRoom(roomId, opts);
}

export async function getRoomInfo(
  roomId: string,
): Promise<RoomState | 'not-found'> {
  return client.getRoomInfo(roomId);
}

export async function startRecording(
  roomId: string,
): Promise<StartRecordingResponse> {
  return client.startRecording(roomId);
}

export async function stopRecording(
  roomId: string,
): Promise<StopRecordingResponse> {
  return client.stopRecording(roomId);
}

export async function pauseTimeline(
  roomId: string,
): Promise<{ playheadMs: number; isPaused: true }> {
  return client.pauseTimeline(roomId);
}

export async function getRecordings(): Promise<RecordingInfo[]> {
  return client.getRecordings();
}

export async function getRoomRecordings(
  roomId: string,
): Promise<RecordingInfo[]> {
  return client.getRoomRecordings(roomId);
}

export async function getTwitchSuggestions(): Promise<InputSuggestions> {
  return client.getTwitchSuggestions();
}

export async function getMP4Suggestions(): Promise<MP4Suggestions> {
  return client.getMP4Suggestions();
}

export async function getKickSuggestions(): Promise<KickSuggestions> {
  return client.getKickSuggestions();
}

export async function getPictureSuggestions(): Promise<PictureSuggestions> {
  return client.getPictureSuggestions();
}

export async function getAudioSuggestions(): Promise<AudioSuggestions> {
  return client.getAudioSuggestions();
}

export async function addTwitchInput(roomId: string, channelId: string) {
  return client.addTwitchInput(roomId, channelId);
}

export async function addKickInput(roomId: string, channelId: string) {
  return client.addKickInput(roomId, channelId);
}

export async function addMP4Input(roomId: string, mp4FileName: string) {
  return client.addMP4Input(roomId, mp4FileName);
}

export async function addAudioInput(roomId: string, audioFileName: string) {
  return client.addAudioInput(roomId, audioFileName);
}

export async function addImageInput(roomId: string, imageFileNameOrId: string) {
  return client.addImageInput(roomId, imageFileNameOrId);
}

export async function addTextInput(
  roomId: string,
  text: string,
  textAlign: 'left' | 'center' | 'right' = 'left',
) {
  return client.addTextInput(roomId, text, textAlign);
}

export async function addSnakeGameInput(roomId: string, title?: string) {
  return client.addSnakeGameInput(roomId, title);
}

export async function addHandsInput(roomId: string, sourceInputId: string) {
  return client.addHandsInput(roomId, sourceInputId);
}

export async function addHlsInput(roomId: string, url: string) {
  return client.addHlsInput(roomId, url);
}

export async function removeInput(
  roomId: string,
  inputId: string,
  sourceId?: string,
) {
  return client.removeInput(roomId, inputId, sourceId);
}

export async function deleteRoom(roomId: string) {
  return client.deleteRoom(roomId);
}

export async function addCameraInput(
  roomId: string,
  username?: string,
): Promise<AddInputResponse> {
  return client.addCameraInput(roomId, username);
}

export async function acknowledgeWhipInput(
  roomId: string,
  inputId: string,
): Promise<void> {
  return client.acknowledgeWhipInput(roomId, inputId);
}

export async function setPendingWhipInputs(
  roomId: string,
  pendingWhipInputs: PendingWhipInputData[],
): Promise<void> {
  return client.setPendingWhipInputs(roomId, pendingWhipInputs);
}

// ── Config storage ───────────────────────────────────────────
export async function saveRemoteConfig(
  name: string,
  config: object,
): Promise<StorageResult<{ fileName: string; name: string }>> {
  return client.configStorage.save(name, config);
}

export async function listRemoteConfigs(): Promise<
  StorageResult<{ items: SavedItemInfo[] }>
> {
  return client.configStorage.list();
}

export async function loadRemoteConfig(
  fileName: string,
): Promise<StorageResult<{ name: string; data: object; savedAt: string }>> {
  return client.configStorage.load(fileName);
}

export async function deleteRemoteConfig(
  fileName: string,
): Promise<StorageResult> {
  return client.configStorage.remove(fileName);
}

// ── Shader preset storage ────────────────────────────────────
export async function saveShaderPreset(
  name: string,
  shaders: ShaderConfig[],
): Promise<StorageResult<{ fileName: string; name: string }>> {
  return client.shaderPresetStorage.save(name, shaders);
}

export async function listShaderPresets(): Promise<
  StorageResult<{ items: SavedItemInfo[] }>
> {
  return client.shaderPresetStorage.list();
}

export async function loadShaderPreset(
  fileName: string,
): Promise<
  StorageResult<{ name: string; data: ShaderConfig[]; savedAt: string }>
> {
  return client.shaderPresetStorage.load(fileName);
}

export async function updateShaderPreset(
  fileName: string,
  name: string,
  shaders: ShaderConfig[],
): Promise<StorageResult<{ fileName: string; name: string }>> {
  return client.shaderPresetStorage.update(fileName, name, shaders);
}

export async function deleteShaderPreset(
  fileName: string,
): Promise<StorageResult> {
  return client.shaderPresetStorage.remove(fileName);
}

// ── Dashboard layout storage ─────────────────────────────────
export async function saveDashboardLayout(
  name: string,
  layout: object,
): Promise<StorageResult<{ fileName: string; name: string }>> {
  return client.dashboardLayoutStorage.save(name, layout);
}

export async function listDashboardLayouts(): Promise<
  StorageResult<{ items: SavedItemInfo[] }>
> {
  return client.dashboardLayoutStorage.list();
}

export async function loadDashboardLayout(
  fileName: string,
): Promise<StorageResult<{ name: string; data: object; savedAt: string }>> {
  return client.dashboardLayoutStorage.load(fileName);
}

export async function deleteDashboardLayout(
  fileName: string,
): Promise<StorageResult> {
  return client.dashboardLayoutStorage.remove(fileName);
}

// ── Presentation config storage ──────────────────────────────
export async function savePresentationConfig(
  name: string,
  presentationConfig: object,
): Promise<StorageResult<{ fileName: string; name: string }>> {
  return client.presentationConfigStorage.save(name, presentationConfig);
}

export async function listPresentationConfigs(): Promise<
  StorageResult<{ items: SavedItemInfo[] }>
> {
  return client.presentationConfigStorage.list();
}

export async function loadPresentationConfig(
  fileName: string,
): Promise<
  StorageResult<{ name: string; data: object; savedAt: string }>
> {
  return client.presentationConfigStorage.load(fileName);
}

export async function deletePresentationConfig(
  fileName: string,
): Promise<StorageResult> {
  return client.presentationConfigStorage.remove(fileName);
}

// ── HLS stream storage ──────────────────────────────────────
export async function saveHlsStream(
  name: string,
  stream: { url: string },
): Promise<StorageResult<{ fileName: string; name: string }>> {
  return client.hlsStreamStorage.save(name, stream);
}

export async function listHlsStreams(): Promise<
  StorageResult<{ items: SavedItemInfo[] }>
> {
  return client.hlsStreamStorage.list();
}

export async function loadHlsStream(
  fileName: string,
): Promise<
  StorageResult<{ name: string; data: { url: string }; savedAt: string }>
> {
  return client.hlsStreamStorage.load(fileName);
}

export async function updateHlsStream(
  fileName: string,
  name: string,
  stream: { url: string },
): Promise<StorageResult<{ fileName: string; name: string }>> {
  return client.hlsStreamStorage.update(fileName, name, stream);
}

export async function deleteHlsStream(
  fileName: string,
): Promise<StorageResult> {
  return client.hlsStreamStorage.remove(fileName);
}

export async function getAllRooms(): Promise<any> {
  return client.getAllRooms();
}

export async function updateInput(
  roomId: string,
  inputId: string,
  opts: Partial<UpdateInputOptions>,
  sourceId?: string,
) {
  return client.updateInput(roomId, inputId, opts, sourceId);
}

export async function disconnectInput(roomId: string, inputId: string) {
  return client.disconnectInput(roomId, inputId);
}

export async function connectInput(roomId: string, inputId: string) {
  return client.connectInput(roomId, inputId);
}

export async function hideInput(
  roomId: string,
  inputId: string,
  sourceIdOrTransition?:
    | string
    | {
        type: string;
        durationMs: number;
        direction: 'in' | 'out';
      },
) {
  return client.hideInput(roomId, inputId, sourceIdOrTransition);
}

export async function showInput(
  roomId: string,
  inputId: string,
  sourceIdOrTransition?:
    | string
    | {
        type: string;
        durationMs: number;
        direction: 'in' | 'out';
      },
) {
  return client.showInput(roomId, inputId, sourceIdOrTransition);
}

export async function toggleMotionDetection(
  roomId: string,
  inputId: string,
  enabled: boolean,
): Promise<void> {
  return client.toggleMotionDetection(roomId, inputId, enabled);
}

export async function setAudioAnalysisEnabled(
  roomId: string,
  enabled: boolean,
): Promise<void> {
  return client.setAudioAnalysisEnabled(roomId, enabled);
}

export async function restartMp4Input(
  roomId: string,
  inputId: string,
  playFromMs: number,
  loop: boolean,
): Promise<void> {
  return client.restartMp4Input(roomId, inputId, playFromMs, loop);
}

export async function getMp4Duration(fileName: string): Promise<number> {
  return client.getMp4Duration(fileName);
}

export async function getAudioDuration(fileName: string): Promise<number> {
  return client.getAudioDuration(fileName);
}

export async function restartService(): Promise<void> {
  try {
    await spawn('bash', ['-c', 'sudo systemctl restart smelter.service'], {});
  } catch {
    // ignore
  }
  await new Promise<void>((res) => {
    setTimeout(() => res(), 5000);
  });
}

export async function restartSmelter(): Promise<void> {
  await client.restartSmelter();
}

export async function getAvailableShaders(): Promise<AvailableShader[]> {
  return client.getAvailableShaders();
}

// ── Timeline playback ────────────────────────────────────────

export async function startTimelinePlayback(
  roomId: string,
  config: TimelineConfig,
  fromMs?: number,
): Promise<{ status: string }> {
  return client.startTimelinePlayback(roomId, config, fromMs);
}

export async function stopTimelinePlayback(
  roomId: string,
): Promise<{ status: string }> {
  return client.stopTimelinePlayback(roomId);
}

export async function seekTimeline(
  roomId: string,
  ms: number,
): Promise<{ status: string }> {
  return client.seekTimeline(roomId, ms);
}

export async function applyTimelineState(
  roomId: string,
  config: TimelineConfig,
  playheadMs: number,
): Promise<{ status: string }> {
  return client.applyTimelineState(roomId, config, playheadMs);
}

function spawn(
  command: string,
  args: string[],
  options: SpawnOptions,
): Promise<void> {
  const child = nodeSpawn(command, args, {
    stdio: 'inherit',
    ...options,
  });
  return new Promise<void>((res, rej) => {
    child.on('error', (err) => {
      rej(err);
    });
    child.on('exit', (code) => {
      if (code === 0) {
        res();
      } else {
        rej(new Error(`Exit with exit code ${code}`));
      }
    });
  });
}
