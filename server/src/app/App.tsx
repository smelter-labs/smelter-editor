import { View, Rescaler } from '@swmansion/smelter';

import type { RoomStore } from './store';
import type { StoreApi } from 'zustand';
import { StoreContext, useResolution, useInputs } from './store';
import { NewsStripOverlay } from './news-strip';
import { Input } from '../inputs/inputs';
import { AudioStoreContext } from '../audio/AudioStoreContext';
import type { AudioStoreState } from '../audio/audioStore';
import { createAudioStore } from '../audio/audioStore';

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

const defaultAudioStore = createAudioStore();

export default function App({
  store,
  audioStore,
}: {
  store: StoreApi<RoomStore>;
  audioStore?: StoreApi<AudioStoreState>;
}) {
  return (
    <StoreContext.Provider value={store}>
      <AudioStoreContext.Provider value={audioStore ?? defaultAudioStore}>
        <OutputScene />
      </AudioStoreContext.Provider>
    </StoreContext.Provider>
  );
}

function OutputScene() {
  const resolution = useResolution();
  const inputs = useInputs();
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
      {inputs.map((input) => {
        const t = input.absoluteTop ?? 0;
        const l = input.absoluteLeft ?? 0;
        const w = input.absoluteWidth ?? Math.round(width * 0.5);
        const h = input.absoluteHeight ?? Math.round(height * 0.5);
        const cT = input.cropTop ?? 0;
        const cL = input.cropLeft ?? 0;
        const cR = input.cropRight ?? 0;
        const cB = input.cropBottom ?? 0;
        const hasCrop = cT || cL || cR || cB;

        const transition = {
          durationMs: input.absoluteTransitionDurationMs ?? 300,
          easingFunction: buildEasingFunction(input.absoluteTransitionEasing),
        };

        const inner = <Input input={input} />;

        if (hasCrop) {
          const visibleW = w - cL - cR;
          const visibleH = h - cT - cB;
          return (
            <Rescaler
              key={input.inputId}
              id={`absolute-${input.inputId}`}
              transition={transition}
              style={{
                top: t + cT,
                left: l + cL,
                width: visibleW,
                height: visibleH,
              }}>
              <View
                style={{
                  overflow: 'hidden' as const,
                  width: visibleW,
                  height: visibleH,
                }}>
                <Rescaler
                  id={`crop-${input.inputId}`}
                  transition={transition}
                  style={{
                    top: -cT,
                    left: -cL,
                    width: w,
                    height: h,
                  }}>
                  {inner}
                </Rescaler>
              </View>
            </Rescaler>
          );
        }

        return (
          <Rescaler
            key={input.inputId}
            id={`absolute-${input.inputId}`}
            transition={transition}
            style={{ top: t, left: l, width: w, height: h }}>
            {inner}
          </Rescaler>
        );
      })}
      <NewsStripOverlay />
    </View>
  );
}
