import { useCallback, useEffect } from "react";
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
 * contentWidth must be the live window width (from useWindowDimensions), so
 * the pager snaps correctly after orientation changes.
 */
export function useScreenSwipe(contentWidth: number) {
  const activeIndex = useSharedValue(0);
  const translateX = useSharedValue(0);
  const gestureStartX = useSharedValue(0);
  const widthSV = useSharedValue(contentWidth);

  // Keep the shared value in sync with React state (orientation changes).
  // Set translateX instantly — no animation — so there's no frame where the
  // pager is translated for the old width while the new width is already applied.
  useEffect(() => {
    widthSV.value = contentWidth;
    translateX.value = -activeIndex.value * contentWidth;
  }, [activeIndex, contentWidth, translateX, widthSV]);

  const snapToIndex = useCallback(
    (index: number) => {
      "worklet";
      const clampedIndex = Math.max(0, Math.min(MAIN_SCREEN_COUNT - 1, index));
      activeIndex.value = clampedIndex;
      translateX.value = withSpring(-clampedIndex * widthSV.value, SPRING_CONFIG);
    },
    [activeIndex, translateX, widthSV],
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
      const minX = -(MAIN_SCREEN_COUNT - 1) * widthSV.value;
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

  const containerStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [{ translateX: translateX.value }],
    };
  });

  return { gesture, translateX, activeIndex, snapToIndex, containerStyle };
}
