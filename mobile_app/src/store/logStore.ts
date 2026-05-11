import { create } from "zustand";

export type LogLevel = "log" | "info" | "warn" | "error" | "debug";

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  message: string;
}

interface LogState {
  entries: LogEntry[];
  appendEntry: (entry: Omit<LogEntry, "id">) => void;
  clear: () => void;
}

const MAX_ENTRIES = 250;
let nextId = 0;

export const useLogStore = create<LogState>((set) => ({
  entries: [],
  appendEntry: (entry) =>
    set((state) => ({
      entries: [
        ...state.entries.slice(
          Math.max(0, state.entries.length - MAX_ENTRIES + 1),
        ),
        { ...entry, id: `${Date.now()}-${++nextId}` },
      ],
    })),
  clear: () => set({ entries: [] }),
}));
