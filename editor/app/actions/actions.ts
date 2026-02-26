'use server';

import { AddInputResponse } from '@/components/control-panel/whip-input/utils/types';
import type { SpawnOptions } from 'node:child_process';
import { spawn as nodeSpawn } from 'node:child_process';
import { assert } from 'node:console';
import type { Resolution, ResolutionPreset } from '@/lib/resolution';

const BASE_URL = process.env.SMELTER_EDITOR_SERVER_URL;

assert(BASE_URL);

type ShaderParam = {
  name: string;
  type: string;
  minValue?: number;
  maxValue?: number;
  defaultValue?: number | string; // number for 'number' type, string (hex) for 'color' type
};

export type AvailableShader = {
  id: string;
  name: string;
  description: string;
  shaderFile: string;
  minValue: number;
  maxValue: number;
  defaultValue: number;
  params: ShaderParam[];
};

export type ShaderParamConfig = {
  paramName: string;
  paramValue: number | string;
};

export type ShaderConfig = {
  shaderName: string;
  shaderId: string;
  enabled: boolean;
  params: ShaderParamConfig[];
};

export type InputOrientation = 'horizontal' | 'vertical';

export type Input = {
  id: number;
  inputId: string;
  title: string;
  description: string;
  showTitle?: boolean;
  volume: number;
  type:
    | 'local-mp4'
    | 'twitch-channel'
    | 'kick-channel'
    | 'whip'
    | 'image'
    | 'text-input'
    | 'game';
  sourceState: 'live' | 'offline' | 'unknown' | 'always-live';
  status: 'disconnected' | 'pending' | 'connected';
  channelId?: string;
  imageId?: string;
  shaders: ShaderConfig[];
  orientation: InputOrientation;
  text?: string;
  textAlign?: 'left' | 'center' | 'right';
  textColor?: string;
  textMaxLines?: number;
  textScrollSpeed?: number;
  textScrollLoop?: boolean;
  textFontSize?: number;
  borderColor?: string;
  borderWidth?: number;
  attachedInputIds?: string[];
  hidden?: boolean;
  gameBackgroundColor?: string;
  gameCellGap?: number;
  gameBoardBorderColor?: string;
  gameBoardBorderWidth?: number;
};

export type RegisterInputOptions =
  | {
      type: 'twitch-channel';
      channelId: string;
    }
  | {
      type: 'kick-channel';
      channelId: string;
    }
  | {
      type: 'local-mp4';
      source: {
        fileName?: string;
        url?: string;
      };
    }
  | {
      type: 'text-input';
      text: string;
      textAlign?: 'left' | 'center' | 'right';
    }
  | {
      type: 'game';
      title?: string;
    };

export type PendingWhipInputData = {
  id: string;
  title: string;
  volume: number;
  showTitle: boolean;
  shaders: ShaderConfig[];
  orientation: InputOrientation;
  position: number;
};

export type RoomState = {
  inputs: Input[];
  layout: Layout;
  whepUrl: string;
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
};

export type Layout =
  | 'grid'
  | 'primary-on-left'
  | 'primary-on-top'
  | 'picture-in-picture'
  | 'wrapped'
  | 'wrapped-static'
  | 'transition'
  | 'picture-on-picture'
  | 'softu-tv';

export interface ChannelSuggestion {
  streamId: string;
  displayName: string;
  title: string;
  category: string;
}

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
  initInputs?: RegisterInputOptions[];
  skipDefaultInputs?: boolean;
  resolution?: ResolutionPreset | Resolution;
};

export async function createNewRoom(
  initInputs: RegisterInputOptions[],
  skipDefaultInputs: boolean = false,
  resolution?: ResolutionPreset | Resolution,
): Promise<{
  roomId: string;
  whepUrl: string;
  resolution: Resolution;
}> {
  return await sendSmelterRequest('post', '/room', {
    initInputs,
    skipDefaultInputs,
    resolution,
  });
}

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

export async function updateRoom(
  roomId: string,
  opts: UpdateRoomOptions,
): Promise<{
  roomId: string;
  whepUrl: string;
}> {
  return await sendSmelterRequest(
    'post',
    `/room/${encodeURIComponent(roomId)}`,
    opts,
  );
}

export async function getRoomInfo(
  roomId: string,
): Promise<RoomState | 'not-found'> {
  try {
    return await sendSmelterRequest(
      'get',
      `/room/${encodeURIComponent(roomId)}`,
    );
  } catch (err: any) {
    if (err.status === 404) {
      return 'not-found';
    }
    throw err;
  }
}

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

export async function startRecording(
  roomId: string,
): Promise<StartRecordingResponse> {
  return await sendSmelterRequest(
    'post',
    `/room/${encodeURIComponent(roomId)}/record/start`,
    {},
  );
}

