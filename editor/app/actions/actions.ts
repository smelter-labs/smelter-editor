'use server';

import type { SpawnOptions } from 'node:child_process';
import { spawn as nodeSpawn } from 'node:child_process';
import type { Resolution, ResolutionPreset } from '@/lib/resolution';
import { createSmelterApiClient } from '@/lib/api-client';
import { getServerSideServerUrl } from '@/lib/server-url.server';
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

async function getClient() {
  const baseUrl = await getServerSideServerUrl();
  if (!baseUrl) {
    throw new Error('Missing SMELTER_EDITOR_SERVER_URL');
  }

  return createSmelterApiClient(baseUrl);
}

function isServerUnavailableError(err: unknown): boolean {
  const maybeError = err as { status?: number; code?: string } | undefined;
  return maybeError?.status === 503 || maybeError?.code === 'ECONNREFUSED';
}

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
  return (await getClient()).createNewRoom(initInputs, skipDefaultInputs, resolution);
}

export async function updateRoom(
  roomId: string,
  opts: UpdateRoomOptions,
  sourceId?: string,
): Promise<{ roomId: string; whepUrl: string }> {
  return (await getClient()).updateRoom(roomId, opts, sourceId);
}

export async function getRoomInfo(
  roomId: string,
): Promise<RoomState | 'not-found'> {
  return (await getClient()).getRoomInfo(roomId);
}

export async function startRecording(
  roomId: string,
): Promise<StartRecordingResponse> {
  return (await getClient()).startRecording(roomId);
}

export async function stopRecording(
  roomId: string,
): Promise<StopRecordingResponse> {
  return (await getClient()).stopRecording(roomId);
}

export async function pauseTimeline(
  roomId: string,
): Promise<{ playheadMs: number; isPaused: true }> {
  return (await getClient()).pauseTimeline(roomId);
}

export async function getRecordings(): Promise<RecordingInfo[]> {
  return (await getClient()).getRecordings();
}

export async function getRoomRecordings(
  roomId: string,
): Promise<RecordingInfo[]> {
  return (await getClient()).getRoomRecordings(roomId);
}

export async function getTwitchSuggestions(): Promise<InputSuggestions> {
  try {
    return (await getClient()).getTwitchSuggestions();
  } catch (err) {
    if (isServerUnavailableError(err)) {
      return { twitch: [] };
    }
    throw err;
  }
}

export async function getMP4Suggestions(): Promise<MP4Suggestions> {
  try {
    return (await getClient()).getMP4Suggestions();
  } catch (err) {
    if (isServerUnavailableError(err)) {
      return { mp4s: [] };
    }
    throw err;
  }
}

export async function getKickSuggestions(): Promise<KickSuggestions> {
  try {
    return (await getClient()).getKickSuggestions();
  } catch (err) {
    if (isServerUnavailableError(err)) {
      return { kick: [] };
    }
    throw err;
  }
}

export async function getPictureSuggestions(): Promise<PictureSuggestions> {
  try {
    return (await getClient()).getPictureSuggestions();
  } catch (err) {
    if (isServerUnavailableError(err)) {
      return { pictures: [] };
    }
    throw err;
  }
}

export async function getAudioSuggestions(): Promise<AudioSuggestions> {
  try {
    return (await getClient()).getAudioSuggestions();
  } catch (err) {
    if (isServerUnavailableError(err)) {
      return { audios: [] };
    }
    throw err;
  }
}

export async function addTwitchInput(roomId: string, channelId: string) {
  return (await getClient()).addTwitchInput(roomId, channelId);
}

export async function addKickInput(roomId: string, channelId: string) {
  return (await getClient()).addKickInput(roomId, channelId);
}

export async function addMP4Input(roomId: string, mp4FileName: string) {
  return (await getClient()).addMP4Input(roomId, mp4FileName);
}

export async function addAudioInput(roomId: string, audioFileName: string) {
  return (await getClient()).addAudioInput(roomId, audioFileName);
}

export async function addImageInput(roomId: string, imageFileNameOrId: string) {
  return (await getClient()).addImageInput(roomId, imageFileNameOrId);
}

export async function addTextInput(
  roomId: string,
  text: string,
  textAlign: 'left' | 'center' | 'right' = 'left',
) {
  return (await getClient()).addTextInput(roomId, text, textAlign);
}

export async function addSnakeGameInput(roomId: string, title?: string) {
  return (await getClient()).addSnakeGameInput(roomId, title);
}

