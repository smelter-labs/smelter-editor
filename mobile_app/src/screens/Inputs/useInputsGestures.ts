import { useCallback } from "react";
import { Gesture } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";

interface UseInputsGesturesOptions {
  onCardTap: (cardId: string) => void;
}

/**
 * Gesture handlers for the Inputs screen.
 * - 1-finger tap on card: opens detail panel
 * - 1-finger long-press + drag: handled by react-native-draggable-flatlist natively
 */
export function useInputsGestures({ onCardTap }: UseInputsGesturesOptions) {
  const handleCardTap = useCallback((id: string) => onCardTap(id), [onCardTap]);

  const makeCardTapGesture = (cardId: string) =>
    Gesture.Tap()
      .maxDuration(400)
      .onEnd(() => {
        "worklet";
        runOnJS(handleCardTap)(cardId);
      });

  return { makeCardTapGesture };
}
