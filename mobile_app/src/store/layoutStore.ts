import { create } from "zustand";
import type { GridItem } from "../types/layout";

interface LayoutState {
  items: GridItem[];
  columns: number;
  rows: number;
  /** True when local changes haven't been synced to server yet */
  isDirty: boolean;

  setItems: (items: GridItem[]) => void;
  setGridConfig: (columns: number, rows: number) => void;
  updateItem: (id: string, changes: Partial<GridItem>) => void;
  markDirty: () => void;
  markSynced: () => void;
}

export const useLayoutStore = create<LayoutState>()((set) => ({
  items: [],
  columns: 4,
  rows: 3,
  isDirty: false,

  setItems: (items) => set({ items, isDirty: false }),
  setGridConfig: (columns, rows) => set({ columns, rows, isDirty: true }),
  updateItem: (id, changes) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id ? { ...item, ...changes } : item,
      ),
      isDirty: true,
    })),
  markDirty: () => set({ isDirty: true }),
  markSynced: () => set({ isDirty: false }),
}));