export async function addHandsInput(roomId: string, sourceInputId: string) {
  return (await getClient()).addHandsInput(roomId, sourceInputId);
}

export async function addHlsInput(roomId: string, url: string) {
  return (await getClient()).addHlsInput(roomId, url);
}

export async function removeInput(
  roomId: string,
  inputId: string,
  sourceId?: string,
) {
  return (await getClient()).removeInput(roomId, inputId, sourceId);
}

export async function deleteRoom(roomId: string) {
  return (await getClient()).deleteRoom(roomId);
}

export async function addCameraInput(
  roomId: string,
  username?: string,
): Promise<AddInputResponse> {
  return (await getClient()).addCameraInput(roomId, username);
}

export async function acknowledgeWhipInput(
  roomId: string,
  inputId: string,
): Promise<void> {
  return (await getClient()).acknowledgeWhipInput(roomId, inputId);
}

export async function setPendingWhipInputs(
  roomId: string,
  pendingWhipInputs: PendingWhipInputData[],
): Promise<void> {
  return (await getClient()).setPendingWhipInputs(roomId, pendingWhipInputs);
}

// ── Config storage ───────────────────────────────────────────
export async function saveRemoteConfig(
  name: string,
  config: object,
): Promise<StorageResult<{ fileName: string; name: string }>> {
  return (await getClient()).configStorage.save(name, config);
}

export async function listRemoteConfigs(): Promise<
  StorageResult<{ items: SavedItemInfo[] }>
> {
  return (await getClient()).configStorage.list();
}

export async function loadRemoteConfig(
  fileName: string,
): Promise<StorageResult<{ name: string; data: object; savedAt: string }>> {
  return (await getClient()).configStorage.load(fileName);
}

export async function deleteRemoteConfig(
  fileName: string,
): Promise<StorageResult> {
  return (await getClient()).configStorage.remove(fileName);
}

// ── Shader preset storage ────────────────────────────────────
export async function saveShaderPreset(
  name: string,
  shaders: ShaderConfig[],
): Promise<StorageResult<{ fileName: string; name: string }>> {
  return (await getClient()).shaderPresetStorage.save(name, shaders);
}

export async function listShaderPresets(): Promise<
  StorageResult<{ items: SavedItemInfo[] }>
> {
  return (await getClient()).shaderPresetStorage.list();
}

export async function loadShaderPreset(
  fileName: string,
): Promise<
  StorageResult<{ name: string; data: ShaderConfig[]; savedAt: string }>
> {
  return (await getClient()).shaderPresetStorage.load(fileName);
}

export async function updateShaderPreset(
  fileName: string,
  name: string,
  shaders: ShaderConfig[],
): Promise<StorageResult<{ fileName: string; name: string }>> {
  return (await getClient()).shaderPresetStorage.update(fileName, name, shaders);
}

export async function deleteShaderPreset(
  fileName: string,
): Promise<StorageResult> {
  return (await getClient()).shaderPresetStorage.remove(fileName);
}

// ── Dashboard layout storage ─────────────────────────────────
export async function saveDashboardLayout(
  name: string,
  layout: object,
): Promise<StorageResult<{ fileName: string; name: string }>> {
  return (await getClient()).dashboardLayoutStorage.save(name, layout);
}

export async function listDashboardLayouts(): Promise<
  StorageResult<{ items: SavedItemInfo[] }>
> {
  return (await getClient()).dashboardLayoutStorage.list();
}

export async function loadDashboardLayout(
  fileName: string,
): Promise<StorageResult<{ name: string; data: object; savedAt: string }>> {
  return (await getClient()).dashboardLayoutStorage.load(fileName);
}

export async function deleteDashboardLayout(
  fileName: string,
): Promise<StorageResult> {
  return (await getClient()).dashboardLayoutStorage.remove(fileName);
}

// ── Presentation config storage ──────────────────────────────
export async function savePresentationConfig(
  name: string,
  presentationConfig: object,
): Promise<StorageResult<{ fileName: string; name: string }>> {
  return (await getClient()).presentationConfigStorage.save(name, presentationConfig);
}

export async function listPresentationConfigs(): Promise<
  StorageResult<{ items: SavedItemInfo[] }>
> {
  return (await getClient()).presentationConfigStorage.list();
}

export async function loadPresentationConfig(
  fileName: string,
): Promise<StorageResult<{ name: string; data: object; savedAt: string }>> {
  return (await getClient()).presentationConfigStorage.load(fileName);
}

