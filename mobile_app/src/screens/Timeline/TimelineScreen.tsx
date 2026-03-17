import React from "react";
import { View, StyleSheet } from "react-native";
import { Text, useTheme } from "react-native-paper";
import { ScreenLabel } from "../../components/shared/ScreenLabel";

/**
 * Timeline screen — placeholder only.
 * Will display input on/off timeline, shader schedule, and future actions.
 */
export function TimelineScreen() {
  const theme = useTheme();

  return (
    <View
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <ScreenLabel label="Timeline" />
      <Text
        variant="headlineMedium"
        style={{ color: theme.colors.onBackground }}
      >
        Timeline
      </Text>
      <Text
        variant="bodyMedium"
        style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}
      >
        Timeline tracking for inputs, shaders, and scheduled actions.
        {"\n"}Coming soon.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  subtitle: {
    textAlign: "center",
    maxWidth: 360,
    lineHeight: 22,
  },
});
