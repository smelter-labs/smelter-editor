import { create } from "zustand";
import type { Layer } from "../types/layout";
import type { Resolution } from "@smelter-editor/types";

interface LayoutState {
  layers: Layer[];
  resolution: Resolution;
  /** Grid granularity for the ReshufflableGridWrapper display */
  columns: number;
  rows: number;
  /** True when local changes haven't been synced to server yet */
  isDirty: boolean;

  setLayers: (layers: Layer[]) => void;
  setResolution: (resolution: Resolution) => void;
  setGridConfig: (columns: number, rows: number) => void;
  markDirty: () => void;
  markSynced: () => void;
  /** Remove a deleted input from every layer so no orphaned grid cells remain. */
  removeInputFromLayers: (inputId: string) => void;
}

const DEFAULT_RESOLUTION: Resolution = { width: 1920, height: 1080 };

export const useLayoutStore = create<LayoutState>()((set) => ({
  layers: [],
  resolution: DEFAULT_RESOLUTION,
  columns: 20,
  rows: 20,
  isDirty: false,

  setLayers: (layers) => set({ layers, isDirty: false }),
  setResolution: (resolution) => set({ resolution }),
  setGridConfig: (columns, rows) => set({ columns, rows }),
  markDirty: () => set({ isDirty: true }),
  markSynced: () => set({ isDirty: false }),
  removeInputFromLayers: (inputId) =>
    set((state) => ({
      layers: state.layers.map((l) => ({
        ...l,
        inputs: l.inputs.filter((i) => i.inputId !== inputId),
      })),
    })),
}));
