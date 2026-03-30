import type { StoreApi } from 'zustand';
import { createStore } from 'zustand';

export type HandLandmark = { x: number; y: number };

export type HandLandmarks = {
  hands: Array<{ landmarks: HandLandmark[] }>;
};

export type HandsStore = {
  landmarks: HandLandmarks | null;
  setLandmarks: (landmarks: HandLandmarks | null) => void;
};

export function createHandsStore(): StoreApi<HandsStore> {
  return createStore<HandsStore>((set) => ({
    landmarks: null,
    setLandmarks: (landmarks) => set({ landmarks }),
  }));
}
