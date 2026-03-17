import React from "react";
import { View, StyleSheet } from "react-native";
import { Text, useTheme } from "react-native-paper";
import { appColors } from "../../theme/paperTheme";

interface VideoFeedThumbProps {
  streamUrl: string | null;
}

/**
 * Placeholder container for the input video feed.
 */
export function VideoFeedThumb({ streamUrl }: VideoFeedThumbProps) {
  const theme = useTheme();

  if (!streamUrl) {
    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: theme.colors.surfaceVariant,
            borderColor: "#1e293b",
          },
        ]}
      >
        <Text variant="bodySmall" style={{ color: appColors.dim }}>
          No video
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: theme.colors.surfaceVariant,
          borderColor: theme.colors.outline,
        },
      ]}
    >
      <Text
        variant="bodySmall"
        style={{ color: theme.colors.onSurfaceVariant }}
      >
        Video stream
      </Text>
      <Text
        variant="bodySmall"
        style={{ color: appColors.dim, maxWidth: "90%" }}
        numberOfLines={1}
      >
        {streamUrl}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 80,
    borderRadius: 8,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
});
