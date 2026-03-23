import React, { useCallback, useEffect, useMemo } from 'react';
import { type ViewStyle } from 'react-native';
import Animated, {
  LinearTransition,
  measure,
  runOnJS,
  runOnUI,
  useAnimatedRef,
  useSharedValue,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { useDragContext, useIsInGhost } from './DragContext';
import { findCollidingLayer, findPreviewIndex } from './collision';
import { LAYERS_CONTAINER_ID } from './types';

interface DraggableObjectProps {
  objectId: string;
  layerId: string;
  index: number;
  children: React.ReactNode;
  style?: ViewStyle;
}

export function DraggableObject({
  objectId,
  layerId,
  index,
  children,
  style,
}: DraggableObjectProps) {
  const ctx = useDragContext();
  const isInGhost = useIsInGhost();
  const objectRef = useAnimatedRef<Animated.View>();

  // Per-object local measurement cache — written in onBegin (UI thread),
  // copied to shared context only in onStart (when this gesture wins).
  const localStartX = useSharedValue(0);
  const localStartY = useSharedValue(0);
  const localWidth = useSharedValue(0);
  const localHeight = useSharedValue(0);

  // Keep children registry current on every render (skip in ghost)
  useEffect(() => {
    if (isInGhost) return;
    ctx.setChildrenForObject(objectId, children);
  });

  // Measure and register bounds whenever layout changes (skip in ghost)
  const measureAndRegister = useCallback(() => {
    if (isInGhost) return;
    runOnUI(() => {
      'worklet';
      const m = measure(objectRef);
      if (m) {
        runOnJS(ctx.registerObject)(
          objectId,
          layerId,
          { pageX: m.pageX, pageY: m.pageY, width: m.width, height: m.height },
          index,
        );
      }
    })();
  }, [isInGhost, objectId, layerId, index, objectRef, ctx.registerObject]);

  useEffect(() => {
    if (isInGhost) return;
    return () => ctx.unregisterObject(objectId);
  }, [isInGhost, objectId, ctx.unregisterObject]);

  // ─── JS-thread callbacks bridged from gesture worklets ───────────────────────

  const onDragStartJS = useCallback(
    (width: number, height: number) => ctx.startDrag(objectId, width, height),
    [objectId, ctx.startDrag],
  );

  const onDropJS = useCallback(
    () => ctx.handleDrop(objectId, layerId),
    [objectId, layerId, ctx.handleDrop],
  );

  // ─── Destructure shared values for clean worklet captures ────────────────────
  const {
    activeId,
    absoluteX,
    absoluteY,
    translationX,
    translationY,
    itemStartPageX,
    itemStartPageY,
    hoverLayerId,
    layerBounds,
    objectBounds,
    hoverPreviewIndex,
  } = ctx;

  const isLayerDrag = layerId === LAYERS_CONTAINER_ID;

  // ─── Pan gesture ─────────────────────────────────────────────────────────────
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(6)
        .onBegin(() => {
          'worklet';
          // Measure into local cache only — do NOT touch shared context yet.
          // Both this gesture and any nested/outer sibling gesture fire onBegin;
          // writing to shared values here would cause the outer gesture to
          // overwrite the inner gesture's position (or vice-versa).
          const m = measure(objectRef);
          if (m) {
            localStartX.value = m.pageX;
            localStartY.value = m.pageY;
            localWidth.value = m.width;
            localHeight.value = m.height;
          }
        })
        .onStart(() => {
          'worklet';
          // With nested GestureDetectors the inner gesture's onStart fires
          // before the outer one's. The first to arrive sets activeId and wins;
          // the outer gesture sees activeId !== null and bows out.
          if (activeId.value !== null) return;

          activeId.value = objectId;
          itemStartPageX.value = localStartX.value;
          itemStartPageY.value = localStartY.value;
          translationX.value = 0;
          translationY.value = 0;
          runOnJS(onDragStartJS)(localWidth.value, localHeight.value);
        })
        .onChange((e) => {
          'worklet';
          // Only the gesture that won in onStart should drive position/collision.
          if (activeId.value !== objectId) return;

          translationX.value = e.translationX;
          translationY.value = e.translationY;
          absoluteX.value = e.absoluteX;
          absoluteY.value = e.absoluteY;

          const colliding = findCollidingLayer(
            e.absoluteX,
            e.absoluteY,
            layerBounds.value,
            isLayerDrag,
          );
          if (colliding !== hoverLayerId.value) {
            hoverLayerId.value = colliding;
          }

          if (colliding) {
            hoverPreviewIndex.value = findPreviewIndex(
              e.absoluteY,
              colliding,
              objectBounds.value,
              objectId,
            );
          }
        })
        .onFinalize(() => {
          'worklet';
          // Only the winning gesture should clean up.
          if (activeId.value !== objectId) return;
          runOnJS(onDropJS)();
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [objectId, layerId, isLayerDrag, onDragStartJS, onDropJS],
  );

  // In the ghost overlay, just render children without gesture/registration
  if (isInGhost) {
    return (
      <Animated.View
        collapsable={false}
        style={style}
        layout={LinearTransition.duration(200)}
      >
        {children}
      </Animated.View>
    );
  }

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        ref={objectRef}
        collapsable={false}
        style={style}
        layout={LinearTransition.duration(200)}
        onLayout={measureAndRegister}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
