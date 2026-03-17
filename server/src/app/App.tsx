import { View, Rescaler } from '@swmansion/smelter';

import type { RoomStore } from './store';
import type { StoreApi } from 'zustand';
import { useStore } from 'zustand';
import { useContext } from 'react';
import {
  StoreContext,
  useResolution,
  useAbsoluteInputs,
} from './store';
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
import { Input } from '../inputs/inputs';

function buildEasingFunction(easing?: string) {
  if (easing === 'bounce') return 'bounce' as const;
  if (easing === 'cubic_bezier_ease_in_out') {
    return {
      functionName: 'cubic_bezier' as const,
      points: [0.65, 0, 0.35, 1] as [number, number, number, number],
    };
  }
  return 'linear' as const;
}

export default function App({ store }: { store: StoreApi<RoomStore> }) {
  return (
    <StoreContext.Provider value={store}>
      <OutputScene />
    </StoreContext.Provider>
  );
}

function OutputScene() {
  const store = useContext(StoreContext);
  const layout = useStore(store, (state) => state.layout);
  const resolution = useResolution();
  const absoluteInputs = useAbsoluteInputs();
  const { width, height } = resolution;

  return (
    <View
      style={{
        backgroundColor: '#000000',
        padding: 0,
        width,
        height,
        overflow: 'visible',
      }}>
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
      {absoluteInputs.map((input) => (
        <Rescaler
          key={input.inputId}
          id={`absolute-${input.inputId}`}
          transition={{
            durationMs: input.absoluteTransitionDurationMs ?? 300,
            easingFunction: buildEasingFunction(input.absoluteTransitionEasing),
          }}
          style={{
            top: input.absoluteTop ?? 0,
            left: input.absoluteLeft ?? 0,
            width: input.absoluteWidth ?? Math.round(width * 0.5),
            height: input.absoluteHeight ?? Math.round(height * 0.5),
          }}>
          <Input input={input} />
        </Rescaler>
      ))}
      <NewsStripOverlay />
    </View>
  );
}
