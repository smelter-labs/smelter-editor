import React from "react";
import { View } from "react-native";
import { useScreenDimensions } from "../../hooks/useScreenDimensions";

interface ScreenTransitionViewProps {
  children: React.ReactNode;
  width?: number;
}

/**
 * Full-viewport frame for each screen in MainNavigator.
 * Uses useWindowDimensions so it re-sizes correctly after orientation changes.
 */
export function ScreenTransitionView({
  children,
  width,
}: ScreenTransitionViewProps) {
  const { width: winWidth, height } = useScreenDimensions();

  return (
    <View
      style={{ width: width ?? winWidth, height, flex: 1, overflow: "hidden" }}
    >
      {children}
    </View>
  );
}
