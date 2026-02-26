import type { StoreApi } from 'zustand';
import { createStore } from 'zustand';
import type { ShaderConfig, ShaderParamConfig } from '../shaders/shaders';
import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import type { Resolution } from '../smelter';

export type InputOrientation = 'horizontal' | 'vertical';

export type GameCell = {
  x: number;
  y: number;
  color: string;
  size?: number;
  isHead?: boolean;
  direction?: 'up' | 'down' | 'left' | 'right';
  /** Interpolation progress 0→1 from previous grid position to current (x,y). */
  progress?: number;
};

export type SnakeEventType =
  | 'speed_up'
  | 'cut_opponent'
  | 'got_cut'
  | 'cut_self'
  | 'eat_block'
  | 'bounce_block'
  | 'no_moves'
  | 'game_over';

export type SnakeEventApplicationMode =
  | { mode: 'all' }
  | { mode: 'snake_cells' }
  | { mode: 'first_n'; n: number }
  | { mode: 'sequential'; durationMs: number; delayMs: number };

export type SnakeEventShaderMapping = {
  enabled: boolean;
  shaderId: string;
  params: ShaderParamConfig[];
  application: SnakeEventApplicationMode;
  effectDurationMs: number;
};

export type SnakeEventShaderConfig = Partial<Record<SnakeEventType, SnakeEventShaderMapping>>;

export type ActiveSnakeEffect = {
  eventType: SnakeEventType;
  shaderId: string;
  params: ShaderParamConfig[];
  affectedCellIndices: number[];
  startedAtMs: number;
  endsAtMs: number;
};

export type GameState = {
  boardWidth: number;
  boardHeight: number;
  cellSize: number;
  cells: GameCell[];
  backgroundColor: string;
  cellGap: number;
  boardBorderColor: string;
  boardBorderWidth: number;
  gridLineColor: string;
  gridLineAlpha: number;
  activeEffects?: ActiveSnakeEffect[];
  gameOverData?: GameOverData;
};

export type GameOverPlayer = {
  name: string;
  score: number;
  eaten: number;
  cuts: number;
  color: string;
};

export type GameOverData = {
  winnerName: string;
  reason: string;
  players: GameOverPlayer[];
};

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
  gameState?: GameState;
  snakeEventShaders?: SnakeEventShaderConfig;
  snake1Shaders?: ShaderConfig[];
  snake2Shaders?: ShaderConfig[];
  borderColor?: string;
  borderWidth?: number;
  replaceWith?: InputConfig;
  attachedInputs?: InputConfig[];
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
  'softu-tv',
] as const;

export type Layout =
  | 'grid'
  | 'primary-on-left'
  | 'primary-on-top'
  | 'picture-in-picture'
  | 'wrapped'
  | 'wrapped-static'
  | 'transition'
  | 'picture-on-picture'
  | 'softu-tv';

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
  updateState: (inputs: InputConfig[], layout: Layout, swapDurationMs: number, swapOutgoingEnabled: boolean, swapFadeInDurationMs: number, newsStripFadeDuringSwap: boolean, swapFadeOutDurationMs: number, newsStripEnabled: boolean) => void;
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
    updateState: (inputs: InputConfig[], layout: Layout, swapDurationMs: number, swapOutgoingEnabled: boolean, swapFadeInDurationMs: number, newsStripFadeDuringSwap: boolean, swapFadeOutDurationMs: number, newsStripEnabled: boolean) => {
      set(_state => ({ inputs, layout, swapDurationMs, swapOutgoingEnabled, swapFadeInDurationMs, newsStripFadeDuringSwap, swapFadeOutDurationMs, newsStripEnabled }));
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

export const StoreContext = createContext<StoreApi<RoomStore>>(createRoomStore());
