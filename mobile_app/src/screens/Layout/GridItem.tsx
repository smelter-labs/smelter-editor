import React, { useState } from "react";
import { View, StyleSheet, ViewStyle } from "react-native";
import { Text, useTheme } from "react-native-paper";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import type { GridItem as GridItemType } from "../../types/layout";
import type { ResizeHandleDirection } from "./ReshufflableGridWrapper";

interface GridItemProps {
  item: GridItemType;
  tapGesture: ReturnType<
    typeof import("react-native-gesture-handler").Gesture.Tap
  >;
  isSelected?: boolean;
  onSelect?: () => void;
  onResizeStart?: (direction: ResizeHandleDirection) => void;
  onResizeUpdate?: (
    direction: ResizeHandleDirection,
    translationX: number,
    translationY: number,
  ) => void;
  onResizeEnd?: (direction: ResizeHandleDirection) => void;
}

const HANDLE_SIZE = 16;
const EDGE_HANDLE_WIDTH = 6;

/**
 * Single draggable/resizable grid cell.
 * The tap gesture is passed in from LayoutScreen via useLayoutGestures.makeItemTapGesture().
 * Shows resize handles on corners and edges when selected.
 */
export function GridItemCell({
  item,
  tapGesture,
  isSelected = false,
  onSelect,
  onResizeStart,
  onResizeUpdate,
  onResizeEnd,
}: GridItemProps) {
  const theme = useTheme();
  const [activeDragDirection, setActiveDragDirection] =
    useState<ResizeHandleDirection | null>(null);

  // Create resize gestures for each handle
  const createResizeGesture = (direction: ResizeHandleDirection) => {
    const translationX = useSharedValue(0);
    const translationY = useSharedValue(0);

    return Gesture.Pan()
      .onStart(() => {
        onResizeStart?.(direction);
        setActiveDragDirection(direction);
      })
      .onUpdate((event) => {
        translationX.value = event.translationX;
        translationY.value = event.translationY;
        onResizeUpdate?.(direction, event.translationX, event.translationY);
      })
      .onEnd(() => {
        onResizeEnd?.(direction);
        setActiveDragDirection(null);
        translationX.value = 0;
        translationY.value = 0;
      });
  };

  const cornerHandles: ResizeHandleDirection[] = [
    "topLeft",
    "topRight",
    "bottomLeft",
    "bottomRight",
  ];
  const edgeHandles: ResizeHandleDirection[] = [
    "top",
    "right",
    "bottom",
    "left",
  ];

  const renderHandle = (direction: ResizeHandleDirection) => {
    let positionStyle: ViewStyle = {
      position: "absolute",
    };

    if (direction === "topLeft") {
      positionStyle = {
        ...positionStyle,
        top: -HANDLE_SIZE / 2,
        left: -HANDLE_SIZE / 2,
      };
    } else if (direction === "topRight") {
      positionStyle = {
        ...positionStyle,
        top: -HANDLE_SIZE / 2,
        right: -HANDLE_SIZE / 2,
      };
    } else if (direction === "bottomLeft") {
      positionStyle = {
        ...positionStyle,
        bottom: -HANDLE_SIZE / 2,
        left: -HANDLE_SIZE / 2,
      };
    } else if (direction === "bottomRight") {
      positionStyle = {
        ...positionStyle,
        bottom: -HANDLE_SIZE / 2,
        right: -HANDLE_SIZE / 2,
      };
    } else if (direction === "top") {
      positionStyle = {
        ...positionStyle,
        top: -EDGE_HANDLE_WIDTH / 2,
        left: 0,
        right: 0,
        height: EDGE_HANDLE_WIDTH,
      };
    } else if (direction === "bottom") {
      positionStyle = {
        ...positionStyle,
        bottom: -EDGE_HANDLE_WIDTH / 2,
        left: 0,
        right: 0,
        height: EDGE_HANDLE_WIDTH,
      };
    } else if (direction === "left") {
      positionStyle = {
        ...positionStyle,
        left: -EDGE_HANDLE_WIDTH / 2,
        top: 0,
        bottom: 0,
        width: EDGE_HANDLE_WIDTH,
      };
    } else if (direction === "right") {
      positionStyle = {
        ...positionStyle,
        right: -EDGE_HANDLE_WIDTH / 2,
        top: 0,
        bottom: 0,
        width: EDGE_HANDLE_WIDTH,
      };
    }

    const isCorner = cornerHandles.includes(direction);

    return (
      <GestureDetector key={direction} gesture={createResizeGesture(direction)}>
        <View
          style={[
            styles.handle,
            positionStyle,
            {
              width: isCorner ? HANDLE_SIZE : undefined,
              height: isCorner ? HANDLE_SIZE : undefined,
              backgroundColor:
                activeDragDirection === direction
                  ? "#FF6B6B"
                  : theme.colors.primary,
            },
          ]}
        />
      </GestureDetector>
    );
  };

  return (
    <GestureDetector gesture={tapGesture}>
      <View
        style={[
          styles.cell,
          {
            backgroundColor: theme.colors.surface,
            borderColor: isSelected
              ? theme.colors.primary
              : theme.colors.outline,
            borderWidth: isSelected ? 2 : 1,
          },
        ]}
        onTouchEnd={onSelect}
      >
        <Text variant="bodyMedium" style={{ fontWeight: "600" }}>
          {item.label}
        </Text>
        <Text
          variant="bodySmall"
          style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}
        >
          {item.id}
        </Text>

        {isSelected && (
          <>
            {cornerHandles.map((direction) => renderHandle(direction))}
            {edgeHandles.map((direction) => renderHandle(direction))}
          </>
        )}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  cell: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
  },
  handle: {
    borderRadius: 4,
  },
});
