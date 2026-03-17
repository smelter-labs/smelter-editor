import React from "react";
import { StyleSheet, View } from "react-native";
import { Surface, Text, useTheme } from "react-native-paper";

interface ScreenLabelProps {
  label: string;
}

export function ScreenLabel({ label }: ScreenLabelProps) {
  const theme = useTheme();

  return (
    <View pointerEvents="none" style={styles.wrapper}>
      <Surface
        style={[styles.chip, { backgroundColor: theme.colors.surface }]}
        elevation={2}
      >
        <Text variant="labelLarge" style={{ color: theme.colors.onSurface }}>
          {label}
        </Text>
      </Surface>
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
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
});
