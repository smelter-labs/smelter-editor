import React, { useCallback, useEffect } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  measure,
  runOnJS,
  runOnUI,
  useAnimatedRef,
  useAnimatedStyle,
} from 'react-native-reanimated';

import { useDragContext, useIsInGhost } from './DragContext';

interface DroppableLayerProps {
  layerId: string;
  children: React.ReactNode;
  style?: ViewStyle;
}

/** Thin blue line indicating where the dragged item would land. */
function InsertionLine() {
  return (
    <Animated.View
      entering={FadeIn.duration(80)}
      exiting={FadeOut.duration(80)}
      style={styles.insertionLine}
    />
  );
}

/**
 * Wraps a single DraggableObject child. Collapses its height to zero
 * (via SharedValue) when it is the actively dragged item, so sibling
 * items slide into the vacated space via their own LinearTransition.
 */
function ActiveItemHider({
  objectId,
  children,
}: {
  objectId: string;
  children: React.ReactNode;
}) {
  const { activeId } = useDragContext();

  const style = useAnimatedStyle(() => {
    if (activeId.value === objectId) {
      return { maxHeight: 0, overflow: 'hidden' as const, opacity: 0 };
    }
    return { maxHeight: 200, overflow: 'visible' as const, opacity: 1 };
  });

  return <Animated.View style={style}>{children}</Animated.View>;
}

export function DroppableLayer({ layerId, children, style }: DroppableLayerProps) {
  const { registerLayer, unregisterLayer, hoverLayerId, previewState, activeObjectId } =
    useDragContext();
  const isInGhost = useIsInGhost();
  const layerRef = useAnimatedRef<Animated.View>();

  const measureAndRegister = useCallback(() => {
    if (isInGhost) return;
    runOnUI(() => {
      'worklet';
      const m = measure(layerRef);
      if (m) {
        runOnJS(registerLayer)(layerId, {
          pageX: m.pageX,
          pageY: m.pageY,
          width: m.width,
          height: m.height,
        });
      }
    })();
  }, [isInGhost, layerId, layerRef, registerLayer]);

  useEffect(() => {
    if (isInGhost) return;
    return () => unregisterLayer(layerId);
  }, [isInGhost, layerId, unregisterLayer]);

  const borderStyle = useAnimatedStyle(() => ({
    borderWidth: 1,
    borderColor: hoverLayerId.value === layerId ? '#4D9DE0' : 'transparent',
  }));

  // Insertion index among non-active items in this layer (-1 = no preview)
  const insertionIndex =
    previewState?.layerId === layerId ? previewState.index : -1;

  // Render children with:
  //  • ActiveItemHider wrapping each DraggableObject (collapse when active)
  //  • InsertionLine injected at the correct filtered position
  const childrenArray = React.Children.toArray(children);
  let filteredCount = 0;

  const renderedChildren = childrenArray.map((child, rawIdx) => {
    const el = child as React.ReactElement<{ objectId?: string }>;
    const childObjectId: string | undefined = el.props?.objectId;
    const isDraggable = !!childObjectId;

    if (!isDraggable) {
      // Layer header or other non-draggable children pass through unchanged
      return <React.Fragment key={`nondrag-${rawIdx}`}>{child}</React.Fragment>;
    }

    const isActiveItem = childObjectId === activeObjectId;
    const currentFilteredIdx = isActiveItem ? -1 : filteredCount;
    if (!isActiveItem) filteredCount++;

    return (
      <React.Fragment key={childObjectId}>
        {/* Show insertion line before this item if it's the insertion point */}
        {!isActiveItem && currentFilteredIdx === insertionIndex && (
          <InsertionLine key={`line-${insertionIndex}`} />
        )}
        <ActiveItemHider objectId={childObjectId}>{child}</ActiveItemHider>
      </React.Fragment>
    );
  });

  // Insertion line at the end (after all non-active items)
  const trailingLine = filteredCount === insertionIndex && insertionIndex >= 0 && (
    <InsertionLine key="line-end" />
  );

  return (
    <Animated.View
      ref={layerRef}
      collapsable={false}
      style={[style, borderStyle]}
      layout={LinearTransition.duration(200)}
      onLayout={measureAndRegister}
    >
      {renderedChildren}
      {trailingLine}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  insertionLine: {
    height: 2,
    backgroundColor: '#4D9DE0',
    borderRadius: 1,
    marginVertical: 1,
  },
});
