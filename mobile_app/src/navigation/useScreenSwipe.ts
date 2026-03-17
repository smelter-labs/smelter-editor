import { useCallback } from "react";
import { Dimensions } from "react-native";
import {
  Gesture,
  GestureUpdateEvent,
  PanGestureHandlerEventPayload,
} from "react-native-gesture-handler";
import {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { MAIN_SCREEN_COUNT } from "./navigationTypes";

const SPRING_CONFIG = {
  damping: 20,
  stiffness: 180,
  mass: 0.8,
};

const SWIPE_VELOCITY_THRESHOLD = 400;
const SWIPE_DISTANCE_THRESHOLD = 60;

/**
 * Hook that encapsulates the 3-finger horizontal pan gesture for navigating
 * between the main screens. Uses minPointers(3)/maxPointers(3) so it never
 * conflicts with 1-finger or 2-finger gestures.
 *
 * Returns:
 *  - gesture: the composed PanGesture to be placed on a GestureDetector
 *  - translateX: SharedValue driving the container's horizontal transform
 *  - activeIndex: SharedValue with current screen index
 *  - containerStyle: AnimatedStyle to apply to the main screens container
 */
export function useScreenSwipe() {
  const screenWidth = Dimensions.get("window").width;
  const activeIndex = useSharedValue(0);
  const translateX = useSharedValue(0);
  const gestureStartX = useSharedValue(0);

  const snapToIndex = useCallback(
    (index: number) => {
      "worklet";
      const clampedIndex = Math.max(0, Math.min(MAIN_SCREEN_COUNT - 1, index));
      activeIndex.value = clampedIndex;
      translateX.value = withSpring(-clampedIndex * screenWidth, SPRING_CONFIG);
    },
    [activeIndex, translateX, screenWidth],
  );

  const gesture = Gesture.Pan()
    .minPointers(3)
    .maxPointers(3)
    .activeOffsetX([-20, 20])
    .onBegin(() => {
      "worklet";
      gestureStartX.value = translateX.value;
    })
    .onUpdate((event: GestureUpdateEvent<PanGestureHandlerEventPayload>) => {
      "worklet";
      const newX = gestureStartX.value + event.translationX;
      // Rubber-band resistance at edges
      const minX = -(MAIN_SCREEN_COUNT - 1) * screenWidth;
      const clampedX = Math.max(minX, Math.min(0, newX));
      translateX.value = clampedX;
    })
    .onEnd((event: GestureUpdateEvent<PanGestureHandlerEventPayload>) => {
      "worklet";
      const velocityX = event.velocityX;
      const currentIndex = activeIndex.value;

      let targetIndex = currentIndex;

      if (
        velocityX < -SWIPE_VELOCITY_THRESHOLD ||
        event.translationX < -SWIPE_DISTANCE_THRESHOLD
      ) {
        targetIndex = currentIndex + 1;
      } else if (
        velocityX > SWIPE_VELOCITY_THRESHOLD ||
        event.translationX > SWIPE_DISTANCE_THRESHOLD
      ) {
        targetIndex = currentIndex - 1;
      }

      snapToIndex(targetIndex);
    });

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return { gesture, translateX, activeIndex, containerStyle };
}
