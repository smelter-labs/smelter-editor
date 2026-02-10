import type { StoreApi } from 'zustand';
import { createStore } from 'zustand';
import type { ShaderConfig } from '../shaders/shaders';
import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import type { Resolution } from '../smelter';

export type InputOrientation = 'horizontal' | 'vertical';

export type InputConfig = {
  inputId: string;
  volume: number;
  title: string;
  description: string;
  showTitle?: boolean;
  shaders: ShaderConfig[];
  orientation?: InputOrientation;
  imageId?: string;
  text?: string;
  textAlign?: 'left' | 'center' | 'right';
  textColor?: string;
  textMaxLines?: number;
  textScrollSpeed?: number;
  textScrollLoop?: boolean;
  textScrollNudge?: number;
  textFontSize?: number;
  replaceWith?: InputConfig;
};

export const Layouts = [
  'grid',
  'primary-on-left',
  'primary-on-top',
  'picture-in-picture',
  'wrapped',
  'wrapped-static',
  'transition',
  'picture-on-picture',
] as const;

export type Layout =
  | 'grid'
  | 'primary-on-left'
  | 'primary-on-top'
  | 'picture-in-picture'
  | 'wrapped'
  | 'wrapped-static'
  | 'transition'
  | 'picture-on-picture';

export type RoomStore = {
  inputs: InputConfig[];
  layout: Layout;
  resolution: Resolution;
  updateState: (inputs: InputConfig[], layout: Layout) => void;
};

export function createRoomStore(resolution: Resolution = { width: 2560, height: 1440 }): StoreApi<RoomStore> {
  return createStore<RoomStore>(set => ({
    inputs: [],
    layout: 'grid',
    resolution,
    updateState: (inputs: InputConfig[], layout: Layout) => {
      set(_state => ({ inputs, layout }));
    },
  }));
}

export function useResolution() {
  const store = useContext(StoreContext);
  return useStore(store, state => state.resolution);
}

export function useIsVertical() {
  const resolution = useResolution();
  return resolution.height > resolution.width;
}

export const StoreContext = createContext<StoreApi<RoomStore>>(createRoomStore());
