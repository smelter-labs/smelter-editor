import type { StoreApi } from 'zustand';
import { createStore } from 'zustand';
import type {
  Resolution,
  ActiveTransition,
  InputDisplayProperties,
  TextInputProperties,
  AbsolutePositionProperties,
  CropProperties,
  BorderProperties,
  SnakeGameDisplayProperties,
  Layer,
  ShaderConfig,
} from '../types';
import type { HandsStore } from '../hands/handStore';
import { createContext, useContext } from 'react';
import { useStore } from 'zustand';

export type {
  SnakeGameCell,
  SnakeEventType,
  SnakeEventApplicationMode,
  SnakeEventShaderMapping,
  SnakeEventShaderConfig,
  ActiveSnakeEffect,
  SnakeGameState,
  SnakeGameOverPlayer,
  SnakeGameOverData,
} from '../snakeGame/types';
import type { SnakeGameState } from '../snakeGame/types';

export type InputConfig = {
  inputId: string;
  title: string;
  description: string;
  imageId?: string;
  sourceWidth?: number;
  sourceHeight?: number;
  snakeGameState?: SnakeGameState;
  handsSourceInputId?: string;
  handsStore?: StoreApi<HandsStore>;
  replaceWith?: InputConfig;
  attachedInputs?: InputConfig[];
  activeTransition?: ActiveTransition;
  restartFading?: boolean;
  frozenImageId?: string;
} & InputDisplayProperties &
  Partial<TextInputProperties> &
  Partial<BorderProperties> &
  Partial<AbsolutePositionProperties> &
  Partial<CropProperties> &
  Partial<SnakeGameDisplayProperties>;

export type RoomStore = {
  inputs: InputConfig[];
  layers: Layer[];
  resolution: Resolution;
  outputShaders: ShaderConfig[];
  swapDurationMs: number;
  swapOutgoingEnabled: boolean;
  swapFadeInDurationMs: number;
  swapFadeOutDurationMs: number;
  newsStripFadeDuringSwap: boolean;
  newsStripEnabled: boolean;
  updateState: (state: {
    inputs: InputConfig[];
    layers: Layer[];
    swapDurationMs: number;
    swapOutgoingEnabled: boolean;
    swapFadeInDurationMs: number;
    newsStripFadeDuringSwap: boolean;
    swapFadeOutDurationMs: number;
    newsStripEnabled: boolean;
  }) => void;
  setOutputShaders: (shaders: ShaderConfig[]) => void;
  setInputFrozenImage: (inputId: string, imageId: string | null) => void;
};

export function createRoomStore(
  resolution: Resolution = { width: 2560, height: 1440 },
): StoreApi<RoomStore> {
  return createStore<RoomStore>((set) => ({
    inputs: [],
    layers: [],
    resolution,
    outputShaders: [],
    swapDurationMs: 500,
    swapOutgoingEnabled: true,
    swapFadeInDurationMs: 500,
    swapFadeOutDurationMs: 500,
    newsStripFadeDuringSwap: true,
    newsStripEnabled: false,
    updateState: ({
      inputs,
      layers,
      swapDurationMs,
      swapOutgoingEnabled,
      swapFadeInDurationMs,
      newsStripFadeDuringSwap,
      swapFadeOutDurationMs,
      newsStripEnabled,
    }) => {
      set(() => ({
        inputs,
        layers,
        swapDurationMs,
        swapOutgoingEnabled,
        swapFadeInDurationMs,
        newsStripFadeDuringSwap,
        swapFadeOutDurationMs,
        newsStripEnabled,
      }));
    },
    setOutputShaders: (shaders: ShaderConfig[]) => {
      set(() => ({ outputShaders: shaders }));
    },
    setInputFrozenImage: (inputId: string, imageId: string | null) => {
      set((state) => ({
        inputs: state.inputs.map((input) =>
          input.inputId === inputId
            ? { ...input, frozenImageId: imageId ?? undefined }
            : input,
        ),
      }));
    },
  }));
}

export function useResolution() {
  const store = useContext(StoreContext);
  return useStore(store, (state) => state.resolution);
}

export function useIsVertical() {
  const resolution = useResolution();
  return resolution.height > resolution.width;
}

export function useSwapDurationMs() {
  const store = useContext(StoreContext);
  return useStore(store, (state) => state.swapDurationMs);
}

export function useSwapOutgoingEnabled() {
  const store = useContext(StoreContext);
  return useStore(store, (state) => state.swapOutgoingEnabled);
}

export function useSwapFadeInDurationMs() {
  const store = useContext(StoreContext);
  return useStore(store, (state) => state.swapFadeInDurationMs);
}

export function useSwapFadeOutDurationMs() {
  const store = useContext(StoreContext);
  return useStore(store, (state) => state.swapFadeOutDurationMs);
}

export function useNewsStripFadeDuringSwap() {
  const store = useContext(StoreContext);
  return useStore(store, (state) => state.newsStripFadeDuringSwap);
}

export function useNewsStripEnabled() {
  const store = useContext(StoreContext);
  return useStore(store, (state) => state.newsStripEnabled);
}

export function useInputs() {
  const store = useContext(StoreContext);
  return useStore(store, (state) => state.inputs);
}

export function useLayers() {
  const store = useContext(StoreContext);
  return useStore(store, (state) => state.layers);
}

export function useOutputShaders() {
  const store = useContext(StoreContext);
  return useStore(store, (state) => state.outputShaders);
}

export const StoreContext =
  createContext<StoreApi<RoomStore>>(createRoomStore());
