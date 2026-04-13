import React, { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import { getAudioLevelColor } from "../../utils/gridUtils";

interface AudioLevelMeterProps {
  level: number; // 0.0 – 1.0
  height?: number;
  width?: number;
}

const ANIMATION_DURATION = 80;

/**
 * DAW-style audio level meter — vertical green/yellow/red stripe.
 * Animates smoothly to reflect live audioLevel from the server.
 */
export function AudioLevelMeter({
  level,
  height = 60,
  width = 12,
}: AudioLevelMeterProps) {
  const fillHeight = useSharedValue(0);

  useEffect(() => {
    fillHeight.value = withTiming(Math.max(0, Math.min(1, level)), {
      duration: ANIMATION_DURATION,
    });
  }, [level]);

  const fillStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      height: `${fillHeight.value * 100}%`,
      backgroundColor: getAudioLevelColor(fillHeight.value),
    };
  });

  return (
    <View style={[styles.container, { height, width }]}>
      <Animated.View style={[styles.fill, fillStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#1e293b",
    borderRadius: 3,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  fill: {
    width: "100%",
    borderRadius: 2,
  },
});