export async function stopRecording(
  roomId: string,
): Promise<StopRecordingResponse> {
  return await sendSmelterRequest(
    'post',
    `/room/${encodeURIComponent(roomId)}/record/stop`,
    {},
  );
}

export type RecordingInfo = {
  fileName: string;
  roomId: string;
  createdAt: number;
  size: number;
};

export async function getRecordings(): Promise<RecordingInfo[]> {
  const data = await sendSmelterRequest('get', '/recordings');
  return data.recordings ?? [];
}

export async function getRoomRecordings(
  roomId: string,
): Promise<RecordingInfo[]> {
  const data = await sendSmelterRequest(
    'get',
    `/room/${encodeURIComponent(roomId)}/recordings`,
  );
  return data.recordings ?? [];
}

export async function getTwitchSuggestions(): Promise<InputSuggestions> {
  return await sendSmelterRequest('get', `/suggestions/twitch`);
}

export async function getMP4Suggestions(): Promise<MP4Suggestions> {
  return await sendSmelterRequest('get', `/suggestions/mp4s`);
}

export async function getKickSuggestions(): Promise<KickSuggestions> {
  return await sendSmelterRequest('get', `/suggestions/kick`);
}

export async function getPictureSuggestions(): Promise<PictureSuggestions> {
  return await sendSmelterRequest('get', `/suggestions/pictures`);
}

export async function addTwitchInput(roomId: string, channelId: string) {
  return await sendSmelterRequest(
    'post',
    `/room/${encodeURIComponent(roomId)}/input`,
    {
      type: 'twitch-channel',
      channelId: channelId,
    },
  );
}

export async function addKickInput(roomId: string, channelId: string) {
  return await sendSmelterRequest(
    'post',
    `/room/${encodeURIComponent(roomId)}/input`,
    {
      type: 'kick-channel',
      channelId: channelId,
    },
  );
}

export async function addMP4Input(roomId: string, mp4FileName: string) {
  return await sendSmelterRequest(
    'post',
    `/room/${encodeURIComponent(roomId)}/input`,
    { type: 'local-mp4', source: { fileName: mp4FileName, url: '' } },
  );
}

export async function addImageInput(roomId: string, imageFileNameOrId: string) {
  const isImageId = imageFileNameOrId.startsWith('pictures::');
  return await sendSmelterRequest(
    'post',
    `/room/${encodeURIComponent(roomId)}/input`,
    isImageId
      ? { type: 'image', imageId: imageFileNameOrId }
      : { type: 'image', fileName: imageFileNameOrId },
  );
}

export async function addTextInput(
  roomId: string,
  text: string,
  textAlign: 'left' | 'center' | 'right' = 'left',
) {
  return await sendSmelterRequest(
    'post',
    `/room/${encodeURIComponent(roomId)}/input`,
    { type: 'text-input', text, textAlign },
  );
}

export async function addGameInput(roomId: string, title?: string) {
  return await sendSmelterRequest(
    'post',
    `/room/${encodeURIComponent(roomId)}/input`,
    { type: 'game', title },
  );
}

export async function removeInput(roomId: string, inputId: string) {
  return await sendSmelterRequest(
    'delete',
    `/room/${encodeURIComponent(roomId)}/input/${encodeURIComponent(inputId)}`,
    {},
  );
}

export async function addCameraInput(
  roomId: string,
  username?: string,
): Promise<AddInputResponse> {
  const response = await sendSmelterRequest(
    'post',
    `/room/${encodeURIComponent(roomId)}/input`,
    { type: 'whip', username: username || undefined },
  );
  return {
    inputId: response.inputId,
    bearerToken: response.bearerToken,
    whipUrl: response.whipUrl,
  };
}

export async function acknowledgeWhipInput(
  roomId: string,
  inputId: string,
): Promise<void> {
  try {
    await sendSmelterRequest(
      'post',
      `/room/${encodeURIComponent(roomId)}/input/${encodeURIComponent(inputId)}/whip/ack`,
      {},
    );
  } catch (err: any) {
    const message =
      err?.body?.message ?? err?.message ?? 'Failed to acknowledge WHIP input';
    console.warn('Failed to acknowledge WHIP input:', message);
    throw new Error(message);
  }
}

export async function setPendingWhipInputs(
  roomId: string,
  pendingWhipInputs: PendingWhipInputData[],
): Promise<void> {
  await sendSmelterRequest(
    'post',
    `/room/${encodeURIComponent(roomId)}/pending-whip-inputs`,
    { pendingWhipInputs },
  );
}

export type SavedConfigInfo = {
  fileName: string;
  name: string;
  savedAt: string;
  size: number;
};

