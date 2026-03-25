import React from "react";
import { StyleSheet, View } from "react-native";
import { Chip, useTheme } from "react-native-paper";

interface ScreenLabelProps {
  label: string;
}

export function ScreenLabel({ label }: ScreenLabelProps) {
  const theme = useTheme();

  return (
    <View pointerEvents="none" style={styles.wrapper}>
      <Chip
        compact
        style={[styles.chip, { backgroundColor: theme.colors.surface }]}
        textStyle={[styles.text, { color: theme.colors.onSurface }]}
      >
        {label}
      </Chip>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    top: 12,
    left: 12,
    zIndex: 10,
  },
  chip: {
    borderRadius: 9999,
  },
  text: {
    fontSize: 14,
    fontWeight: "600",
  },
});
