import { useCallback } from "react";
import { Gesture } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";

interface UseLayoutGesturesOptions {
  onItemTap: (itemId: string) => void;
  onEdgeSwipe: (side: "left" | "right") => void;
}

/**
 * Composes gesture handlers for the Layout screen:
 *  - 1-finger tap: opens item side panel
 *  - 2-finger edge swipe: opens settings panel
 *
 * Finger-count constraints (min/maxPointers) prevent conflicts with the
 * root 3-finger navigation gesture in MainNavigator.
 */
export function useLayoutGestures({
  onItemTap,
  onEdgeSwipe,
}: UseLayoutGesturesOptions) {
  const handleItemTap = useCallback((id: string) => onItemTap(id), [onItemTap]);
  const handleEdgeSwipe = useCallback(
    (side: "left" | "right") => onEdgeSwipe(side),
    [onEdgeSwipe],
  );

  const edgeSwipeGesture = Gesture.Pan()
    .minPointers(2)
    .maxPointers(2)
    .activeOffsetX([-20, 20])
    .onEnd((event) => {
      "worklet";
      const side = event.translationX > 0 ? "left" : "right";
      runOnJS(handleEdgeSwipe)(side);
    });

  const makeItemTapGesture = (itemId: string) =>
    Gesture.Tap()
      .maxDuration(500)
      .onEnd(() => {
        "worklet";
        runOnJS(handleItemTap)(itemId);
      });

  return { edgeSwipeGesture, makeItemTapGesture };
}
