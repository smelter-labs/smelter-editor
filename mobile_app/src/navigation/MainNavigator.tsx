import React from "react";
import { Dimensions } from "react-native";
import Animated from "react-native-reanimated";
import { GestureDetector } from "react-native-gesture-handler";
import { useScreenSwipe } from "./useScreenSwipe";
import { ScreenTransitionView } from "../components/shared/ScreenTransitionView";
import { LayoutScreen } from "../screens/Layout/LayoutScreen";
import { InputsScreen } from "../screens/Inputs/InputsScreen";
import { TimelineScreen } from "../screens/Timeline/TimelineScreen";
import { DebugScreen } from "../screens/Debug/DebugScreen";
import { MAIN_SCREEN_COUNT } from "./navigationTypes";

/**
 * MainNavigator — custom horizontal pager for all main screens.
 *
 * All screens are mounted simultaneously (no lazy unmounting) to preserve
 * WebSocket subscriptions across navigation. The 3-finger PanGesture drives
 * a shared translateX value that slides the container horizontally.
 */
export function MainNavigator() {
  const { width: screenWidth, height: screenHeight } = Dimensions.get("screen");
  const { gesture, containerStyle } = useScreenSwipe();

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[
          {
            flexDirection: "row",
            width: screenWidth * MAIN_SCREEN_COUNT,
            height: screenHeight,
            flex: 1,
          },
          containerStyle,
        ]}
      >
        <ScreenTransitionView>
          <LayoutScreen />
        </ScreenTransitionView>
        <ScreenTransitionView>
          <InputsScreen />
        </ScreenTransitionView>
        <ScreenTransitionView>
          <TimelineScreen />
        </ScreenTransitionView>
        <ScreenTransitionView>
          <DebugScreen />
        </ScreenTransitionView>
      </Animated.View>
    </GestureDetector>
  );
}