export async function saveRemoteConfig(
  name: string,
  config: object,
): Promise<
  { ok: true; fileName: string; name: string } | { ok: false; error: string }
> {
  try {
    const result = await sendSmelterRequest('post', '/configs', {
      name,
      config,
    });
    return { ok: true, fileName: result.fileName, name: result.name };
  } catch (e: any) {
    const msg = e?.message ?? 'Failed to save config';
    console.error('[saveRemoteConfig]', msg);
    return { ok: false, error: msg };
  }
}

export async function listRemoteConfigs(): Promise<
  { ok: true; configs: SavedConfigInfo[] } | { ok: false; error: string }
> {
  try {
    const data = await sendSmelterRequest('get', '/configs');
    return { ok: true, configs: data.configs ?? [] };
  } catch (e: any) {
    const msg = e?.message ?? 'Failed to list configs';
    console.error('[listRemoteConfigs]', msg);
    return { ok: false, error: msg };
  }
}

export async function loadRemoteConfig(
  fileName: string,
): Promise<
  | { ok: true; name: string; config: any; savedAt: string }
  | { ok: false; error: string }
> {
  try {
    const data = await sendSmelterRequest(
      'get',
      `/configs/${encodeURIComponent(fileName)}`,
    );
    return {
      ok: true,
      name: data.name,
      config: data.config,
      savedAt: data.savedAt,
    };
  } catch (e: any) {
    const msg = e?.message ?? 'Failed to load config';
    console.error('[loadRemoteConfig]', msg);
    return { ok: false, error: msg };
  }
}

export async function deleteRemoteConfig(
  fileName: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await sendSmelterRequest(
      'delete',
      `/configs/${encodeURIComponent(fileName)}`,
      {},
    );
    return { ok: true };
  } catch (e: any) {
    const msg = e?.message ?? 'Failed to delete config';
    console.error('[deleteRemoteConfig]', msg);
    return { ok: false, error: msg };
  }
}

export async function getAllRooms(): Promise<any> {
  const rooms = await sendSmelterRequest('get', `/rooms`);
  return rooms;
}

export type UpdateInputOptions = {
  volume: number;
  shaders?: ShaderConfig[];
  showTitle?: boolean;
  orientation?: InputOrientation;
  text?: string;
  textAlign?: 'left' | 'center' | 'right';
  textColor?: string;
  textMaxLines?: number;
  textScrollSpeed?: number;
  textScrollLoop?: boolean;
  textScrollNudge?: number;
  textFontSize?: number;
  borderColor?: string;
  borderWidth?: number;
  attachedInputIds?: string[];
  gameBackgroundColor?: string;
  gameCellGap?: number;
  gameBoardBorderColor?: string;
  gameBoardBorderWidth?: number;
};

export async function updateInput(
  roomId: string,
  inputId: string,
  opts: Partial<UpdateInputOptions>,
) {
  return await sendSmelterRequest(
    'post',
    `/room/${encodeURIComponent(roomId)}/input/${encodeURIComponent(inputId)}`,
    opts,
  );
}

export async function disconnectInput(roomId: string, inputId: string) {
  return await sendSmelterRequest(
    'post',
    `/room/${encodeURIComponent(roomId)}/input/${encodeURIComponent(inputId)}/disconnect`,
    {},
  );
}

export async function connectInput(roomId: string, inputId: string) {
  return await sendSmelterRequest(
    'post',
    `/room/${encodeURIComponent(roomId)}/input/${encodeURIComponent(inputId)}/connect`,
    {},
  );
}

export async function hideInput(roomId: string, inputId: string) {
  return await sendSmelterRequest(
    'post',
    `/room/${encodeURIComponent(roomId)}/input/${encodeURIComponent(inputId)}/hide`,
    {},
  );
}

export async function showInput(roomId: string, inputId: string) {
  return await sendSmelterRequest(
    'post',
    `/room/${encodeURIComponent(roomId)}/input/${encodeURIComponent(inputId)}/show`,
    {},
  );
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

export async function getAvailableShaders(): Promise<AvailableShader[]> {
  const shaders = await sendSmelterRequest('get', `/shaders`);
  return (shaders?.shaders as AvailableShader[]) || [];
}

async function sendSmelterRequest(
  method: 'get' | 'delete' | 'post',
  route: string,
  body?: object,
): Promise<any> {
  const response = await fetch(`${BASE_URL}${route}`, {
    method,
    body: body && JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (response.status >= 400) {
    let body: any = await response.text();
    try {
      body = JSON.parse(body);
    } catch {
      // body stays as text
    }
    const message =
      body?.message ?? body?.error ?? `Request to Smelter server failed.`;
    const err = new Error(message) as any;
    err.body = body;
    err.status = response.status;
    throw err;
  }
  const data = (await response.json()) as object;
  return data;
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
