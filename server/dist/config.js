"use strict";
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.config = process.env.ENVIRONMENT === 'production'
    ? {
        logger: {
            level: ((_a = process.env.SMELTER_DEMO_ROUTER_LOGGER_LEVEL) !== null && _a !== void 0 ? _a : 'warn'),
        },
        whepBaseUrl: 'https://puffer.fishjam.io/smelter-demo-whep/whep',
        whipBaseUrl: 'https://puffer.fishjam.io/smelter-demo-whep/whip',
        //h264Decoder: 'vulkan_h264',
        h264Decoder: 'ffmpeg_h264',
        h264Encoder: { type: 'vulkan_h264', bitrate: 20000000 },
        //h264Encoder: {
        //  type: 'ffmpeg_h264',
        //  preset: 'veryfast',
        //  ffmpegOptions: {
        //    tune: 'zerolatency',
        //    thread_type: 'slice',
        //  },
        //},
    }
    : {
        logger: {
            transport: {
                target: 'pino-pretty',
            },
            level: ((_b = process.env.SMELTER_DEMO_ROUTER_LOGGER_LEVEL) !== null && _b !== void 0 ? _b : 'warn'),
        },
        whepBaseUrl: 'http://127.0.0.1:9000/whep',
        whipBaseUrl: 'http://127.0.0.1:9000/whip',
        h264Decoder: 'ffmpeg_h264',
        h264Encoder: {
            type: 'ffmpeg_h264',
            preset: 'ultrafast',
            ffmpegOptions: {
                tune: 'zerolatency',
                thread_type: 'slice',
                preset: 'ultrafast',
                bitrate: '20000000',
            },
        },
    };
