import type { StoreApi } from 'zustand';
import type { RoomStore } from './app/store';
export type Resolution = {
    width: number;
    height: number;
};
export declare const RESOLUTION_PRESETS: {
    readonly '720p': {
        readonly width: 1280;
        readonly height: 720;
    };
    readonly '1080p': {
        readonly width: 1920;
        readonly height: 1080;
    };
    readonly '1440p': {
        readonly width: 2560;
        readonly height: 1440;
    };
    readonly '4k': {
        readonly width: 3840;
        readonly height: 2160;
    };
    readonly '720p-vertical': {
        readonly width: 720;
        readonly height: 1280;
    };
    readonly '1080p-vertical': {
        readonly width: 1080;
        readonly height: 1920;
    };
    readonly '1440p-vertical': {
        readonly width: 1440;
        readonly height: 2560;
    };
    readonly '4k-vertical': {
        readonly width: 2160;
        readonly height: 3840;
    };
};
export type ResolutionPreset = keyof typeof RESOLUTION_PRESETS;
export type SmelterOutput = {
    id: string;
    url: string;
    store: StoreApi<RoomStore>;
    resolution: Resolution;
};
export type RegisterSmelterInputOptions = {
    type: 'mp4';
    filePath: string;
    loop?: boolean;
} | {
    type: 'hls';
    url: string;
} | {
    type: 'whip';
    url: string;
};
export declare class SmelterManager {
    private instance;
    constructor();
    init(): Promise<void>;
    registerOutput(roomId: string, resolution?: Resolution): Promise<SmelterOutput>;
    unregisterOutput(roomId: string): Promise<void>;
    registerInput(inputId: string, opts: RegisterSmelterInputOptions): Promise<string>;
    unregisterInput(inputId: string): Promise<void>;
    registerImage(imageId: string, opts: {
        serverPath?: string;
        url?: string;
        assetType: 'jpeg' | 'png' | 'gif' | 'svg' | 'auto';
    }): Promise<void>;
    private registerShaderFromFile;
}
export declare const SmelterInstance: SmelterManager;
