import { create } from "zustand";
import type { Layer } from "../types/layout";
import type { Resolution } from "@smelter-editor/types";

type LayerInputLike = {
  inputId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  transitionDurationMs?: number;
  transitionEasing?: string;
};

const areLayerInputsEqual = (
  first: LayerInputLike[],
  second: LayerInputLike[],
): boolean => {
  if (first === second) return true;
  if (first.length !== second.length) return false;

  for (let index = 0; index < first.length; index += 1) {
    const a = first[index];
    const b = second[index];
    if (!b) return false;
    if (
      a.inputId !== b.inputId ||
      a.x !== b.x ||
      a.y !== b.y ||
      a.width !== b.width ||
      a.height !== b.height ||
      a.transitionDurationMs !== b.transitionDurationMs ||
      a.transitionEasing !== b.transitionEasing
    ) {
      return false;
    }
  }

  return true;
};

const areLayerBehaviorsEqual = (
  first: Layer["behavior"],
  second: Layer["behavior"],
): boolean => {
  if (first === second) return true;
  if (!first || !second) return first === second;
  if (first.type !== second.type) return false;

  if (
    first.horizontalSpacing !== second.horizontalSpacing ||
    first.verticalSpacing !== second.verticalSpacing
  ) {
    return false;
  }

  switch (first.type) {
    case "equal-grid": {
      const secondEqualGrid = second as Extract<
        NonNullable<Layer["behavior"]>,
        { type: "equal-grid" }
      >;
      return (
        first.resolveCollisions === secondEqualGrid.resolveCollisions &&
        first.objectFit === secondEqualGrid.objectFit &&
        first.autoscale === secondEqualGrid.autoscale &&
        first.rows === secondEqualGrid.rows &&
        first.cols === secondEqualGrid.cols
      );
    }
    case "approximate-aspect-grid": {
      const secondApproximate = second as Extract<
        NonNullable<Layer["behavior"]>,
        { type: "approximate-aspect-grid" }
      >;
      return first.resolveCollisions === secondApproximate.resolveCollisions;
    }
    case "exact-aspect-grid":
    case "picture-in-picture":
      return true;
    default:
      return false;
  }
};

const isLayerEquivalent = (first: Layer, second: Layer): boolean => {
  if (first.id !== second.id) return false;
  if (
    !areLayerInputsEqual(
      first.inputs as LayerInputLike[],
      second.inputs as LayerInputLike[],
    )
  ) {
    return false;
  }

  return areLayerBehaviorsEqual(first.behavior, second.behavior);
};

const mergeLayersWithStructuralSharing = (
  previous: Layer[],
  incoming: Layer[],
): Layer[] => {
  if (previous.length === 0) return incoming;

  const merged = incoming.map((nextLayer, index) => {
    const prevLayer = previous[index];
    if (!prevLayer) return nextLayer;
    return isLayerEquivalent(prevLayer, nextLayer) ? prevLayer : nextLayer;
  });

  const unchanged =
    merged.length === previous.length &&
    merged.every((layer, index) => layer === previous[index]);

  return unchanged ? previous : merged;
};

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
const DEFAULT_COLUMNS = Math.round(DEFAULT_RESOLUTION.width / 50);
const DEFAULT_ROWS = Math.round(DEFAULT_RESOLUTION.height / 50);

export const useLayoutStore = create<LayoutState>()((set) => ({
  layers: [],
  resolution: DEFAULT_RESOLUTION,
  columns: DEFAULT_COLUMNS,
  rows: DEFAULT_ROWS,
  isDirty: false,

  setLayers: (layers) =>
    set((state) => ({
      layers: mergeLayersWithStructuralSharing(state.layers, layers),
      isDirty: false,
    })),
  setResolution: (resolution) => set({ resolution }),
  setGridConfig: (columns, rows) => set({ columns, rows }),
  markDirty: () => set({ isDirty: true }),
  markSynced: () => set({ isDirty: false }),
  removeInputFromLayers: (inputId) =>
    set((state) => {
      let changed = false;
      const nextLayers = state.layers.map((layer) => {
        const nextInputs = layer.inputs.filter(
          (input) => input.inputId !== inputId,
        );
        if (nextInputs.length === layer.inputs.length) {
          return layer;
        }
        changed = true;
        return { ...layer, inputs: nextInputs };
      });

      return changed ? { layers: nextLayers } : state;
    }),
}));
