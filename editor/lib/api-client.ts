import type { Resolution, ResolutionPreset } from './resolution';
import type {
  AddInputResponse,
  AvailableShader,
  InputSuggestions,
  KickSuggestions,
  MP4Suggestions,
  PendingWhipInputData,
  PictureSuggestions,
  RecordingInfo,
  RegisterInputOptions,
  RoomNameEntry,
  RoomState,
  SavedConfigInfo,
  StartRecordingResponse,
  StopRecordingResponse,
  UpdateInputOptions,
  UpdateRoomOptions,
} from './types';

export interface SmelterApiClient {
  createNewRoom(
    initInputs: RegisterInputOptions[],
    skipDefaultInputs?: boolean,
    resolution?: ResolutionPreset | Resolution,
  ): Promise<{
    roomId: string;
    roomName: RoomNameEntry;
    whepUrl: string;
    resolution: Resolution;
  }>;

  updateRoom(
    roomId: string,
    opts: UpdateRoomOptions,
  ): Promise<{ roomId: string; whepUrl: string }>;

  getRoomInfo(roomId: string): Promise<RoomState | 'not-found'>;

  startRecording(roomId: string): Promise<StartRecordingResponse>;
  stopRecording(roomId: string): Promise<StopRecordingResponse>;
  getRecordings(): Promise<RecordingInfo[]>;
  getRoomRecordings(roomId: string): Promise<RecordingInfo[]>;

  getTwitchSuggestions(): Promise<InputSuggestions>;
  getMP4Suggestions(): Promise<MP4Suggestions>;
  getKickSuggestions(): Promise<KickSuggestions>;
  getPictureSuggestions(): Promise<PictureSuggestions>;

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
  addCameraInput(
    roomId: string,
    username?: string,
  ): Promise<AddInputResponse>;

  removeInput(roomId: string, inputId: string): Promise<any>;
  deleteRoom(roomId: string): Promise<any>;

  updateInput(
    roomId: string,
    inputId: string,
    opts: Partial<UpdateInputOptions>,
  ): Promise<any>;
  disconnectInput(roomId: string, inputId: string): Promise<any>;
  connectInput(roomId: string, inputId: string): Promise<any>;
  hideInput(roomId: string, inputId: string): Promise<any>;
  showInput(roomId: string, inputId: string): Promise<any>;

  acknowledgeWhipInput(roomId: string, inputId: string): Promise<void>;
  setPendingWhipInputs(
    roomId: string,
    pendingWhipInputs: PendingWhipInputData[],
  ): Promise<void>;

  saveRemoteConfig(
    name: string,
    config: object,
  ): Promise<
    { ok: true; fileName: string; name: string } | { ok: false; error: string }
  >;
  listRemoteConfigs(): Promise<
    { ok: true; configs: SavedConfigInfo[] } | { ok: false; error: string }
  >;
  loadRemoteConfig(
    fileName: string,
  ): Promise<
    | { ok: true; name: string; config: any; savedAt: string }
    | { ok: false; error: string }
  >;
  deleteRemoteConfig(
    fileName: string,
  ): Promise<{ ok: true } | { ok: false; error: string }>;

  getAllRooms(): Promise<any>;
  getAvailableShaders(): Promise<AvailableShader[]>;
}

class SmelterApiError extends Error {
  body: any;
  status: number;
  constructor(message: string, status: number, body: any) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function sendRequest(
  baseUrl: string,
  method: 'get' | 'delete' | 'post',
  route: string,
  body?: object,
): Promise<any> {
  console.log(`[smelter] ${method.toUpperCase()} ${route}`, body ?? '');
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    body: body && JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });

  if (response.status >= 400) {
    let respBody: any = await response.text();
    try {
      respBody = JSON.parse(respBody);
    } catch {
      // body stays as text
    }
    const message =
      respBody?.message ??
      respBody?.error ??
      `Request to Smelter server failed.`;
    throw new SmelterApiError(message, response.status, respBody);
  }
  return (await response.json()) as object;
}

