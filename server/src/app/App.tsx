import { View, Rescaler, Shader } from '@swmansion/smelter';

import type { RoomStore } from './store';
import type { StoreApi } from 'zustand';
import { StoreContext, useResolution, useInputs, useOutputShaders, useViewport } from './store';
import { NewsStripOverlay } from './news-strip';
import { Input } from '../inputs/inputs';
import { wrapWithShaders } from '../utils/shaderUtils';
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
  const outputShaders = useOutputShaders();
  const viewport = useViewport();
  const { width, height } = resolution;

  const activeOutputShaders = outputShaders.filter((s) => s.enabled);

  const vT = viewport.viewportTop ?? 0;
  const vL = viewport.viewportLeft ?? 0;
  const vW = viewport.viewportWidth ?? width;
  const vH = viewport.viewportHeight ?? height;
  const hasViewport = vT !== 0 || vL !== 0 || vW !== width || vH !== height;

  const viewportTransition = {
    durationMs: viewport.viewportTransitionDurationMs ?? 300,
    easingFunction: buildEasingFunction(viewport.viewportTransitionEasing),
  };

  const innerScene = (
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

        let inner = <Input input={input} />;

        if (hasCrop) {
          inner = (
            <Shader
              shaderId='crop'
              resolution={{ width: w, height: h }}
              shaderParam={{
                type: 'struct',
                value: [
                  { type: 'f32', fieldName: 'crop_top', value: cT / h },
                  { type: 'f32', fieldName: 'crop_left', value: cL / w },
                  { type: 'f32', fieldName: 'crop_right', value: cR / w },
                  { type: 'f32', fieldName: 'crop_bottom', value: cB / h },
                ],
              }}>
              {inner}
            </Shader>
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

  const scene = hasViewport ? (
    <View style={{ width, height, backgroundColor: '#000000' }}>
      <Rescaler
        id='viewport'
        transition={viewportTransition}
        style={{ top: vT, left: vL, width: vW, height: vH }}>
        {innerScene}
      </Rescaler>
    </View>
  ) : (
    innerScene
  );

  return wrapWithShaders(scene, activeOutputShaders, resolution);
}
