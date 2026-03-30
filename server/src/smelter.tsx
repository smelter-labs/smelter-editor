import path from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { StoreApi } from 'zustand';
import Smelter from '@swmansion/smelter-node';

import App from './app/App';
import type { RoomStore } from './app/store';
import { createRoomStore } from './app/store';
import { config } from './config';
import { ensureDir, readFile } from 'fs-extra';
import {
  MotionScene,
  type MotionStore,
  MOTION_GRID_WIDTH,
  MOTION_GRID_HEIGHT,
} from './motion/MotionScene';
import { AudioAnalysisScene } from './audio/AudioAnalysisScene';
import shadersController from './shaders/shaders';
import type { Resolution } from './types';
import { RESOLUTION_PRESETS } from './types';

const execFileAsync = promisify(execFile);

export type { Resolution, ResolutionPreset } from './types';
export { RESOLUTION_PRESETS } from './types';

import type { AudioStoreState } from './audio/audioStore';

export type SmelterOutput = {
  id: string;
  url: string;
  store: StoreApi<RoomStore>;
  resolution: Resolution;
  audioStore?: StoreApi<AudioStoreState>;
};

export type RegisterSmelterInputOptions =
  | {
      type: 'mp4';
      filePath: string;
      loop?: boolean;
      offsetMs?: number;
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
  private pipelineStartTime: number = 0;

  constructor() {
    this.instance = new Smelter();
  }

  public getPipelineTimeMs(): number {
    return Date.now() - this.pipelineStartTime;
  }
  public async init() {
    await this.instance.init();
    await this.instance.start();
    this.pipelineStartTime = Date.now();
    await this.instance.registerImage('spinner', {
      serverPath: path.join(__dirname, '../loading.gif'),
      assetType: 'gif',
    });
    await this.instance.registerImage('news_strip', {
      serverPath: path.join(
        process.cwd(),
        'mp4s',
        'news_strip',
        'news_strip.png',
      ),
      assetType: 'png',
    });
    await this.instance.registerImage('smelter_logo', {
      serverPath: path.join(__dirname, '../imgs/smelter_logo.png'),
      assetType: 'png',
    });

    await this.instance.registerFont('https://madbangbang.com/Starjedi.ttf');

    for (const shader of shadersController.shaders) {
      await this.registerShaderFromFile(
        this.instance,
        shader.id,
        path.join(__dirname, `../shaders/${shader.shaderFile}`),
      );
    }
  }

  public async registerOutput(
    roomId: string,
    resolution: Resolution = RESOLUTION_PRESETS['1440p'],
    audioStore?: StoreApi<AudioStoreState>,
  ): Promise<SmelterOutput> {
    let store = createRoomStore(resolution);
    await this.instance.registerOutput(
      roomId,
      <App store={store} audioStore={audioStore} />,
      {
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
      },
    );

    return {
      id: roomId,
      url: `${config.whepBaseUrl}/${encodeURIComponent(roomId)}`,
      store,
      resolution,
      audioStore,
    };
  }

  /**
   * Register an additional MP4 output for a given room that records the current view to a file.
   * This reuses the existing room store so the recording matches the live WHEP output.
   */
  public async registerMp4Output(
    outputId: string,
    output: SmelterOutput,
    filePath: string,
  ): Promise<void> {
    await this.instance.registerOutput(
      outputId,
      <App store={output.store} audioStore={output.audioStore} />,
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
      },
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

  public async registerInput(
    inputId: string,
    opts: RegisterSmelterInputOptions,
  ): Promise<string> {
    const t0 = Date.now();
    try {
      if (opts.type === 'whip') {
        const res = await this.instance.registerInput(inputId, {
          type: 'whip_server',
          video: { decoderPreferences: WHIP_SERVER_DECODER_PREFERENCES },
        });
        console.log('whipInput', res);
        return res.bearerToken;
      } else if (opts.type === 'mp4') {
        console.log(
          `[smelter] registerInput MP4 inputId=${inputId} path=${opts.filePath} loop=${opts.loop ?? true} offsetMs=${opts.offsetMs}`,
        );
        await this.instance.registerInput(inputId, {
          type: 'mp4',
          serverPath: opts.filePath,
          decoderMap: MP4_DECODER_MAP,
          loop: opts.loop ?? true,
          offsetMs: opts.offsetMs,
        });
        console.log(
          `[smelter] registerInput MP4 OK inputId=${inputId} elapsed=${Date.now() - t0}ms`,
        );
      } else if (opts.type === 'hls') {
        await this.instance.registerInput(inputId, {
          type: 'hls',
          url: opts.url,
          decoderMap: MP4_DECODER_MAP,
        });
      }
    } catch (err: any) {
      const errorCode = err.body?.error_code ?? 'unknown';
      console.error(
        `[smelter] registerInput FAILED inputId=${inputId} type=${opts.type} errorCode=${errorCode} elapsed=${Date.now() - t0}ms`,
        err.body ?? err,
      );
      if (errorCode === 'INPUT_STREAM_ALREADY_REGISTERED') {
        throw new Error('already registered');
      }
      try {
        console.log(
          `[smelter] registerInput cleanup: attempting unregister inputId=${inputId}`,
        );
        await this.instance.unregisterInput(inputId);
        console.log(
          `[smelter] registerInput cleanup: unregister succeeded inputId=${inputId} — re-throwing original error`,
        );
      } catch (cleanupErr: any) {
        const cleanupCode = cleanupErr.body?.error_code ?? 'unknown';
        if (cleanupCode === 'INPUT_STREAM_NOT_FOUND') {
          console.log(
            `[smelter] registerInput cleanup: input not found (registration truly failed) inputId=${inputId}`,
          );
        } else {
          console.error(
            `[smelter] registerInput cleanup: unregister also failed inputId=${inputId} cleanupCode=${cleanupCode}`,
            cleanupErr.body ?? cleanupErr,
          );
        }
      }
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
    opts: {
      serverPath?: string;
      url?: string;
      assetType: 'jpeg' | 'png' | 'gif' | 'svg' | 'auto';
    },
  ): Promise<void> {
    await this.instance.registerImage(imageId, {
      serverPath: opts.serverPath,
      url: opts.url,
      assetType: opts.assetType,
    });
  }

  public async unregisterImage(imageId: string): Promise<void> {
    await this.instance.unregisterImage(imageId);
  }

  public async registerMotionOutput(
    outputId: string,
    store: StoreApi<MotionStore>,
    port: number,
  ): Promise<void> {
    await this.instance.registerOutput(
      outputId,
      <MotionScene store={store} />,
      {
        type: 'rtp_stream',
        port,
        ip: '127.0.0.1',
        transportProtocol: 'udp',
        video: {
          resolution: { width: MOTION_GRID_WIDTH, height: MOTION_GRID_HEIGHT },
          encoder:
            config.h264Encoder.type === 'vulkan_h264'
              ? { type: 'vulkan_h264' as const }
              : { type: 'ffmpeg_h264' as const, preset: 'ultrafast' as const },
        },
      },
    );
  }

  public async unregisterMotionOutput(outputId: string): Promise<void> {
    await this.unregisterOutput(outputId);
  }

  /**
   * Register an RTP output for room-level audio analysis.
   *
   * Uses a lightweight AudioAnalysisScene that renders a solid-color 16x16
   * View (so video is never empty) and includes an InputStream for every
   * input in the room store, producing the same program audio mix as the
   * main WHEP output.
   */
  public async registerRoomAudioOutput(
    outputId: string,
    output: SmelterOutput,
    port: number,
  ): Promise<void> {
    await this.instance.registerOutput(
      outputId,
      <AudioAnalysisScene store={output.store} />,
      {
        type: 'rtp_stream',
        port,
        ip: '127.0.0.1',
        transportProtocol: 'udp',
        video: {
          resolution: { width: 16, height: 16 },
          encoder: {
            type: 'ffmpeg_h264' as const,
            preset: 'ultrafast' as const,
          },
        },
        audio: {
          channels: 'stereo',
          encoder: {
            type: 'opus',
            sampleRate: 48000,
            preset: 'lowest_latency',
          },
        },
      },
    );
  }

  public async unregisterRoomAudioOutput(outputId: string): Promise<void> {
    await this.unregisterOutput(outputId);
  }

  public async extractMp4Frame(
    mp4Path: string,
    positionMs: number,
  ): Promise<string> {
    const dir = path.join(process.cwd(), 'screenshots');
    await ensureDir(dir);
    const jpegPath = path.join(
      dir,
      `frame-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`,
    );
    const seconds = Math.max(0, positionMs / 1000);
    await execFileAsync('ffmpeg', [
      '-ss',
      seconds.toString(),
      '-i',
      mp4Path,
      '-vframes',
      '1',
      '-q:v',
      '2',
      jpegPath,
    ]);
    return jpegPath;
  }

  public async terminate(): Promise<void> {
    await this.instance.terminate();
  }
  private async registerShaderFromFile(
    smelter: Smelter,
    shaderId: string,
    file: string,
  ) {
    const source = await readFile(file, { encoding: 'utf-8' });

    await smelter.registerShader(shaderId, {
      source,
    });
  }
}

export const SmelterInstance = new SmelterManager();
