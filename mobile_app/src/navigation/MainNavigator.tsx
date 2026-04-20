import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { GestureDetector } from "react-native-gesture-handler";
import { runOnJS, useAnimatedReaction } from "react-native-reanimated";
import * as ScreenOrientation from "expo-screen-orientation";
import { useScreenSwipe } from "./useScreenSwipe";
import { ScreenTransitionView } from "../components/shared/ScreenTransitionView";
import { LayoutScreen } from "../screens/Layout/LayoutScreen";
import { InputsScreen } from "../screens/Inputs/InputsScreen";
import { TimelineScreen } from "../screens/Timeline/TimelineScreen";
import { DebugScreen } from "../screens/Debug/DebugScreen";
import { MAIN_SCREEN_COUNT } from "./navigationTypes";
import { useSettingsStore } from "../store";
import { useScreenDimensions } from "../hooks/useScreenDimensions";

const ARROW_WIDTH_RATIO = 0.05;

/**
 * MainNavigator — custom horizontal pager for all main screens.
 *
 * All screens are mounted simultaneously (no lazy unmounting) to preserve
 * WebSocket subscriptions across navigation. Navigation is either via
 * 3-finger swipe or edge arrow buttons depending on the arrowNavigation setting.
 *
 * Always locks to landscape. useWindowDimensions drives all sizing so the
 * layout reflows correctly if the OS takes a moment to report the new size.
 */
export function MainNavigator() {
  const { width: rawWidth, height: rawHeight } = useScreenDimensions();
  // Always treat the larger dimension as width since we lock to landscape.
  // This avoids a layout flash when the OS hasn't reported the rotated
  // dimensions yet but we've already rendered the horizontal layout.
  const winWidth = Math.max(rawWidth, rawHeight);
  const winHeight = Math.min(rawWidth, rawHeight);
  const arrowNavigation = useSettingsStore((s) => s.arrowNavigation);
  useEffect(() => {
    ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.LANDSCAPE,
    ).catch((err) =>
      console.warn("[MainNavigator] orientation lock failed", err),
    );
  }, []);

  const arrowWidth = Math.round(winWidth * ARROW_WIDTH_RATIO);
  const contentWidth = arrowNavigation ? winWidth - arrowWidth * 2 : winWidth;

  const { gesture, containerStyle, snapToIndex, activeIndex } =
    useScreenSwipe(contentWidth);

  const [currentIndex, setCurrentIndex] = useState(0);

  useAnimatedReaction(
    () => activeIndex.value,
    (val) => runOnJS(setCurrentIndex)(val),
  );

  const goBack = useCallback(() => {
    snapToIndex(currentIndex - 1);
  }, [snapToIndex, currentIndex]);

  const goForward = useCallback(() => {
    snapToIndex(currentIndex + 1);
  }, [snapToIndex, currentIndex]);

  const screens = (
    <>
      <ScreenTransitionView width={contentWidth}>
        <LayoutScreen />
      </ScreenTransitionView>
      <ScreenTransitionView width={contentWidth}>
        <InputsScreen />
      </ScreenTransitionView>
      <ScreenTransitionView width={contentWidth}>
        <TimelineScreen />
      </ScreenTransitionView>
      <ScreenTransitionView width={contentWidth}>
        <DebugScreen />
      </ScreenTransitionView>
    </>
  );

  if (arrowNavigation) {
    return (
      <View
        style={{
          flex: 1,
          flexDirection: "row",
          width: winWidth,
          height: winHeight,
          backgroundColor: "#0f0f1a",
        }}
      >
        <Pressable
          style={[
            styles.arrowButton,
            { width: arrowWidth, height: winHeight },
            currentIndex === 0 && styles.arrowDisabled,
          ]}
          onPress={goBack}
          disabled={currentIndex === 0}
        >
          <Text style={styles.arrowText}>‹</Text>
        </Pressable>

        <View
          style={{ width: contentWidth, height: winHeight, overflow: "hidden" }}
        >
          <Animated.View
            style={[
              {
                flexDirection: "row",
                width: contentWidth * MAIN_SCREEN_COUNT,
                height: winHeight,
              },
              containerStyle,
            ]}
          >
            {screens}
          </Animated.View>
        </View>

        <Pressable
          style={[
            styles.arrowButton,
            { width: arrowWidth, height: winHeight },
            currentIndex === MAIN_SCREEN_COUNT - 1 && styles.arrowDisabled,
          ]}
          onPress={goForward}
          disabled={currentIndex === MAIN_SCREEN_COUNT - 1}
        >
          <Text style={styles.arrowText}>›</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[
          {
            flexDirection: "row",
            width: winWidth * MAIN_SCREEN_COUNT,
            height: winHeight,
          },
          containerStyle,
        ]}
      >
        {screens}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  arrowButton: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  arrowDisabled: {
    opacity: 0.2,
  },
  arrowText: {
    color: "#ffffff",
    fontSize: 32,
    fontWeight: "300",
    lineHeight: 38,
  },
});
