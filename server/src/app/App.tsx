import { View, Rescaler, Shader } from '@swmansion/smelter';

import type { RoomStore, InputConfig } from './store';
import type { Layer } from '../types';
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

function CarouselSlot({
  layer,
  inputMap,
}: {
  layer: Layer;
  inputMap: Map<string, InputConfig>;
}) {
  const carousel = layer.carousel!;
  const slot = layer.inputs[0];
  if (!slot) return null;
  const W = slot.width;
  const direction = carousel.lastDirection ?? 'next';
  const easing = buildEasingFunction(carousel.easing);
  // For 'next': new slide enters from right (+W), old slide exits to left (-W).
  // For 'prev': new slide enters from left (-W), old slide exits to right (+W).
  const enterOffset = direction === 'next' ? W : -W;
  const exitOffset = -enterOffset;

  return (
    <View
      key={layer.id}
      style={{
        top: slot.y,
        left: slot.x,
        width: slot.width,
        height: slot.height,
        overflow: 'hidden',
      }}>
      {layer.inputs.map((item, i) => {
        const input = inputMap.get(item.inputId);
        if (!input || input.hidden) return null;

        const isActive = i === carousel.activeIndex;
        const isPrevious = i === carousel.previousActiveIndex;
        // Active slide animates to 0; previously active slide animates out to the
        // opposite side; all other slides snap (no transition) to the entry side
        // so they don't visibly fly across the slot when direction changes.
        const offsetLeft = isActive ? 0 : isPrevious ? exitOffset : enterOffset;
        const transition =
          isActive || isPrevious
            ? { durationMs: carousel.durationMs, easingFunction: easing }
            : undefined;

        let inner = <Input input={input} />;

        const cT = item.cropTop ?? 0;
        const cL = item.cropLeft ?? 0;
        const cR = item.cropRight ?? 0;
        const cB = item.cropBottom ?? 0;
        if (cT || cL || cR || cB) {
          inner = (
            <Shader
              shaderId='crop'
              resolution={{ width: slot.width, height: slot.height }}
              shaderParam={{
                type: 'struct',
                value: [
                  { type: 'f32', fieldName: 'crop_top', value: cT / slot.height },
                  { type: 'f32', fieldName: 'crop_left', value: cL / slot.width },
                  { type: 'f32', fieldName: 'crop_right', value: cR / slot.width },
                  { type: 'f32', fieldName: 'crop_bottom', value: cB / slot.height },
                ],
              }}>
              {inner}
            </Shader>
          );
        }

        return (
          <Rescaler
            key={`carousel-${layer.id}-${item.inputId}`}
            id={`carousel-${layer.id}-${item.inputId}`}
            transition={transition}
            style={{
              top: 0,
              left: offsetLeft,
              width: slot.width,
              height: slot.height,
            }}>
            {inner}
          </Rescaler>
        );
      })}
    </View>
  );
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
      {layersReversed.map((layer) => {
        if (layer.carousel && layer.inputs.length > 0) {
          return <CarouselSlot key={layer.id} layer={layer} inputMap={inputMap} />;
        }
        return (
        <View
          key={layer.id}
          style={{ top: 0, left: 0, width, height, overflow: 'visible' }}>
          {layer.enabled === false ? null : layer.inputs.map((item) => {
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

            // Keep identity stable across reorder so Smelter can animate moves
            // instead of remounting the node when index changes.
            const layerItemKey = `${layer.id}:${item.inputId}`;
            return (
              <Rescaler
                key={layerItemKey}
                id={`layer-${layer.id}-${item.inputId}`}
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
        );
      })}
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
