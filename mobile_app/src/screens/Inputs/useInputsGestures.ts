import { useCallback } from "react";
import { Gesture } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";

interface UseInputsGesturesOptions {
  onCardTap: (cardId: string) => void;
  onEdgeSwipe: (side: "left" | "right") => void;
  isEdgeSwipeEnabled?: boolean;
}

/**
 * Gesture handlers for the Inputs screen.
 * - 2-finger edge swipe: opens settings panel
 * - 1-finger tap on card: opens detail panel (on opposite side)
 * - 1-finger long-press + drag: handled by react-native-draggable-flatlist natively
 */
export function useInputsGestures({
  onCardTap,
  onEdgeSwipe,
  isEdgeSwipeEnabled = true,
}: UseInputsGesturesOptions) {
  const handleCardTap = useCallback((id: string) => onCardTap(id), [onCardTap]);
  const handleEdgeSwipe = useCallback(
    (side: "left" | "right") => onEdgeSwipe(side),
    [onEdgeSwipe],
  );

  const edgeSwipeGesture = Gesture.Pan()
    .enabled(isEdgeSwipeEnabled)
    .minPointers(2)
    .maxPointers(2)
    .activeOffsetX([-20, 20])
    .onEnd((event) => {
      "worklet";
      const side = event.translationX > 0 ? "left" : "right";
      runOnJS(handleEdgeSwipe)(side);
    });

  const makeCardTapGesture = (cardId: string) =>
    Gesture.Tap()
      .maxDuration(400)
      .onEnd(() => {
        "worklet";
        runOnJS(handleCardTap)(cardId);
      });

  return { edgeSwipeGesture, makeCardTapGesture };
}