export async function deletePresentationConfig(
  fileName: string,
): Promise<StorageResult> {
  return (await getClient()).presentationConfigStorage.remove(fileName);
}

// ── HLS stream storage ──────────────────────────────────────
export async function saveHlsStream(
  name: string,
  stream: { url: string },
): Promise<StorageResult<{ fileName: string; name: string }>> {
  return (await getClient()).hlsStreamStorage.save(name, stream);
}

export async function listHlsStreams(): Promise<
  StorageResult<{ items: SavedItemInfo[] }>
> {
  return (await getClient()).hlsStreamStorage.list();
}

export async function loadHlsStream(
  fileName: string,
): Promise<
  StorageResult<{ name: string; data: { url: string }; savedAt: string }>
> {
  return (await getClient()).hlsStreamStorage.load(fileName);
}

export async function updateHlsStream(
  fileName: string,
  name: string,
  stream: { url: string },
): Promise<StorageResult<{ fileName: string; name: string }>> {
  return (await getClient()).hlsStreamStorage.update(fileName, name, stream);
}

export async function deleteHlsStream(
  fileName: string,
): Promise<StorageResult> {
  return (await getClient()).hlsStreamStorage.remove(fileName);
}

export async function getAllRooms(): Promise<any> {
  return (await getClient()).getAllRooms();
}

export async function updateInput(
  roomId: string,
  inputId: string,
  opts: Partial<UpdateInputOptions>,
  sourceId?: string,
) {
  return (await getClient()).updateInput(roomId, inputId, opts, sourceId);
}

export async function disconnectInput(roomId: string, inputId: string) {
  return (await getClient()).disconnectInput(roomId, inputId);
}

export async function connectInput(roomId: string, inputId: string) {
  return (await getClient()).connectInput(roomId, inputId);
}

export async function resolveMissingLocalMp4(
  roomId: string,
  inputId: string,
  opts: { fileName?: string; audioFileName?: string },
) {
  return (await getClient()).resolveMissingLocalMp4(roomId, inputId, opts);
}

export async function resolveMissingImage(
  roomId: string,
  inputId: string,
  opts: { fileName: string },
) {
  return (await getClient()).resolveMissingImage(roomId, inputId, opts);
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
  return (await getClient()).hideInput(roomId, inputId, sourceIdOrTransition);
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
  return (await getClient()).showInput(roomId, inputId, sourceIdOrTransition);
}

export async function toggleMotionDetection(
  roomId: string,
  inputId: string,
  enabled: boolean,
): Promise<void> {
  return (await getClient()).toggleMotionDetection(roomId, inputId, enabled);
}

export async function setAudioAnalysisEnabled(
  roomId: string,
  enabled: boolean,
): Promise<void> {
  return (await getClient()).setAudioAnalysisEnabled(roomId, enabled);
}

export async function restartMp4Input(
  roomId: string,
  inputId: string,
  playFromMs: number,
  loop: boolean,
): Promise<void> {
  return (await getClient()).restartMp4Input(roomId, inputId, playFromMs, loop);
}

export async function getMp4Duration(fileName: string): Promise<number> {
  return (await getClient()).getMp4Duration(fileName);
}

export async function getAudioDuration(fileName: string): Promise<number> {
  return (await getClient()).getAudioDuration(fileName);
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
  return (await getClient()).restartSmelter();
}

export async function getAvailableShaders(): Promise<AvailableShader[]> {
  return (await getClient()).getAvailableShaders();
}

export async function getYoloModelInfo(
  serverUrl: string,
): Promise<{ classes: string[]; num_classes: number; model_file: string }> {
  return client.getYoloModelInfo(serverUrl);
}

// ── Timeline playback ────────────────────────────────────────

export async function startTimelinePlayback(
  roomId: string,
  config: TimelineConfig,
  fromMs?: number,
): Promise<{ status: string }> {
  return (await getClient()).startTimelinePlayback(roomId, config, fromMs);
}

export async function stopTimelinePlayback(
  roomId: string,
): Promise<{ status: string }> {
  return (await getClient()).stopTimelinePlayback(roomId);
}

export async function seekTimeline(
  roomId: string,
  ms: number,
): Promise<{ status: string }> {
  return (await getClient()).seekTimeline(roomId, ms);
}

export async function applyTimelineState(
  roomId: string,
  config: TimelineConfig,
  playheadMs: number,
): Promise<{ status: string }> {
  return (await getClient()).applyTimelineState(roomId, config, playheadMs);
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
