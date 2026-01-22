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
};
export declare const config: Config;
export {};
