import React, { useEffect } from "react";
import { Pressable, StyleSheet, Dimensions } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { useTheme } from "react-native-paper";

interface SidePanelProps {
  isVisible: boolean;
  side: "left" | "right";
  width?: number;
  onClose?: () => void;
  children?: React.ReactNode;
}

const SPRING_CONFIG = { damping: 22, stiffness: 200, mass: 0.9 };

/**
 * Reusable animated side panel that slides in from left or right.
 * Renders as a position:absolute overlay — does not push screen content.
 *
 * Always anchored at left: 0 with width = panelWidth.
 * translateX drives both the hidden/visible state AND which side the panel sits on:
 *   left panel:  visible = 0,               hidden = -width
 *   right panel: visible = screenWidth-width, hidden = screenWidth
 *
 * This avoids the layout-anchor flip (left↔right) that caused a visible
 * cross-screen slide when the selected card changed sides.
 */
export function SidePanel({
  isVisible,
  side,
  width = 320,
  onClose,
  children,
}: SidePanelProps) {
  const theme = useTheme();
  const { width: screenWidth, height } = Dimensions.get("window");

  // Positions expressed as translateX from left: 0 anchor
  const visibleTranslateX = side === "right" ? screenWidth - width : 0;
  const hiddenTranslateX = side === "right" ? screenWidth : -width;

  const translateX = useSharedValue(hiddenTranslateX);

  useEffect(() => {
    if (isVisible) {
      // Snap off-screen to the new side first (no layout change, purely translateX),
      // then spring into view. This ensures a side switch never animates across screen.
      translateX.value = hiddenTranslateX;
      translateX.value = withSpring(visibleTranslateX, SPRING_CONFIG);
    } else {
      translateX.value = withSpring(hiddenTranslateX, SPRING_CONFIG);
    }
  }, [isVisible, hiddenTranslateX, visibleTranslateX]);

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <>
      {/* Backdrop — dismiss on tap */}
      {isVisible && <Pressable style={styles.backdrop} onPress={onClose} />}
      <Animated.View
        style={[
          {
            position: "absolute",
            top: 0,
            left: 0,
            width,
            height,
            backgroundColor: theme.colors.surface,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.4,
            shadowRadius: 8,
            elevation: 16,
            zIndex: 100,
          },
          panelStyle,
        ]}
      >
        {children}
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
    zIndex: 99,
    elevation: 15,
  },
});
