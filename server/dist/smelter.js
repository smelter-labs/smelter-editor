"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SmelterInstance = exports.SmelterManager = exports.RESOLUTION_PRESETS = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const path_1 = __importDefault(require("path"));
const smelter_node_1 = __importDefault(require("@swmansion/smelter-node"));
const App_1 = __importDefault(require("./app/App"));
const store_1 = require("./app/store");
const config_1 = require("./config");
const fs_extra_1 = require("fs-extra");
const shaders_1 = __importDefault(require("./shaders/shaders"));
exports.RESOLUTION_PRESETS = {
    '720p': { width: 1280, height: 720 },
    '1080p': { width: 1920, height: 1080 },
    '1440p': { width: 2560, height: 1440 },
    '4k': { width: 3840, height: 2160 },
    '720p-vertical': { width: 720, height: 1280 },
    '1080p-vertical': { width: 1080, height: 1920 },
    '1440p-vertical': { width: 1440, height: 2560 },
    '4k-vertical': { width: 2160, height: 3840 },
};
// TODO: optional based on env
const MP4_DECODER_MAP = {
    h264: config_1.config.h264Decoder,
};
const WHIP_SERVER_DECODER_PREFERENCES = [config_1.config.h264Decoder];
class SmelterManager {
    constructor() {
        this.instance = new smelter_node_1.default();
    }
    async init() {
        await exports.SmelterInstance['instance'].init();
        await exports.SmelterInstance['instance'].start();
        await exports.SmelterInstance['instance'].registerImage('spinner', {
            serverPath: path_1.default.join(__dirname, '../loading.gif'),
            assetType: 'gif',
        });
        await exports.SmelterInstance['instance'].registerImage('news_strip', {
            serverPath: path_1.default.join(process.cwd(), 'mp4s', 'news_strip', 'news_strip.png'),
            assetType: 'png',
        });
        await exports.SmelterInstance['instance'].registerImage('smelter_logo', {
            serverPath: path_1.default.join(__dirname, '../imgs/smelter_logo.png'),
            assetType: 'png',
        });
        await this.instance.registerFont('https://madbangbang.com/Starjedi.ttf');
        for (const shader of shaders_1.default.shaders) {
            await this.registerShaderFromFile(exports.SmelterInstance['instance'], shader.id, path_1.default.join(__dirname, `../shaders/${shader.shaderFile}`));
        }
    }
    async registerOutput(roomId, resolution = exports.RESOLUTION_PRESETS['1440p']) {
        let store = (0, store_1.createRoomStore)(resolution);
        await this.instance.registerOutput(roomId, (0, jsx_runtime_1.jsx)(App_1.default, { store: store }), {
            type: 'whep_server',
            video: {
                encoder: config_1.config.h264Encoder,
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
        return { id: roomId, url: `${config_1.config.whepBaseUrl}/${encodeURIComponent(roomId)}`, store, resolution };
    }
    async unregisterOutput(roomId) {
        var _a;
        try {
            await this.instance.unregisterOutput(roomId);
        }
        catch (err) {
            if (((_a = err.body) === null || _a === void 0 ? void 0 : _a.error_code) === 'OUTPUT_STREAM_NOT_FOUND') {
                console.log(roomId, 'Output already removed');
                return;
            }
            console.log(err.body, err);
            throw err;
        }
    }
    async registerInput(inputId, opts) {
        var _a, _b, _c;
        try {
            if (opts.type === 'whip') {
                const res = await this.instance.registerInput(inputId, {
                    type: 'whip_server',
                    video: { decoderPreferences: WHIP_SERVER_DECODER_PREFERENCES },
                });
                console.log('whipInput', res);
                return res.bearerToken;
            }
            else if (opts.type === 'mp4') {
                await this.instance.registerInput(inputId, {
                    type: 'mp4',
                    serverPath: opts.filePath,
                    decoderMap: MP4_DECODER_MAP,
                    loop: (_a = opts.loop) !== null && _a !== void 0 ? _a : true,
                });
            }
            else if (opts.type === 'hls') {
                await this.instance.registerInput(inputId, {
                    type: 'hls',
                    url: opts.url,
                    decoderMap: MP4_DECODER_MAP,
                });
            }
        }
        catch (err) {
            if (((_b = err.body) === null || _b === void 0 ? void 0 : _b.error_code) === 'INPUT_STREAM_ALREADY_REGISTERED') {
                throw new Error('already registered');
            }
            try {
                // try to unregister in case it worked
                await this.instance.unregisterInput(inputId);
            }
            catch (err) {
                if (((_c = err.body) === null || _c === void 0 ? void 0 : _c.error_code) === 'INPUT_STREAM_NOT_FOUND') {
                    return '';
                }
            }
            console.log(err.body, err);
            throw err;
        }
        return '';
    }
    async unregisterInput(inputId) {
        var _a;
        try {
            await this.instance.unregisterInput(inputId);
        }
        catch (err) {
            if (((_a = err.body) === null || _a === void 0 ? void 0 : _a.error_code) === 'INPUT_STREAM_NOT_FOUND') {
                console.log(inputId, 'Input already removed');
                return;
            }
            console.log(err.body, err);
            throw err;
        }
    }
    async registerImage(imageId, opts) {
        await this.instance.registerImage(imageId, {
            serverPath: opts.serverPath,
            url: opts.url,
            assetType: opts.assetType,
        });
    }
    async registerShaderFromFile(smelter, shaderId, file) {
        const source = await (0, fs_extra_1.readFile)(file, { encoding: 'utf-8' });
        await smelter.registerShader(shaderId, {
            source,
        });
    }
}
exports.SmelterManager = SmelterManager;
exports.SmelterInstance = new SmelterManager();
