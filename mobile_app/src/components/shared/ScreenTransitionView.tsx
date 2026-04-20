import React from "react";
import { Dimensions, View } from "react-native";

interface ScreenTransitionViewProps {
  children: React.ReactNode;
}

/**
 * Full-viewport frame for each screen in MainNavigator.
 * Ensures screens are correctly sized and don't bleed into each other during swipe.
 */
export function ScreenTransitionView({ children }: ScreenTransitionViewProps) {
  const { width, height } = Dimensions.get("screen");

  return (
    <View style={{ width, height, flex: 1, overflow: "hidden" }}>
      {children}
    </View>
  );
}
