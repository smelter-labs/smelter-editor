import type { StoreApi } from 'zustand';
import type { ShaderConfig } from '../shaders/shaders';
export type InputConfig = {
    inputId: string;
    volume: number;
    title: string;
    description: string;
    showTitle?: boolean;
    shaders: ShaderConfig[];
    imageId?: string;
    text?: string;
    textAlign?: 'left' | 'center' | 'right';
    textColor?: string;
    textMaxLines?: number;
    textScrollSpeed?: number;
    textScrollLoop?: boolean;
    replaceWith?: InputConfig;
};
export declare const Layouts: readonly ["grid", "primary-on-left", "primary-on-top", "picture-in-picture", "wrapped", "wrapped-static", "transition", "picture-on-picture"];
export type Layout = 'grid' | 'primary-on-left' | 'primary-on-top' | 'picture-in-picture' | 'wrapped' | 'wrapped-static' | 'transition' | 'picture-on-picture';
export type RoomStore = {
    inputs: InputConfig[];
    layout: Layout;
    updateState: (inputs: InputConfig[], layout: Layout) => void;
};
export declare function createRoomStore(): StoreApi<RoomStore>;
export declare const StoreContext: import("react").Context<StoreApi<RoomStore>>;
