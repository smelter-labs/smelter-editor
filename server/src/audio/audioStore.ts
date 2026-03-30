import type { StoreApi } from 'zustand';
import { createStore } from 'zustand';
import { AUDIO_BAND_COUNT } from '../types';

export const EMPTY_BANDS: number[] = new Array(AUDIO_BAND_COUNT).fill(0);

export type AudioStoreState = {
  bands: number[];
  setBands: (bands: number[]) => void;
  clearBands: () => void;
};

export function createAudioStore(): StoreApi<AudioStoreState> {
  return createStore<AudioStoreState>((set) => ({
    bands: EMPTY_BANDS,
    setBands: (bands) => set({ bands }),
    clearBands: () => set({ bands: EMPTY_BANDS }),
  }));
}
