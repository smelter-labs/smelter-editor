import React from "react";
import { View, StyleSheet } from "react-native";
import { Text, useTheme } from "react-native-paper";
import { GestureDetector } from "react-native-gesture-handler";
import type { GridItem as GridItemType } from "../../types/layout";

interface GridItemProps {
  item: GridItemType;
  tapGesture: ReturnType<
    typeof import("react-native-gesture-handler").Gesture.Tap
  >;
}

/**
 * Single draggable/resizable grid cell.
 * The tap gesture is passed in from LayoutScreen via useLayoutGestures.makeItemTapGesture().
 */
export function GridItemCell({ item, tapGesture }: GridItemProps) {
  const theme = useTheme();

  return (
    <GestureDetector gesture={tapGesture}>
      <View
        style={[
          styles.cell,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.outline,
          },
        ]}
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
});
