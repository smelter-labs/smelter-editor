import { InputStream, View, Rescaler } from '@swmansion/smelter';
import type { StoreApi } from 'zustand';
import { createStore } from 'zustand';
import { createContext, useContext } from 'react';
import { useStore } from 'zustand';

const SCENE_SIZE = 16;

export type CaptionsPullStore = {
  inputIds: string[];
  setInputIds: (ids: string[]) => void;
};

export function createCaptionsPullStore(): StoreApi<CaptionsPullStore> {
  return createStore<CaptionsPullStore>((set) => ({
    inputIds: [],
    setInputIds: (inputIds) => set({ inputIds }),
  }));
}

const CaptionsPullStoreContext = createContext<StoreApi<CaptionsPullStore>>(
  null!,
);

/**
 * Hidden scene that keeps InputStreams alive for inputs with transcription. Side-channel audio is only decoded when an input appears
 * in a rendered composition; this output (like MotionScene) pulls decode
 * without affecting the main WHEP mix volumes.
 */
function CaptionsPullGrid() {
  const store = useContext(CaptionsPullStoreContext);
  const inputIds = useStore(store, (s) => s.inputIds);

  return (
    <View
      style={{
        width: SCENE_SIZE,
        height: SCENE_SIZE,
        backgroundColor: '#000000',
      }}>
      {inputIds.map((inputId) => (
        <Rescaler
          key={inputId}
          style={{ width: SCENE_SIZE, height: SCENE_SIZE }}>
          <InputStream inputId={inputId} volume={1} />
        </Rescaler>
      ))}
    </View>
  );
}

export function CaptionsScene({
  store,
}: {
  store: StoreApi<CaptionsPullStore>;
}) {
  return (
    <CaptionsPullStoreContext.Provider value={store}>
      <CaptionsPullGrid />
    </CaptionsPullStoreContext.Provider>
  );
}
