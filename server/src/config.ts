import type { Outputs } from '@swmansion/smelter';

type Config = {
  logger: {
    level: 'info' | 'warn';
    transport?: {
      target: 'pino-pretty';
    };
  };
  whepBaseUrl: string;
  whipBaseUrl: string;
  h264Decoder: 'ffmpeg_h264' | 'vulkan_h264';
  h264Encoder: Outputs.WhepVideoEncoderOptions;
  snakeVisualSpeedMultiplier: number;
};

const defaultSnakeVisualSpeedMultiplier = 1.25;
const parsedSnakeVisualSpeedMultiplier = Number(
  process.env.SMELTER_SNAKE_VISUAL_SPEED_MULTIPLIER,
);
const snakeVisualSpeedMultiplier =
  Number.isFinite(parsedSnakeVisualSpeedMultiplier) &&
  parsedSnakeVisualSpeedMultiplier > 0
    ? parsedSnakeVisualSpeedMultiplier
    : defaultSnakeVisualSpeedMultiplier;

const isProduction = process.env.ENVIRONMENT === 'production';

/** Fishjam app path segment before `/whep` and `/whip` (two Docker stacks = two values). */
const defaultProductionWebRtcApp = 'smelter-editor-webrtc';

function productionWebRtcBaseUrls(): { whepBaseUrl: string; whipBaseUrl: string } {
  const whepOverride = process.env.SMELTER_WHEP_BASE_URL?.trim();
  const whipOverride = process.env.SMELTER_WHIP_BASE_URL?.trim();
  if (whepOverride && whipOverride) {
    return { whepBaseUrl: whepOverride, whipBaseUrl: whipOverride };
  }
  const app =
    process.env.SMELTER_EDITOR_WEBRTC_APP?.trim() || defaultProductionWebRtcApp;
  const host = 'https://puffer.fishjam.io';
  return {
    whepBaseUrl: `${host}/${app}/whep`,
    whipBaseUrl: `${host}/${app}/whip`,
  };
}

function buildH264Encoder(): Outputs.WhepVideoEncoderOptions {
  const encoderEnv = process.env.SMELTER_H264_ENCODER;
  const useVulkan = encoderEnv === 'vulkan' || (!encoderEnv && isProduction);

  if (useVulkan) {
    const bitrate =
      Number(process.env.SMELTER_H264_ENCODER_BITRATE) || 50_000_000;
    return { type: 'vulkan_h264', bitrate };
  }

  const preset = (process.env.SMELTER_H264_ENCODER_PRESET ?? 'ultrafast') as
    | 'ultrafast'
    | 'superfast'
    | 'veryfast'
    | 'faster'
    | 'fast'
    | 'medium'
    | 'slow'
    | 'slower'
    | 'veryslow'
    | 'placebo';
  const bitrate = process.env.SMELTER_H264_ENCODER_BITRATE ?? '20000000';
  return {
    type: 'ffmpeg_h264',
    preset,
    ffmpegOptions: {
      tune: 'zerolatency',
      thread_type: 'slice',
      preset,
      bitrate,
    },
  };
}

export const config: Config = isProduction
  ? {
      logger: {
        level: (process.env.SMELTER_DEMO_ROUTER_LOGGER_LEVEL ?? 'warn') as any,
      },
      ...productionWebRtcBaseUrls(),
      h264Decoder: 'ffmpeg_h264',
      h264Encoder: buildH264Encoder(),
      snakeVisualSpeedMultiplier,
    }
  : {
      logger: {
        transport: {
          target: 'pino-pretty',
        },
        level: (process.env.SMELTER_DEMO_ROUTER_LOGGER_LEVEL ?? 'warn') as any,
      },
      whepBaseUrl: 'http://127.0.0.1:9000/whep',
      whipBaseUrl: 'http://127.0.0.1:9000/whip',
      h264Decoder: 'ffmpeg_h264',
      h264Encoder: buildH264Encoder(),
      snakeVisualSpeedMultiplier,
    };
