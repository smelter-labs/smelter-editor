import { View } from '@swmansion/smelter';

import type { RoomStore } from './store';
import type { StoreApi } from 'zustand';
import { useStore } from 'zustand';
import { useContext } from 'react';
import { StoreContext, useResolution } from './store';
import {
  GridLayout,
  PrimaryOnTopLayout,
  PrimaryOnLeftLayout,
  PictureInPictureLayout,
  WrappedLayout,
  WrappedStaticLayout,
  PictureOnPictureLayout,
} from './layouts';
import { NewsStripOverlay } from './news-strip';

export default function App({ store }: { store: StoreApi<RoomStore> }) {
  return (
    <StoreContext.Provider value={store}>
      <OutputScene />
    </StoreContext.Provider>
  );
}

function OutputScene() {
  const store = useContext(StoreContext);
  const layout = useStore(store, state => state.layout);
  const resolution = useResolution();
  const { width, height } = resolution;

  return (
    <View style={{ backgroundColor: '#000000', padding: 0, width, height, overflow: 'visible' }}>
      {layout === 'grid' ? (
        <GridLayout />
      ) : layout === 'primary-on-top' ? (
        <PrimaryOnTopLayout />
      ) : layout === 'primary-on-left' ? (
        <PrimaryOnLeftLayout />
      ) : layout === 'picture-in-picture' ? (
        <PictureInPictureLayout />
      ) : layout === 'wrapped' ? (
        <WrappedLayout />
      ) : layout === 'wrapped-static' ? (
        <WrappedStaticLayout />
      ) : layout === 'picture-on-picture' ? (
        <PictureOnPictureLayout />
      ) : null}
      <NewsStripOverlay />
    </View>
  );
}
