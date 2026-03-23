import { create } from "zustand";
import type { Layer } from "../types/layout";

interface LayoutState {
  layers: Layer[];
  /** True when local changes haven't been synced to server yet */
  isDirty: boolean;

  setLayers: (layers: Layer[]) => void;
  markDirty: () => void;
  markSynced: () => void;
}

export const useLayoutStore = create<LayoutState>()((set) => ({
  layers: [],
  isDirty: false,

  setLayers: (layers) => set({ layers, isDirty: false }),
  markDirty: () => set({ isDirty: true }),
  markSynced: () => set({ isDirty: false }),
}));
