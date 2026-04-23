import { View, Rescaler, Shader } from '@swmansion/smelter';

import type { RoomStore } from './store';
import type { StoreApi } from 'zustand';
import {
  StoreContext,
  useResolution,
  useInputs,
  useLayers,
  useOutputShaders,
  useViewport,
} from './store';
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
  const layers = useLayers();
  const { width, height } = resolution;
  const outputShaders = useOutputShaders();
  const viewport = useViewport();
  const inputMap = new Map(inputs.map((input) => [input.inputId, input]));
  const activeOutputShaders = outputShaders.filter((s) => s.enabled);
  const layersReversed = [...layers].reverse();

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
      {layersReversed.map((layer) => (
        <View
          key={layer.id}
          style={{ top: 0, left: 0, width, height, overflow: 'visible' }}>
          {layer.inputs.map((item, itemIndex) => {
            const cT = item.cropTop ?? 0;
            const cL = item.cropLeft ?? 0;
            const cR = item.cropRight ?? 0;
            const cB = item.cropBottom ?? 0;
            const hasCrop = cT || cL || cR || cB;

            const input = inputMap.get(item.inputId);
            if (!input || input.hidden) return null;
            let inner = <Input input={input} />;

            if (hasCrop) {
              inner = (
                <Shader
                  shaderId='crop'
                  resolution={{ width: item.width, height: item.height }}
                  shaderParam={{
                    type: 'struct',
                    value: [
                      {
                        type: 'f32',
                        fieldName: 'crop_top',
                        value: cT / item.height,
                      },
                      {
                        type: 'f32',
                        fieldName: 'crop_left',
                        value: cL / item.width,
                      },
                      {
                        type: 'f32',
                        fieldName: 'crop_right',
                        value: cR / item.width,
                      },
                      {
                        type: 'f32',
                        fieldName: 'crop_bottom',
                        value: cB / item.height,
                      },
                    ],
                  }}>
                  {inner}
                </Shader>
              );
            }

            const layerItemKey = `${item.inputId}:${itemIndex}`;
            return (
              <Rescaler
                key={layerItemKey}
                id={`layer-${layer.id}-${item.inputId}-${itemIndex}`}
                transition={{
                  durationMs: item.transitionDurationMs ?? 300,
                  easingFunction: buildEasingFunction(item.transitionEasing),
                }}
                style={{
                  top: item.y,
                  left: item.x,
                  width: item.width,
                  height: item.height,
                }}>
                {inner}
              </Rescaler>
            );
          })}
        </View>
      ))}
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
