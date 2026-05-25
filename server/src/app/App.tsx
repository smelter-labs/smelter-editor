import React from 'react';
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
  const n = layer.inputs.length;
  const visibleCount = Math.max(1, Math.min(carousel.visibleCount ?? 1, n));
  const gap = Math.max(0, carousel.gap ?? 0);
  const cellW = slot.width / visibleCount;
  const tileWidth = Math.max(0, cellW - gap);
  const direction = carousel.lastDirection ?? 'next';
  const easing = buildEasingFunction(carousel.easing);
  // Hidden slides snap (no animation) to the entry side based on direction so
  // they never fly visibly across the slot.
  const hiddenOffset = direction === 'next' ? slot.width : -cellW;

  // Wrap-aware signed distance from activeIndex.
  // signedDist === 0           → active (leftmost visible)
  // signedDist === k in [1, visibleCount-1] → other visible slides
  // signedDist === visibleCount → entering from the right
  // signedDist === -1          → exiting to the left
  // others                     → hidden (snap to hiddenOffset)
  const signedDistOf = (i: number, activeIndex: number, preferPositive: boolean): number => {
    if (n === 0) return 0;
    const raw = ((i - activeIndex) % n + n) % n;
    if (raw === 0) return 0;
    if (preferPositive) return raw > visibleCount ? raw - n : raw;
    return raw > n / 2 ? raw - n : raw;
  };

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

        const cur = signedDistOf(i, carousel.activeIndex, direction === 'prev');
        const prev =
          carousel.previousActiveIndex !== undefined
            ? signedDistOf(i, carousel.previousActiveIndex, direction === 'next')
            : cur;

        const positionFor = (sd: number): number => {
          if (sd === -1) return -cellW;
          if (sd === visibleCount) return visibleCount * cellW;
          if (sd >= 0 && sd < visibleCount) return sd * cellW;
          return hiddenOffset;
        };

        const offsetLeft = positionFor(cur);

        // Animate only when this slide moved by at most one cell and both
        // positions lie in the participating window [-1, visibleCount].
        // This prevents wrap-around slides from flying across the slot
        // (e.g. exiting on the left and re-entering on the right) by
        // snapping them instead.
        const participates = (sd: number) => sd >= -1 && sd <= visibleCount;
        const shouldAnimate =
          participates(cur) &&
          participates(prev) &&
          Math.abs(cur - prev) <= 1;
        // When snapping, leave transition undefined so Smelter applies its
        // default (no animation) without remembering a 0ms transition that
        // would bleed into subsequent updates. For animated slides, set
        // shouldInterrupt: true so rapid clicks pick up from the current
        // visual position instead of queueing behind a previous transition.
        const transition = shouldAnimate
          ? {
              durationMs: carousel.durationMs,
              easingFunction: easing,
              shouldInterrupt: true,
            }
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
              resolution={{ width: Math.max(1, tileWidth), height: slot.height }}
              shaderParam={{
                type: 'struct',
                value: [
                  { type: 'f32', fieldName: 'crop_top', value: cT / slot.height },
                  { type: 'f32', fieldName: 'crop_left', value: cL / Math.max(1, tileWidth) },
                  { type: 'f32', fieldName: 'crop_right', value: cR / Math.max(1, tileWidth) },
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
              width: tileWidth,
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
          {layer.enabled === false
            ? null
            : layer.inputs.map((item) => {
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
                      easingFunction: buildEasingFunction(
                        item.transitionEasing,
                      ),
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

      {/* YOLO bounding boxes — rendered at scene level over the composed output.
          Boxes are normalised to [0, 1] by YoloController.receiveBoxes, so we
          simply scale by the scene resolution here. */}
      {inputs.flatMap((input) =>
        (input.yoloBoundingBoxes ?? []).map((box, bi) => (
          <View
            key={`yolo-${input.inputId}-${bi}`}
            style={{
              top: box.y * height,
              left: box.x * width,
              width: Math.max(1, box.width * width),
              height: Math.max(1, box.height * height),
              borderWidth: 3,
              borderColor: input.yoloBoxColor ?? '#ff0000',
            }}
          />
        )),
      )}
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
