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

// Both deployed Docker stacks (production + staging) run the production config;
// only local dev falls through to the dev branch below.
const useProductionConfig =
  process.env.ENVIRONMENT === 'production' ||
  process.env.ENVIRONMENT === 'staging';

/**
 * Fishjam app path segment before `/whep` and `/whip`. Each deployed stack gets
 * its own app so production and staging don't share WebRTC endpoints; any other
 * environment falls back to the SMELTER_EDITOR_WEBRTC_APP env var.
 */
function resolveWebRtcApp(): string {
  switch (process.env.ENVIRONMENT) {
    case 'production':
      return 'smelter-editor-production-webrtc';
    case 'staging':
      return 'smelter-editor-staging-webrtc';
    default:
      return (
        process.env.SMELTER_EDITOR_WEBRTC_APP?.trim() || 'smelter-editor-webrtc'
      );
  }
}

function productionWebRtcBaseUrls(): {
  whepBaseUrl: string;
  whipBaseUrl: string;
} {
  const app = resolveWebRtcApp();
  const host = 'https://puffer.fishjam.io';
  return {
    whepBaseUrl: `${host}/${app}/whep`,
    whipBaseUrl: `${host}/${app}/whip`,
  };
}

function buildH264Encoder(): Outputs.WhepVideoEncoderOptions {
  const encoderEnv = process.env.SMELTER_H264_ENCODER;
  const useVulkan =
    encoderEnv === 'vulkan' || (!encoderEnv && useProductionConfig);

  if (useVulkan) {
    const bitrate =
      Number(process.env.SMELTER_H264_ENCODER_BITRATE) || 10_000_000;
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

export const config: Config = useProductionConfig
  ? {
    logger: {
      level: (process.env.SMELTER_DEMO_ROUTER_LOGGER_LEVEL ?? 'warn') as any,
    },
    ...productionWebRtcBaseUrls(),
    h264Decoder: 'vulkan_h264',
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
