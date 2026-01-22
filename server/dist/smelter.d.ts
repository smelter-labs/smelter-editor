import type { StoreApi } from 'zustand';
import type { RoomStore } from './app/store';
export type SmelterOutput = {
    id: string;
    url: string;
    store: StoreApi<RoomStore>;
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
    registerOutput(roomId: string): Promise<SmelterOutput>;
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
