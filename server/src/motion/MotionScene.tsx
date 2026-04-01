import { InputStream, View, Rescaler } from '@swmansion/smelter';
import type { StoreApi } from 'zustand';
import { createStore } from 'zustand';
import { createContext, useContext } from 'react';
import { useStore } from 'zustand';

/** Each input cell in the grid. */
export const MOTION_CELL_WIDTH = 320;
const MOTION_CELL_HEIGHT = 180;
/** Max simultaneous motion-tracked inputs. */
export const MOTION_MAX_SLOTS = 8;
/** Fixed output resolution (never changes). */
export const MOTION_GRID_WIDTH = MOTION_CELL_WIDTH * MOTION_MAX_SLOTS;
export const MOTION_GRID_HEIGHT = MOTION_CELL_HEIGHT;

export type MotionStore = {
  inputIds: string[];
  setInputIds: (ids: string[]) => void;
};

export function createMotionStore(): StoreApi<MotionStore> {
  return createStore<MotionStore>((set) => ({
    inputIds: [],
    setInputIds: (ids: string[]) => set({ inputIds: ids }),
  }));
}

const MotionStoreContext = createContext<StoreApi<MotionStore>>(null!);

function MotionGrid() {
  const store = useContext(MotionStoreContext);
  const inputIds = useStore(store, (s) => s.inputIds);

  return (
    <View
      style={{
        width: MOTION_GRID_WIDTH,
        height: MOTION_GRID_HEIGHT,
        direction: 'row',
      }}>
      {inputIds.map((id) => (
        <Rescaler
          key={id}
          style={{ width: MOTION_CELL_WIDTH, height: MOTION_CELL_HEIGHT }}>
          <InputStream inputId={id} />
        </Rescaler>
      ))}
    </View>
  );
}

export function MotionScene({ store }: { store: StoreApi<MotionStore> }) {
  return (
    <MotionStoreContext.Provider value={store}>
      <MotionGrid />
    </MotionStoreContext.Provider>
  );
}
