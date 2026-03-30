import { View, InputStream } from '@swmansion/smelter';
import type { StoreApi } from 'zustand';
import type { RoomStore } from '../app/store';
import { StoreContext } from '../app/store';
import { useContext } from 'react';
import { useStore } from 'zustand';

const SCENE_SIZE = 16;

/**
 * Lightweight scene for room-level audio analysis.
 * Renders a solid-color View (so video is never empty) and includes
 * an InputStream for every input in the room store so that Smelter's
 * audio mixer produces the program mix.
 */
export function AudioAnalysisScene({ store }: { store: StoreApi<RoomStore> }) {
  return (
    <StoreContext.Provider value={store}>
      <AudioMixer />
    </StoreContext.Provider>
  );
}

function AudioMixer() {
  const store = useContext(StoreContext);
  const inputs = useStore(store, (s) => s.inputs);

  return (
    <View style={{ width: SCENE_SIZE, height: SCENE_SIZE, backgroundColor: '#000000' }}>
      {inputs.map((input) => (
        <InputStream
          key={input.inputId}
          inputId={input.inputId}
          volume={input.volume}
        />
      ))}
    </View>
  );
}
