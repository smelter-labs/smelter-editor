import { type SmelterOutput } from '../smelter';
import { TwitchChannelMonitor } from '../twitch/TwitchChannelMonitor';
import type { Layout } from '../app/store';
import { KickChannelMonitor } from '../kick/KickChannelMonitor';
import type { ShaderConfig } from '../shaders/shaders';
import { WhipInputMonitor } from '../whip/WhipInputMonitor';
export type InputOrientation = 'horizontal' | 'vertical';
export type RoomInputState = {
    inputId: string;
    type: 'local-mp4' | 'twitch-channel' | 'kick-channel' | 'whip' | 'image' | 'text-input';
    status: 'disconnected' | 'pending' | 'connected';
    volume: number;
    showTitle: boolean;
    shaders: ShaderConfig[];
    orientation: InputOrientation;
    metadata: {
        title: string;
        description: string;
    };
} & TypeSpecificState;
type TypeSpecificState = {
    type: 'local-mp4';
    mp4FilePath: string;
} | {
    type: 'twitch-channel';
    channelId: string;
    hlsUrl: string;
    monitor: TwitchChannelMonitor;
} | {
    type: 'kick-channel';
    channelId: string;
    hlsUrl: string;
    monitor: KickChannelMonitor;
} | {
    type: 'whip';
    whipUrl: string;
    monitor: WhipInputMonitor;
} | {
    type: 'image';
    imageId: string;
} | {
    type: 'text-input';
    text: string;
    textAlign: 'left' | 'center' | 'right';
    textColor: string;
    textMaxLines: number;
    textScrollSpeed: number;
    textScrollLoop: boolean;
};
type UpdateInputOptions = {
    volume: number;
    showTitle: boolean;
    shaders: ShaderConfig[];
    orientation: InputOrientation;
    text: string;
    textAlign: 'left' | 'center' | 'right';
    textColor: string;
    textMaxLines: number;
    textScrollSpeed: number;
    textScrollLoop: boolean;
};
export type RegisterInputOptions = {
    type: 'twitch-channel';
    channelId: string;
} | {
    type: 'kick-channel';
    channelId: string;
} | {
    type: 'whip';
    username: string;
} | {
    type: 'local-mp4';
    source: {
        fileName?: string;
        url?: string;
    };
} | {
    type: 'image';
    fileName?: string;
    imageId?: string;
} | {
    type: 'text-input';
    text: string;
    textAlign?: 'left' | 'center' | 'right';
    textColor?: string;
    textMaxLines?: number;
    textScrollSpeed?: number;
    textScrollLoop?: boolean;
};
export declare class RoomState {
    private inputs;
    private layout;
    idPrefix: string;
    private mp4sDir;
    private mp4Files;
    private output;
    lastReadTimestamp: number;
    creationTimestamp: number;
    pendingDelete?: boolean;
    isPublic: boolean;
    constructor(idPrefix: string, output: SmelterOutput, initInputs: RegisterInputOptions[], skipDefaultInputs?: boolean);
    private getInitialInputState;
    getWhepUrl(): string;
    getResolution(): {
        width: number;
        height: number;
    };
    getState(): [RoomInputState[], Layout];
    getInputs(): RoomInputState[];
    private getPlaceholderId;
    private isPlaceholder;
    private ensurePlaceholder;
    private removePlaceholder;
    addNewWhipInput(username: string): Promise<string>;
    addNewInput(opts: RegisterInputOptions): Promise<string | undefined>;
    removeInput(inputId: string): Promise<void>;
    connectInput(inputId: string): Promise<string>;
    ackWhipInput(inputId: string): Promise<void>;
    disconnectInput(inputId: string): Promise<void>;
    removeStaleWhipInputs(staleTtlMs: number): Promise<void>;
    updateInput(inputId: string, options: Partial<UpdateInputOptions>): Promise<void>;
    reorderInputs(inputOrder: string[]): void;
    updateLayout(layout: Layout): Promise<void>;
    deleteRoom(): Promise<void>;
    private updateStoreWithState;
    private getInput;
    private removeWrappedStaticInputs;
    private removeWrappedMp4Inputs;
    private ensureWrappedMp4Inputs;
    private ensureWrappedImageInputs;
}
export {};
