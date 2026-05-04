import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface SettingsState {
  arrowNavigation: boolean;
  setArrowNavigation: (value: boolean) => void;
  gridFactor: number;
  setGridFactor: (value: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      arrowNavigation: false,
      setArrowNavigation: (arrowNavigation) => set({ arrowNavigation }),
      gridFactor: 50,
      setGridFactor: (gridFactor) => set({ gridFactor }),
    }),
    {
      name: "settings-storage",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
