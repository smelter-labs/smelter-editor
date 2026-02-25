import path from 'path';
import type { StoreApi } from 'zustand';
import Smelter from '@swmansion/smelter-node';

import App from './app/App';
import type { RoomStore } from './app/store';
import { createRoomStore } from './app/store';
import { config } from './config';
import { readFile } from 'fs-extra';
import shadersController from './shaders/shaders';

export type Resolution = {
  width: number;
  height: number;
};

export const RESOLUTION_PRESETS = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
  '4k': { width: 3840, height: 2160 },
  '720p-vertical': { width: 720, height: 1280 },
  '1080p-vertical': { width: 1080, height: 1920 },
  '1440p-vertical': { width: 1440, height: 2560 },
  '4k-vertical': { width: 2160, height: 3840 },
} as const;

export type ResolutionPreset = keyof typeof RESOLUTION_PRESETS;

export type SmelterOutput = {
  id: string;
  url: string;
  store: StoreApi<RoomStore>;
  resolution: Resolution;
};

export type RegisterSmelterInputOptions =
  | {
      type: 'mp4';
      filePath: string;
      loop?: boolean;
    }
  | {
      type: 'hls';
      url: string;
    }
  | {
      type: 'whip';
      url: string;
    };

/** MP4 decoder: driven by config.h264Decoder (which depends on ENVIRONMENT). Override via config for env-specific decoders. */
const MP4_DECODER_MAP = {
  h264: config.h264Decoder,
};

const WHIP_SERVER_DECODER_PREFERENCES = [config.h264Decoder];

export class SmelterManager {
  private instance: Smelter;

  constructor() {
    this.instance = new Smelter();
  }

  

  public async init() {
    await SmelterInstance['instance'].init();
    await SmelterInstance['instance'].start();
    await SmelterInstance['instance'].registerImage('spinner', {
      serverPath: path.join(__dirname, '../loading.gif'),
      assetType: 'gif',
    });
    await SmelterInstance['instance'].registerImage('news_strip', {
      serverPath: path.join(process.cwd(), 'mp4s', 'news_strip', 'news_strip.png'),
      assetType: 'png',
    });
    await SmelterInstance['instance'].registerImage('smelter_logo', {
      serverPath: path.join(__dirname, '../imgs/smelter_logo.png'),
      assetType: 'png',
    });

    await this.instance.registerFont('https://madbangbang.com/Starjedi.ttf');

    for (const shader of shadersController.shaders) {
      await this.registerShaderFromFile(
        SmelterInstance['instance'],
        shader.id,
        path.join(__dirname, `../shaders/${shader.shaderFile}`)
      );
    }
  }

  public async registerOutput(roomId: string, resolution: Resolution = RESOLUTION_PRESETS['1440p']): Promise<SmelterOutput> {
    let store = createRoomStore(resolution);
    await this.instance.registerOutput(roomId, <App store={store} />, {
      type: 'whep_server',
      video: {
        encoder: config.h264Encoder,
        resolution: {
          width: resolution.width,
          height: resolution.height,
        },
      },
      audio: {
        encoder: {
          type: 'opus',
        },
      },
    });

    return { id: roomId, url: `${config.whepBaseUrl}/${encodeURIComponent(roomId)}`, store, resolution };
  }

  /**
   * Register an additional MP4 output for a given room that records the current view to a file.
   * This reuses the existing room store so the recording matches the live WHEP output.
   */
  public async registerMp4Output(
    outputId: string,
    output: SmelterOutput,
    filePath: string
  ): Promise<void> {
    await this.instance.registerOutput(
      outputId,
      <App store={output.store} />,
      {
        type: 'mp4',
        serverPath: filePath,
        video: {
          encoder: {
            type: 'ffmpeg_h264',
            preset: 'fast',
          },
          resolution: {
            width: output.resolution.width,
            height: output.resolution.height,
          },
        },
        audio: {
          encoder: {
            type: 'aac',
            channels: 'stereo',
          } as any,
        },
      }
    );
  }

  public async unregisterOutput(roomId: string): Promise<void> {
    try {
      await this.instance.unregisterOutput(roomId);
    } catch (err: any) {
      if (err.body?.error_code === 'OUTPUT_STREAM_NOT_FOUND') {
        console.log(roomId, 'Output already removed');
        return;
      }
      console.log(err.body, err);
      throw err;
    }
  }

  public async registerInput(inputId: string, opts: RegisterSmelterInputOptions): Promise<string> {
    try {
      if (opts.type === 'whip') {
        const res = await this.instance.registerInput(inputId, {
          type: 'whip_server',
          video: { decoderPreferences: WHIP_SERVER_DECODER_PREFERENCES },
        });
        console.log('whipInput', res);
        return res.bearerToken;
      } else if (opts.type === 'mp4') {
        await this.instance.registerInput(inputId, {
          type: 'mp4',
          serverPath: opts.filePath,
          decoderMap: MP4_DECODER_MAP,
          loop: opts.loop ?? true,
        });
      } else if (opts.type === 'hls') {
        await this.instance.registerInput(inputId, {
          type: 'hls',
          url: opts.url,
          decoderMap: MP4_DECODER_MAP,
        });
      }
    } catch (err: any) {
      if (err.body?.error_code === 'INPUT_STREAM_ALREADY_REGISTERED') {
        throw new Error('already registered');
      }
      try {
        // try to unregister in case it worked
        await this.instance.unregisterInput(inputId);
      } catch (err: any) {
        if (err.body?.error_code === 'INPUT_STREAM_NOT_FOUND') {
          return '';
        }
      }
      console.log(err.body, err);
      throw err;
    }
    return '';
  }

  public async unregisterInput(inputId: string): Promise<void> {
    try {
      await this.instance.unregisterInput(inputId);
    } catch (err: any) {
      if (err.body?.error_code === 'INPUT_STREAM_NOT_FOUND') {
        console.log(inputId, 'Input already removed');
        return;
      }
      console.log(err.body, err);
      throw err;
    }
  }

  public async registerImage(
    imageId: string,
    opts: { serverPath?: string; url?: string; assetType: 'jpeg' | 'png' | 'gif' | 'svg' | 'auto' }
  ): Promise<void> {
    await this.instance.registerImage(imageId, {
      serverPath: opts.serverPath,
      url: opts.url,
      assetType: opts.assetType,
    });
  }

  private async registerShaderFromFile(smelter: Smelter, shaderId: string, file: string) {
    const source = await readFile(file, { encoding: 'utf-8' });

    await smelter.registerShader(shaderId, {
      source,
    });
  }
}

export const SmelterInstance = new SmelterManager();
