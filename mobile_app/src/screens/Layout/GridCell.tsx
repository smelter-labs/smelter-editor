import React from "react";
import { StyleSheet, Text, Pressable, View } from "react-native";

import { GestureDetector, Gesture } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import type {
  GridItemControls,
  ResizeHandleDirection,
} from "./ReshufflableGridWrapper";
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
  onResizeStart,
  onResizeUpdate,
  onResizeEnd,
}: GridCellProps) {
  const createResizeGesture = (direction: ResizeHandleDirection) => {
    return Gesture.Pan()
      .minDistance(1) // activate on the very first pixel so the grid's long-press can't win
      .onStart(() => {
        "worklet";
        if (onResizeStart) {
          runOnJS(onResizeStart)(direction);
        }
      })
      .onUpdate((event) => {
        "worklet";
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
      <View
        style={[
          styles.cell,
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
      </View>
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
