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
  ViewportProperties,
} from '../types';
import type { HandsStore } from '../hands/handStore';
import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

export type { SnakeGameState } from '../snakeGame/types';
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
  hidden?: boolean;
} & InputDisplayProperties &
  Partial<TextInputProperties> &
  Partial<BorderProperties> &
  Partial<AbsolutePositionProperties> &
  Partial<CropProperties> &
  Partial<SnakeGameDisplayProperties>;

export type RoomStoreState = {
  inputs: InputConfig[];
  /** Connected inputs with transcription — drives hidden side-channel decode. */
  transcriptionSideChannelInputIds: string[];
  swapDurationMs: number;
  swapOutgoingEnabled: boolean;
  swapFadeInDurationMs: number;
  swapFadeOutDurationMs: number;
} & Partial<ViewportProperties>;

export type RoomStore = {
  inputs: InputConfig[];
  layers: Layer[];
  resolution: Resolution;
  outputShaders: ShaderConfig[];
  transcriptionSideChannelInputIds: string[];
  swapDurationMs: number;
  swapOutgoingEnabled: boolean;
  swapFadeInDurationMs: number;
  swapFadeOutDurationMs: number;
  transcripts: Record<string, string>;
  updateState: (state: RoomStoreState & { layers: Layer[] }) => void;
  setOutputShaders: (shaders: ShaderConfig[]) => void;
  setInputFrozenImage: (inputId: string, imageId: string | null) => void;
  setTranscript: (inputId: string, text: string) => void;
} & Partial<ViewportProperties>;

export function createRoomStore(
  resolution: Resolution = { width: 2560, height: 1440 },
): StoreApi<RoomStore> {
  return createStore<RoomStore>((set) => ({
    inputs: [],
    layers: [],
    resolution,
    outputShaders: [],
    transcriptionSideChannelInputIds: [],
    swapDurationMs: 500,
    swapOutgoingEnabled: true,
    swapFadeInDurationMs: 500,
    swapFadeOutDurationMs: 500,
    transcripts: {},
    updateState: (incoming) => {
      const {
        inputs,
        layers,
        transcriptionSideChannelInputIds,
        swapDurationMs,
        swapOutgoingEnabled,
        swapFadeInDurationMs,
        swapFadeOutDurationMs,
        viewportTop,
        viewportLeft,
        viewportWidth,
        viewportHeight,
        viewportTransitionDurationMs,
        viewportTransitionEasing,
      } = incoming;
      set(() => ({
        inputs,
        layers,
        transcriptionSideChannelInputIds,
        swapDurationMs,
        swapOutgoingEnabled,
        swapFadeInDurationMs,
        swapFadeOutDurationMs,
        viewportTop,
        viewportLeft,
        viewportWidth,
        viewportHeight,
        viewportTransitionDurationMs,
        viewportTransitionEasing,
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
    setTranscript: (inputId: string, text: string) => {
      set((state) => {
        const next = { ...state.transcripts };
        if (text) next[inputId] = text;
        else delete next[inputId];
        return { transcripts: next };
      });
    },
  }));
}

export function useResolution() {
  const store = useContext(StoreContext);
  return useStore(store, (state) => state.resolution);
}

function useIsVertical() {
  const resolution = useResolution();
  return resolution.height > resolution.width;
}

function useSwapDurationMs() {
  const store = useContext(StoreContext);
  return useStore(store, (state) => state.swapDurationMs);
}

function useSwapFadeInDurationMs() {
  const store = useContext(StoreContext);
  return useStore(store, (state) => state.swapFadeInDurationMs);
}

function useSwapFadeOutDurationMs() {
  const store = useContext(StoreContext);
  return useStore(store, (state) => state.swapFadeOutDurationMs);
}

export function useInputs() {
  const store = useContext(StoreContext);
  return useStore(store, (state) => state.inputs);
}

export function useTranscriptionSideChannelInputIds() {
  const store = useContext(StoreContext);
  return useStore(store, (state) => state.transcriptionSideChannelInputIds);
}

export function useLayers() {
  const store = useContext(StoreContext);
  return useStore(store, (state) => state.layers);
}

export function useOutputShaders() {
  const store = useContext(StoreContext);
  return useStore(store, (state) => state.outputShaders);
}

export function useViewport() {
  const store = useContext(StoreContext);
  return useStore(
    store,
    useShallow((state) => ({
      viewportTop: state.viewportTop,
      viewportLeft: state.viewportLeft,
      viewportWidth: state.viewportWidth,
      viewportHeight: state.viewportHeight,
      viewportTransitionDurationMs: state.viewportTransitionDurationMs,
      viewportTransitionEasing: state.viewportTransitionEasing,
    })),
  );
}

export const StoreContext =
  createContext<StoreApi<RoomStore>>(createRoomStore());
