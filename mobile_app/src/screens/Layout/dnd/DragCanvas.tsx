import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  measure,
  runOnJS,
  runOnUI,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { DragContext, GhostContext, type DragContextValue, type PreviewState } from './DragContext';
import type { LayerBounds, LayerId, ObjectBoundsEntry, OrderChangeEvent } from './types';

interface DragCanvasProps {
  children: React.ReactNode;
  onOrderChange?: (event: OrderChangeEvent) => void;
  style?: ViewStyle;
}

export function DragCanvas({ children, onOrderChange, style }: DragCanvasProps) {
  // ─── Shared values (context) ─────────────────────────────────────────────────
  const activeId = useSharedValue<string | null>(null);
  const absoluteX = useSharedValue(0);
  const absoluteY = useSharedValue(0);
  const translationX = useSharedValue(0);
  const translationY = useSharedValue(0);
  const itemStartPageX = useSharedValue(0);
  const itemStartPageY = useSharedValue(0);
  const hoverLayerId = useSharedValue<string | null>(null);
  const layerBounds = useSharedValue<Record<LayerId, LayerBounds>>({});
  const objectBounds = useSharedValue<Record<string, ObjectBoundsEntry>>({});
  const hoverPreviewIndex = useSharedValue(0);

  // ─── Internal shared values (ghost overlay only) ─────────────────────────────
  const canvasPageX = useSharedValue(0);
  const canvasPageY = useSharedValue(0);
  const dragScale = useSharedValue(1);
  const dragItemWidth = useSharedValue(0);
  const dragItemHeight = useSharedValue(0);

  // ─── JS-thread state ─────────────────────────────────────────────────────────
  const [ghostChildren, setGhostChildren] = useState<React.ReactNode>(null);
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [activeObjectId, setActiveObjectId] = useState<string | null>(null);

  // ─── JS-thread refs ───────────────────────────────────────────────────────────
  const canvasRef = useAnimatedRef<Animated.View>();
  const childrenRegistryRef = useRef<Map<string, React.ReactNode>>(new Map());
  const objectBoundsJSRef = useRef<Record<string, ObjectBoundsEntry>>({});
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverFiredRef = useRef(false);
  const currentDragRef = useRef<{ objectId: string; sourceLayerId: string } | null>(null);
  const onOrderChangeRef = useRef(onOrderChange);
  onOrderChangeRef.current = onOrderChange;

  // ─── Canvas self-measurement ──────────────────────────────────────────────────
  const measureCanvas = useCallback(() => {
    runOnUI(() => {
      'worklet';
      const m = measure(canvasRef);
      if (m) {
        canvasPageX.value = m.pageX;
        canvasPageY.value = m.pageY;
      }
    })();
  }, [canvasRef, canvasPageX, canvasPageY]);

  // ─── Ghost scale spring ───────────────────────────────────────────────────────
  useAnimatedReaction(
    () => activeId.value,
    (current) => {
      dragScale.value =
        current !== null
          ? withSpring(1.04, { damping: 15, stiffness: 300 })
          : withSpring(1, { damping: 15, stiffness: 300 });
    },
  );

  // ─── Preview state ────────────────────────────────────────────────────────────
  const updatePreviewState = useCallback((layerId: string | null, index: number) => {
    if (!layerId) {
      setPreviewState(null);
    } else {
      setPreviewState((prev) => {
        if (prev?.layerId === layerId && prev?.index === index) return prev;
        return { layerId, index };
      });
    }
  }, []);

  useAnimatedReaction(
    () => ({ layerId: hoverLayerId.value, index: hoverPreviewIndex.value }),
    (current, prev) => {
      if (current.layerId !== prev?.layerId || current.index !== prev?.index) {
        runOnJS(updatePreviewState)(current.layerId, current.index);
      }
    },
  );

  // ─── Layer registry ───────────────────────────────────────────────────────────
  const registerLayer = useCallback(
    (id: string, bounds: LayerBounds) => {
      layerBounds.value = { ...layerBounds.value, [id]: bounds };
    },
    [layerBounds],
  );

  const unregisterLayer = useCallback(
    (id: string) => {
      const next = { ...layerBounds.value };
      delete next[id];
      layerBounds.value = next;
    },
    [layerBounds],
  );

  // ─── Object registry ──────────────────────────────────────────────────────────
  const registerObject = useCallback(
    (id: string, layerId: string, bounds: LayerBounds, index: number) => {
      const entry: ObjectBoundsEntry = { ...bounds, layerId, index };
      objectBoundsJSRef.current = { ...objectBoundsJSRef.current, [id]: entry };
      objectBounds.value = { ...objectBounds.value, [id]: entry };
    },
    [objectBounds],
  );

  const unregisterObject = useCallback(
    (id: string) => {
      const nextJS = { ...objectBoundsJSRef.current };
      delete nextJS[id];
      objectBoundsJSRef.current = nextJS;
      const next = { ...objectBounds.value };
      delete next[id];
      objectBounds.value = next;
    },
    [objectBounds],
  );

  const setChildrenForObject = useCallback((id: string, node: React.ReactNode) => {
    childrenRegistryRef.current.set(id, node);
  }, []);

  // ─── newIndex calculation ─────────────────────────────────────────────────────
  const calculateNewIndex = useCallback((targetLayerId: string, dropY: number, excludeId: string) => {
    const entries = Object.entries(objectBoundsJSRef.current)
      .filter(([id, e]) => e.layerId === targetLayerId && id !== excludeId)
      .map(([, e]) => e)
      .sort((a, b) => a.index - b.index);

    for (let i = 0; i < entries.length; i++) {
      if (dropY < entries[i].pageY + entries[i].height / 2) return i;
    }
    return entries.length;
  }, []);

  // ─── endDrag ──────────────────────────────────────────────────────────────────
  const endDrag = useCallback(() => {
    setGhostChildren(null);
    setPreviewState(null);
    setActiveObjectId(null);
    currentDragRef.current = null;
    hoverFiredRef.current = false;
    if (hoverTimerRef.current !== null) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    runOnUI(() => {
      'worklet';
      activeId.value = null;
      hoverLayerId.value = null;
      translationX.value = 0;
      translationY.value = 0;
    })();
  }, [activeId, hoverLayerId, translationX, translationY]);

  // ─── startDrag ────────────────────────────────────────────────────────────────
  const startDrag = useCallback(
    (objectId: string, width: number, height: number) => {
      const entry = objectBoundsJSRef.current[objectId];
      currentDragRef.current = { objectId, sourceLayerId: entry?.layerId ?? '' };
      setActiveObjectId(objectId);
      setGhostChildren(childrenRegistryRef.current.get(objectId) ?? null);
      dragItemWidth.value = width;
      dragItemHeight.value = height;
    },
    [dragItemWidth, dragItemHeight],
  );

  // ─── handleDrop ───────────────────────────────────────────────────────────────
  const handleDrop = useCallback(
    (objectId: string, sourceLayerId: string) => {
      if (hoverTimerRef.current !== null) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      // If the drag was already cleaned up (e.g. hover timer called endDrag),
      // just ensure UI is clean and bail out to avoid a double move.
      if (!currentDragRef.current) {
        endDrag();
        return;
      }
      const targetLayerId = hoverLayerId.value;
      if (!targetLayerId || hoverFiredRef.current) {
        endDrag();
        return;
      }
      const newIndex = calculateNewIndex(targetLayerId, absoluteY.value, objectId);
      onOrderChangeRef.current?.({ sourceLayerId, targetLayerId, objectId, newIndex });
      endDrag();
    },
    [hoverLayerId, absoluteY, calculateNewIndex, endDrag],
  );

  // ─── 500 ms hover transfer ────────────────────────────────────────────────────
  const onHoverLayerChange = useCallback(
    (newLayerId: string | null) => {
      if (hoverTimerRef.current !== null) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      const drag = currentDragRef.current;
      if (!drag || !newLayerId || newLayerId === drag.sourceLayerId || hoverFiredRef.current) return;

      hoverTimerRef.current = setTimeout(() => {
        hoverTimerRef.current = null;
        const currentDrag = currentDragRef.current;
        if (!currentDrag) return;
        hoverFiredRef.current = true;
        const newIndex = calculateNewIndex(newLayerId, absoluteY.value, currentDrag.objectId);
        onOrderChangeRef.current?.({
          sourceLayerId: currentDrag.sourceLayerId,
          targetLayerId: newLayerId,
          objectId: currentDrag.objectId,
          newIndex,
        });
        // Clean up immediately — the DraggableObject is about to unmount
        // (due to the re-render above) and onFinalize may never fire.
        endDrag();
      }, 500);
    },
    [absoluteY, calculateNewIndex],
  );

  useAnimatedReaction(
    () => hoverLayerId.value,
    (current, prev) => {
      if (current !== prev) runOnJS(onHoverLayerChange)(current);
    },
  );

  // ─── Ghost overlay style ──────────────────────────────────────────────────────
  const ghostStyle = useAnimatedStyle(() => ({
    position: 'absolute',
    left: 0,
    top: 0,
    width: dragItemWidth.value,
    height: dragItemHeight.value,
    opacity: activeId.value !== null ? 0.92 : 0,
    transform: [
      { translateX: itemStartPageX.value + translationX.value - canvasPageX.value },
      { translateY: itemStartPageY.value + translationY.value - canvasPageY.value },
      { scale: dragScale.value },
    ],
  }));

  // ─── Context value ────────────────────────────────────────────────────────────
  const contextValue: DragContextValue = useMemo(
    () => ({
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
      previewState,
      activeObjectId,
      registerLayer,
      unregisterLayer,
      registerObject,
      unregisterObject,
      setChildrenForObject,
      startDrag,
      handleDrop,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [previewState, activeObjectId, registerLayer, unregisterLayer, registerObject,
     unregisterObject, setChildrenForObject, startDrag, handleDrop],
  );

  return (
    <DragContext.Provider value={contextValue}>
      <GestureHandlerRootView style={[styles.root, style]}>
        <Animated.View
          ref={canvasRef}
          collapsable={false}
          style={styles.canvas}
          onLayout={measureCanvas}
        >
          {children}

          {/* Ghost overlay: pointerEvents="none" so it never intercepts touches.
              GhostContext.Provider tells nested components they are in the ghost
              so they skip registering their bounds. */}
          <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
            <GhostContext.Provider value={true}>
              <Animated.View style={ghostStyle}>{ghostChildren}</Animated.View>
            </GhostContext.Provider>
          </View>
        </Animated.View>
      </GestureHandlerRootView>
    </DragContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: {},
  canvas: { flex: 1 },
});
