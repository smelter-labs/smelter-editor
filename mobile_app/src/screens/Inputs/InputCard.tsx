import React from "react";
import { View, StyleSheet } from "react-native";
import { Chip, Text, useTheme } from "react-native-paper";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import type { InputCard as InputCardType } from "../../types/input";
import { getMovementColor } from "../../utils/gridUtils";
import { appColors } from "../../theme/paperTheme";
import { AudioLevelMeter } from "./AudioLevelMeter";
import { VideoFeedThumb } from "./VideoFeedThumb";
import { InputCardControls } from "./InputCardControls";

interface InputCardProps {
  input: InputCardType;
  tapGesture: ReturnType<typeof Gesture.Tap>;
  onUpdate: (changes: Partial<InputCardType>) => void;
}

/**
 * Full input card for the Inputs screen.
 */
export function InputCard({ input, tapGesture, onUpdate }: InputCardProps) {
  const theme = useTheme();
  const movementColor = getMovementColor(input.movementPercent);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.outline,
        },
      ]}
    >
      {/* Header row + video feed are tappable to open the detail panel */}
      <GestureDetector gesture={tapGesture}>
        <View>
          <View style={styles.header}>
            <Text variant="bodyMedium" style={styles.name} numberOfLines={1}>
              {input.name}
            </Text>
            <Text
              variant="bodySmall"
              style={[styles.movement, { color: movementColor }]}
            >
              {input.movementPercent}%
            </Text>
          </View>

          {/* Video feed */}
          <VideoFeedThumb streamUrl={input.videoStreamUrl} />
        </View>
      </GestureDetector>

      {/* Controls — outside tap gesture so they don't open the side panel */}
      <InputCardControls input={input} onUpdate={onUpdate} />

      {/* Volume + level meter row */}
      <View style={styles.volumeRow}>
        <Text
          variant="bodySmall"
          style={{ color: appColors.muted, minWidth: 56 }}
        >
          Vol: {Math.round(input.inputVolume * 100)}%
        </Text>
        <View
          style={[styles.volumeTrack, { backgroundColor: appColors.surface2 }]}
        >
          <View
            style={[
              styles.volumeFill,
              {
                backgroundColor: theme.colors.primary,
                width: `${input.inputVolume * 100}%`,
              },
            ]}
          />
        </View>
        <AudioLevelMeter level={input.audioLevel} />
      </View>

      {input.isAudioOnly && (
        <Chip
          compact
          style={[styles.audioChip, { backgroundColor: appColors.blue }]}
          textStyle={styles.audioChipText}
        >
          AUDIO ONLY
        </Chip>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 8,
    flex: 1,
    margin: 6,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  name: {
    fontWeight: "600",
    flex: 1,
  },
  movement: {
    fontWeight: "700",
    marginLeft: 8,
  },
  volumeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  volumeTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  volumeFill: {
    height: "100%",
    borderRadius: 3,
  },
  audioChip: {
    alignSelf: "flex-start",
    borderRadius: 4,
  },
  audioChipText: {
    color: "#bfdbfe",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
  },
});