export function createSmelterApiClient(baseUrl: string): SmelterApiClient {
  const req = (
    method: 'get' | 'delete' | 'post',
    route: string,
    body?: object,
  ) => sendRequest(baseUrl, method, route, body);

  const enc = encodeURIComponent;

  return {
    async createNewRoom(initInputs, skipDefaultInputs = false, resolution) {
      return await req('post', '/room', {
        initInputs,
        skipDefaultInputs,
        resolution,
      });
    },

    async updateRoom(roomId, opts) {
      return await req('post', `/room/${enc(roomId)}`, opts);
    },

    async getRoomInfo(roomId) {
      try {
        return await req('get', `/room/${enc(roomId)}`);
      } catch (err: any) {
        if (err.status === 404) return 'not-found';
        throw err;
      }
    },

    async startRecording(roomId) {
      return await req('post', `/room/${enc(roomId)}/record/start`, {});
    },

    async stopRecording(roomId) {
      return await req('post', `/room/${enc(roomId)}/record/stop`, {});
    },

    async getRecordings() {
      const data = await req('get', '/recordings');
      return data.recordings ?? [];
    },

    async getRoomRecordings(roomId) {
      const data = await req('get', `/room/${enc(roomId)}/recordings`);
      return data.recordings ?? [];
    },

    async getTwitchSuggestions() {
      return await req('get', '/suggestions/twitch');
    },

    async getMP4Suggestions() {
      return await req('get', '/suggestions/mp4s');
    },

    async getKickSuggestions() {
      return await req('get', '/suggestions/kick');
    },

    async getPictureSuggestions() {
      return await req('get', '/suggestions/pictures');
    },

    async addTwitchInput(roomId, channelId) {
      return await req('post', `/room/${enc(roomId)}/input`, {
        type: 'twitch-channel',
        channelId,
      });
    },

    async addKickInput(roomId, channelId) {
      return await req('post', `/room/${enc(roomId)}/input`, {
        type: 'kick-channel',
        channelId,
      });
    },

    async addMP4Input(roomId, mp4FileName) {
      return await req('post', `/room/${enc(roomId)}/input`, {
        type: 'local-mp4',
        source: { fileName: mp4FileName, url: '' },
      });
    },

    async addImageInput(roomId, imageFileNameOrId) {
      const isImageId = imageFileNameOrId.startsWith('pictures::');
      return await req(
        'post',
        `/room/${enc(roomId)}/input`,
        isImageId
          ? { type: 'image', imageId: imageFileNameOrId }
          : { type: 'image', fileName: imageFileNameOrId },
      );
    },

    async addTextInput(roomId, text, textAlign = 'left') {
      return await req('post', `/room/${enc(roomId)}/input`, {
        type: 'text-input',
        text,
        textAlign,
      });
    },

    async addSnakeGameInput(roomId, title) {
      return await req('post', `/room/${enc(roomId)}/input`, {
        type: 'game',
        title,
      });
    },

    async addCameraInput(roomId, username) {
      const response = await req('post', `/room/${enc(roomId)}/input`, {
        type: 'whip',
        username: username || undefined,
      });
      return {
        inputId: response.inputId,
        bearerToken: response.bearerToken,
        whipUrl: response.whipUrl,
      };
    },

    async removeInput(roomId, inputId) {
      return await req('delete', `/room/${enc(roomId)}/input/${enc(inputId)}`, {});
    },

    async deleteRoom(roomId) {
      return await req('delete', `/room/${enc(roomId)}`, {});
    },

    async updateInput(roomId, inputId, opts) {
      return await req(
        'post',
        `/room/${enc(roomId)}/input/${enc(inputId)}`,
        opts,
      );
    },

    async disconnectInput(roomId, inputId) {
      return await req(
        'post',
        `/room/${enc(roomId)}/input/${enc(inputId)}/disconnect`,
        {},
      );
    },

    async connectInput(roomId, inputId) {
      return await req(
        'post',
        `/room/${enc(roomId)}/input/${enc(inputId)}/connect`,
        {},
      );
    },

    async hideInput(roomId, inputId) {
      return await req(
        'post',
        `/room/${enc(roomId)}/input/${enc(inputId)}/hide`,
        {},
      );
    },

    async showInput(roomId, inputId) {
      return await req(
        'post',
        `/room/${enc(roomId)}/input/${enc(inputId)}/show`,
        {},
      );
    },

    async acknowledgeWhipInput(roomId, inputId) {
      try {
        await req(
          'post',
          `/room/${enc(roomId)}/input/${enc(inputId)}/whip/ack`,
          {},
        );
      } catch (err: any) {
        const message =
          err?.body?.message ??
          err?.message ??
          'Failed to acknowledge WHIP input';
        console.warn('Failed to acknowledge WHIP input:', message);
        throw new Error(message);
      }
    },

    async setPendingWhipInputs(roomId, pendingWhipInputs) {
      await req('post', `/room/${enc(roomId)}/pending-whip-inputs`, {
        pendingWhipInputs,
      });
    },

    async saveRemoteConfig(name, config) {
      try {
        const result = await req('post', '/configs', { name, config });
        return { ok: true, fileName: result.fileName, name: result.name };
      } catch (e: any) {
        const msg = e?.message ?? 'Failed to save config';
        console.error('[saveRemoteConfig]', msg);
        return { ok: false, error: msg };
      }
    },

    async listRemoteConfigs() {
      try {
        const data = await req('get', '/configs');
        return { ok: true, configs: data.configs ?? [] };
      } catch (e: any) {
        const msg = e?.message ?? 'Failed to list configs';
        console.error('[listRemoteConfigs]', msg);
        return { ok: false, error: msg };
      }
    },

    async loadRemoteConfig(fileName) {
      try {
        const data = await req('get', `/configs/${enc(fileName)}`);
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
    },

    async deleteRemoteConfig(fileName) {
      try {
        await req('delete', `/configs/${enc(fileName)}`, {});
        return { ok: true };
      } catch (e: any) {
        const msg = e?.message ?? 'Failed to delete config';
        console.error('[deleteRemoteConfig]', msg);
        return { ok: false, error: msg };
      }
    },

    async getAllRooms() {
      return await req('get', '/rooms');
    },

    async getAvailableShaders() {
      const shaders = await req('get', '/shaders');
      return (shaders?.shaders as AvailableShader[]) || [];
    },
  };
}
