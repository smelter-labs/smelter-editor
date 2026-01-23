'use server';

import { AddInputResponse } from '@/components/control-panel/whip-input/utils/types';
import type { SpawnOptions } from 'node:child_process';
import { spawn as nodeSpawn } from 'node:child_process';
import { assert } from 'node:console';

const BASE_URL = process.env.SMELTER_DEMO_SERVER_URL;

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
  paramValue: number;
};

export type ShaderConfig = {
  shaderName: string;
  shaderId: string;
  enabled: boolean;
  params: ShaderParamConfig[];
};

export type Input = {
  id: number;
  inputId: string;
  title: string;
  description: string;
  showTitle?: boolean;
  volume: number;
  type: 'local-mp4' | 'twitch-channel' | 'kick-channel' | 'whip' | 'image' | 'text-input';
  sourceState: 'live' | 'offline' | 'unknown' | 'always-live';
  status: 'disconnected' | 'pending' | 'connected';
  channelId?: string;
  imageId?: string;
  shaders: ShaderConfig[];
  text?: string;
  textAlign?: 'left' | 'center' | 'right';
  textColor?: string;
  textMaxLines?: number;
  textScrollSpeed?: number;
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
    };

export type RoomState = {
  inputs: Input[];
  layout: Layout;
  whepUrl: string;
  pendingDelete?: boolean;
  isPublic?: boolean;
};

export type Layout =
  | 'grid'
  | 'primary-on-left'
  | 'primary-on-top'
  | 'picture-in-picture'
  | 'wrapped'
  | 'wrapped-static'
  | 'transition'
  | 'picture-on-picture';

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

export async function createNewRoom(
  initInputs: RegisterInputOptions[],
  skipDefaultInputs: boolean = false,
): Promise<{
  roomId: string;
  whepUrl: string;
}> {
  return await sendSmelterRequest('post', '/room', { initInputs, skipDefaultInputs });
}

export type UpdateRoomOptions = {
  inputOrder?: string[];
  layout?: Layout;
  isPublic?: boolean;
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

export async function addImageInput(roomId: string, imageFileName: string) {
  return await sendSmelterRequest(
    'post',
    `/room/${encodeURIComponent(roomId)}/input`,
    { type: 'image', fileName: imageFileName },
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
    console.warn('Failed to acknowledge WHIP input:', err?.message ?? err);
    throw err;
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
  text?: string;
  textAlign?: 'left' | 'center' | 'right';
  textColor?: string;
  textMaxLines?: number;
  textScrollSpeed?: number;
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

export async function restartService(): Promise<void> {
  try {
    await spawn('bash', ['-c', 'sudo systemctl restart smelter.service'], {});
  } catch {}
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
    const err = new Error(`Request to Smelter server failed.`) as any;
    err.response = response;
    err.body = await response.text();
    try {
      err.body = JSON.parse(err.body);
      err.status = response.status;
    } catch (err) {
      console.error('Failed to parse response');
    }
    throw err;
  }
  return (await response.json()) as object;
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
