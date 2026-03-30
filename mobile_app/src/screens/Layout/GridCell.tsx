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

const HANDLE_SIZE = 12;

export default function GridCell({
  name,
  color,
  isVisible,
  isSelected = false,
  onSelect,
  onLongPress,
  onResizeStart,
  onResizeUpdate,
  onResizeEnd,
}: GridCellProps) {
  const createResizeGesture = (direction: ResizeHandleDirection) => {
    return Gesture.Pan()
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
    let positionStyle: any = { position: "absolute" };

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
    }

    return (
      <GestureDetector key={direction} gesture={createResizeGesture(direction)}>
        <View
          style={[
            styles.handle,
            positionStyle,
            {
              width: HANDLE_SIZE,
              height: HANDLE_SIZE,
              backgroundColor: isSelected ? "#4CAF50" : "#999",
            },
          ]}
        />
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
    fontSize: 11,
    fontWeight: "600",
  },
  handle: {
    borderRadius: 6,
  },
});
