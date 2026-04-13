import React from "react";
import { StyleSheet, Text, Pressable, View } from "react-native";

import { GestureDetector, Gesture } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import type { GridItemControls } from "./ReshufflableGridWrapper";
import { ResizeHandleDirection } from "./ReshufflableGridWrapper";
import type { LayerItemProps } from "./types";

type GridCellProps = LayerItemProps & GridItemControls;

const HANDLE_TOUCH_SIZE = 28; // larger touch target for reliable activation
const HANDLE_VISUAL_SIZE = 12; // visible dot size

export default function GridCell({
  name,
  color,
  isVisible,
  nativeWidth,
  nativeHeight,
  isSelected = false,
  onSelect,
  onLongPress,
  resizePreview,
  onResizeStart,
  onResizeUpdate,
  onResizeEnd,
}: GridCellProps) {
  const previewScaleX = useSharedValue(1);
  const previewScaleY = useSharedValue(1);
  const previewTranslateX = useSharedValue(0);
  const previewTranslateY = useSharedValue(0);

  const previewAnimatedStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [
        { translateX: previewTranslateX.value },
        { translateY: previewTranslateY.value },
        { scaleX: previewScaleX.value },
        { scaleY: previewScaleY.value },
      ],
    };
  });

  const rightDirections: ResizeHandleDirection[] = [
    ResizeHandleDirection.RIGHT,
    ResizeHandleDirection.TOP_RIGHT,
    ResizeHandleDirection.BOTTOM_RIGHT,
  ];
  const leftDirections: ResizeHandleDirection[] = [
    ResizeHandleDirection.LEFT,
    ResizeHandleDirection.TOP_LEFT,
    ResizeHandleDirection.BOTTOM_LEFT,
  ];
  const topDirections: ResizeHandleDirection[] = [
    ResizeHandleDirection.TOP,
    ResizeHandleDirection.TOP_LEFT,
    ResizeHandleDirection.TOP_RIGHT,
  ];
  const bottomDirections: ResizeHandleDirection[] = [
    ResizeHandleDirection.BOTTOM,
    ResizeHandleDirection.BOTTOM_LEFT,
    ResizeHandleDirection.BOTTOM_RIGHT,
  ];

  const createResizeGesture = (direction: ResizeHandleDirection) => {
    return Gesture.Pan()
      .maxPointers(1)
      .minDistance(1) // activate on the very first pixel so the grid's long-press can't win
      .onStart(() => {
        "worklet";
        if (onResizeStart) {
          runOnJS(onResizeStart)(direction);
        }
      })
      .onUpdate((event) => {
        "worklet";
        if (resizePreview) {
          const cellPixelWidth = Math.max(1, resizePreview.cellPixelWidth);
          const cellPixelHeight = Math.max(1, resizePreview.cellPixelHeight);
          const widthCells = Math.max(1, resizePreview.widthCells);
          const heightCells = Math.max(1, resizePreview.heightCells);

          const colDeltaFloat = event.translationX / cellPixelWidth;
          const rowDeltaFloat = event.translationY / cellPixelHeight;
          const colDeltaSnap = Math.round(colDeltaFloat);
          const rowDeltaSnap = Math.round(rowDeltaFloat);
          const colResidual = colDeltaFloat - colDeltaSnap;
          const rowResidual = rowDeltaFloat - rowDeltaSnap;

          const affectsHorizontal =
            rightDirections.includes(direction) ||
            leftDirections.includes(direction);
          const affectsVertical =
            topDirections.includes(direction) ||
            bottomDirections.includes(direction);

          let widthResidual = 0;
          if (rightDirections.includes(direction)) {
            widthResidual = colResidual;
          } else if (leftDirections.includes(direction)) {
            widthResidual = -colResidual;
          }

          let heightResidual = 0;
          if (bottomDirections.includes(direction)) {
            heightResidual = rowResidual;
          } else if (topDirections.includes(direction)) {
            heightResidual = -rowResidual;
          }

          const nextScaleX = affectsHorizontal
            ? Math.max(0.9, (widthCells + widthResidual) / widthCells)
            : 1;
          const nextScaleY = affectsVertical
            ? Math.max(0.9, (heightCells + heightResidual) / heightCells)
            : 1;

          previewScaleX.value = withTiming(nextScaleX, { duration: 32 });
          previewScaleY.value = withTiming(nextScaleY, { duration: 32 });
          previewTranslateX.value = withTiming(
            affectsHorizontal ? (colResidual * cellPixelWidth) / 2 : 0,
            { duration: 32 },
          );
          previewTranslateY.value = withTiming(
            affectsVertical ? (rowResidual * cellPixelHeight) / 2 : 0,
            { duration: 32 },
          );
        }

        if (onResizeUpdate) {
          runOnJS(onResizeUpdate)(
            direction,
            event.translationX,
            event.translationY,
          );
        }
      })
      .onEnd(() => {
        "worklet";
        previewScaleX.value = withTiming(1, { duration: 80 });
        previewScaleY.value = withTiming(1, { duration: 80 });
        previewTranslateX.value = withTiming(0, { duration: 80 });
        previewTranslateY.value = withTiming(0, { duration: 80 });

        if (onResizeEnd) {
          runOnJS(onResizeEnd)(direction);
        }
      });
  };

  const renderHandle = (direction: ResizeHandleDirection) => {
    // The outer View is the (larger) touch target; the inner dot is the visual indicator.
    let positionStyle: any = { position: "absolute" };

    if (direction === "topLeft") {
      positionStyle = {
        ...positionStyle,
        top: -HANDLE_TOUCH_SIZE / 2,
        left: -HANDLE_TOUCH_SIZE / 2,
      };
    } else if (direction === "topRight") {
      positionStyle = {
        ...positionStyle,
        top: -HANDLE_TOUCH_SIZE / 2,
        right: -HANDLE_TOUCH_SIZE / 2,
      };
    } else if (direction === "bottomLeft") {
      positionStyle = {
        ...positionStyle,
        bottom: -HANDLE_TOUCH_SIZE / 2,
        left: -HANDLE_TOUCH_SIZE / 2,
      };
    } else if (direction === "bottomRight") {
      positionStyle = {
        ...positionStyle,
        bottom: -HANDLE_TOUCH_SIZE / 2,
        right: -HANDLE_TOUCH_SIZE / 2,
      };
    }

    return (
      <GestureDetector key={direction} gesture={createResizeGesture(direction)}>
        {/* Larger transparent touch target around the smaller visual dot */}
        <View style={[positionStyle, styles.handleTouchTarget]}>
          <View
            style={[
              styles.handleDot,
              { backgroundColor: isSelected ? "#4CAF50" : "#999" },
            ]}
          />
        </View>
      </GestureDetector>
    );
  };

  return (
    <Pressable
      onPress={onSelect}
      onLongPress={onLongPress}
      style={styles.pressable}
    >
      <Animated.View
        style={[
          styles.cell,
          previewAnimatedStyle,
          {
            backgroundColor: color,
            opacity: isVisible ? 1 : 0.5,
            borderWidth: isSelected ? 2 : 1,
            borderColor: isSelected ? "#4CAF50" : "transparent",
          },
        ]}
      >
        <Text style={styles.cellText} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.resolutionText}>
          {nativeWidth != null && nativeHeight != null
            ? `${nativeWidth}×${nativeHeight}`
            : ""}
        </Text>
        {isSelected && (
          <>
            {["topLeft", "topRight", "bottomLeft", "bottomRight"].map((dir) =>
              renderHandle(dir as ResizeHandleDirection),
            )}
          </>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    flex: 1,
  },
  cell: {
    flex: 1,
    position: "relative",
    borderRadius: 4,
    justifyContent: "center",
    alignItems: "center",
  },
  cellText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  resolutionText: {
    position: "absolute",
    bottom: 4,
    right: 6,
    color: "rgba(255,255,255,0.75)",
    fontSize: 12,
    fontWeight: "500",
  },
  handleTouchTarget: {
    width: HANDLE_TOUCH_SIZE,
    height: HANDLE_TOUCH_SIZE,
    justifyContent: "center",
    alignItems: "center",
  },
  handleDot: {
    width: HANDLE_VISUAL_SIZE,
    height: HANDLE_VISUAL_SIZE,
    borderRadius: 6,
  },
});
