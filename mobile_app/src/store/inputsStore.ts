import { create } from "zustand";
import type {
  InputCard,
  SortMode,
  SortDirection,
  SortAxis,
} from "../types/input";

interface InputsSortConfig {
  mode: SortMode;
  axis: SortAxis;
  direction: SortDirection;
}

interface InputsState {
  inputs: InputCard[];
  sortConfig: InputsSortConfig;
  gridColumns: number;
  /** Whether removal confirmation dialog is enabled */
  confirmRemoval: boolean;

  setInputs: (inputs: InputCard[]) => void;
  updateInput: (id: string, changes: Partial<InputCard>) => void;
  removeInput: (id: string) => void;
  reorderInputs: (orderedIds: string[]) => void;
  setSortConfig: (config: Partial<InputsSortConfig>) => void;
  setGridColumns: (columns: number) => void;
  setConfirmRemoval: (enabled: boolean) => void;
}

export const useInputsStore = create<InputsState>()((set) => ({
  inputs: [],
  sortConfig: {
    mode: "prominence",
    axis: "row",
    direction: "desc",
  },
  gridColumns: 2,
  confirmRemoval: true,

  setInputs: (inputs) => set({ inputs }),
  updateInput: (id, changes) =>
    set((state) => ({
      inputs: (() => {
        let found = false;
        const updated = state.inputs.map((input) => {
          if (input.id !== id) return input;
          found = true;
          return { ...input, ...changes };
        });

        if (found) return updated;

        return [
          ...updated,
          {
            id,
            name: changes.name ?? id,
            isRunning: changes.isRunning ?? false,
            isHidden: changes.isHidden ?? false,
            isMuted: changes.isMuted ?? false,
            isAudioOnly: changes.isAudioOnly ?? false,
            movementPercent: changes.movementPercent ?? 0,
            inputVolume: changes.inputVolume ?? 0.7,
            audioLevel: changes.audioLevel ?? 0,
            videoStreamUrl: changes.videoStreamUrl ?? null,
            displaySize: changes.displaySize ?? 0,
          },
        ];
      })(),
    })),
  removeInput: (id) =>
    set((state) => ({
      inputs: state.inputs.filter((input) => input.id !== id),
    })),
  reorderInputs: (orderedIds) =>
    set((state) => {
      const map = new Map(state.inputs.map((input) => [input.id, input]));
      const reordered = orderedIds
        .map((id) => map.get(id))
        .filter((input): input is InputCard => input !== undefined);
      return { inputs: reordered };
    }),
  setSortConfig: (config) =>
    set((state) => ({ sortConfig: { ...state.sortConfig, ...config } })),
  setGridColumns: (gridColumns) => set({ gridColumns }),
  setConfirmRemoval: (confirmRemoval) => set({ confirmRemoval }),
}));
