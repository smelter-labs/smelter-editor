import type { StoreApi } from 'zustand';
import { createStore } from 'zustand';
import type { ShaderConfig, Resolution, Layout, ActiveTransition } from '../types';
import { Layouts } from '../types';
import { createContext, useContext } from 'react';
import { useStore } from 'zustand';

export type { SnakeGameCell, SnakeEventType, SnakeEventApplicationMode, SnakeEventShaderMapping, SnakeEventShaderConfig, ActiveSnakeEffect, SnakeGameState, SnakeGameOverPlayer, SnakeGameOverData } from '../snakeGame/types';
export { Layouts };
export type { Layout };
import type { SnakeGameState, SnakeEventShaderConfig } from '../snakeGame/types';

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
  snakeGameState?: SnakeGameState;
  snakeEventShaders?: SnakeEventShaderConfig;
  snake1Shaders?: ShaderConfig[];
  snake2Shaders?: ShaderConfig[];
  borderColor?: string;
  borderWidth?: number;
  replaceWith?: InputConfig;
  attachedInputs?: InputConfig[];
  absolutePosition?: boolean;
  absoluteTop?: number;
  absoluteLeft?: number;
  absoluteWidth?: number;
  absoluteHeight?: number;
  absoluteTransitionDurationMs?: number;
  absoluteTransitionEasing?: string;
  activeTransition?: ActiveTransition;
  restartFading?: boolean;
};

export type RoomStore = {
  inputs: InputConfig[];
  layout: Layout;
  resolution: Resolution;
  swapDurationMs: number;
  swapOutgoingEnabled: boolean;
  swapFadeInDurationMs: number;
  swapFadeOutDurationMs: number;
  newsStripFadeDuringSwap: boolean;
  newsStripEnabled: boolean;
  frozenImageId: string | null;
  updateState: (inputs: InputConfig[], layout: Layout, swapDurationMs: number, swapOutgoingEnabled: boolean, swapFadeInDurationMs: number, newsStripFadeDuringSwap: boolean, swapFadeOutDurationMs: number, newsStripEnabled: boolean) => void;
  setFrozenImageId: (id: string | null) => void;
};

export function createRoomStore(resolution: Resolution = { width: 2560, height: 1440 }): StoreApi<RoomStore> {
  return createStore<RoomStore>(set => ({
    inputs: [],
    layout: 'grid',
    resolution,
    swapDurationMs: 500,
    swapOutgoingEnabled: true,
    swapFadeInDurationMs: 500,
    swapFadeOutDurationMs: 500,
    newsStripFadeDuringSwap: true,
    newsStripEnabled: false,
    frozenImageId: null,
    updateState: (inputs: InputConfig[], layout: Layout, swapDurationMs: number, swapOutgoingEnabled: boolean, swapFadeInDurationMs: number, newsStripFadeDuringSwap: boolean, swapFadeOutDurationMs: number, newsStripEnabled: boolean) => {
      set(_state => ({ inputs, layout, swapDurationMs, swapOutgoingEnabled, swapFadeInDurationMs, newsStripFadeDuringSwap, swapFadeOutDurationMs, newsStripEnabled }));
    },
    setFrozenImageId: (id: string | null) => {
      set(() => ({ frozenImageId: id }));
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

export function useSwapDurationMs() {
  const store = useContext(StoreContext);
  return useStore(store, state => state.swapDurationMs);
}

export function useSwapOutgoingEnabled() {
  const store = useContext(StoreContext);
  return useStore(store, state => state.swapOutgoingEnabled);
}

export function useSwapFadeInDurationMs() {
  const store = useContext(StoreContext);
  return useStore(store, state => state.swapFadeInDurationMs);
}

export function useSwapFadeOutDurationMs() {
  const store = useContext(StoreContext);
  return useStore(store, state => state.swapFadeOutDurationMs);
}

export function useNewsStripFadeDuringSwap() {
  const store = useContext(StoreContext);
  return useStore(store, state => state.newsStripFadeDuringSwap);
}

export function useNewsStripEnabled() {
  const store = useContext(StoreContext);
  return useStore(store, state => state.newsStripEnabled);
}

export function useLayoutInputs() {
  const store = useContext(StoreContext);
  return useStore(store, state => state.inputs.filter(i => !i.absolutePosition));
}

export function useAbsoluteInputs() {
  const store = useContext(StoreContext);
  return useStore(store, state => state.inputs.filter(i => i.absolutePosition));
}

export function useFrozenImageId() {
  const store = useContext(StoreContext);
  return useStore(store, state => state.frozenImageId);
}

export const StoreContext = createContext<StoreApi<RoomStore>>(createRoomStore());
