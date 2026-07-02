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
  peopleCounts: Record<string, number>;
  peopleBoxes: Record<string, PersonBoxes>;
  shooter: ShooterOverlay | null;
  updateState: (state: RoomStoreState & { layers: Layer[] }) => void;
  setOutputShaders: (shaders: ShaderConfig[]) => void;
  setInputFrozenImage: (inputId: string, imageId: string | null) => void;
  setTranscript: (inputId: string, text: string) => void;
  setPeopleCount: (inputId: string, count: number | null) => void;
  setPeopleBoxes: (inputId: string, boxes: PersonBoxes | null) => void;
  setShooter: (shooter: ShooterOverlay | null) => void;
} & Partial<ViewportProperties>;

/** A detection bounding box, normalized to 0..1 of the input frame. */
export type PersonBox = { x: number; y: number; w: number; h: number };

/**
 * A box after cross-frame tracking: carries a stable identity so it keeps the
 * same Pac-Man ghost color and can be smoothly interpolated across detections.
 */
export type TrackedPersonBox = PersonBox & { id: number; color: number };

/** Boxes plus the frame dimensions they were detected in (for cover mapping). */
export type PersonBoxes = {
  boxes: TrackedPersonBox[];
  frameW: number;
  frameH: number;
  /** When true, render people as Pac-Man ghosts instead of green boxes. */
  ghost?: boolean;
};

/** A player's crosshair in normalized content space [0,1] of the target input. */
export type ShooterCrosshair = {
  clientId: string;
  x: number;
  y: number;
  color: string;
  name: string;
};

/** A short-lived shot effect at a point (content coords + timestamp + kind). */
export type ShooterBurst = {
  id: number;
  x: number;
  y: number;
  at: number;
  kind: 'hit' | 'miss';
};

/** Ghost Shooter overlay state rendered on the target (ghost-enabled) input. */
export type ShooterOverlay = {
  targetInputId: string;
  crosshairs: ShooterCrosshair[];
  scores: { name: string; color: string; score: number }[];
  bursts: ShooterBurst[];
  /** Ghost ids currently shot down (hidden/animated) on the target input. */
  deadGhostIds: number[];
};

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
    peopleCounts: {},
    peopleBoxes: {},
    shooter: null,
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
    setPeopleCount: (inputId: string, count: number | null) => {
      set((state) => {
        const next = { ...state.peopleCounts };
        if (count !== null) next[inputId] = count;
        else delete next[inputId];
        return { peopleCounts: next };
      });
    },
    setPeopleBoxes: (inputId: string, boxes: PersonBoxes | null) => {
      set((state) => {
        const next = { ...state.peopleBoxes };
        if (boxes && boxes.boxes.length > 0) next[inputId] = boxes;
        else delete next[inputId];
        return { peopleBoxes: next };
      });
    },
    setShooter: (shooter: ShooterOverlay | null) => {
      set(() => ({ shooter }));
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
