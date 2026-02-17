import { useEffect, useRef, useState } from 'react';
import type { InputConfig } from '../store';

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export type SwapTransitionState = {
  /** True while a swap animation is in progress */
  isTransitioning: boolean;
  /** The input that is becoming the new primary (growing) */
  incomingInput: InputConfig | null;
  /** The input that was the old primary (shrinking) */
  outgoingInput: InputConfig | null;
  /** 0→1 eased progress of the transition */
  progress: number;
  /** Index of the incoming input in the previous secondary list (before swap) */
  incomingPrevIndex: number;
  /** Number of secondary inputs before the swap */
  prevSecondaryCount: number;
};

/**
 * Detects when the primary input (inputs[0]) changes and provides
 * animated transition state for swapping between Input and SmallInput.
 *
 * @param inputs - current inputs array from store
 * @param durationMs - transition duration in ms (default 500)
 */
export function usePrimarySwapTransition(
  inputs: InputConfig[],
  durationMs: number = 500
): SwapTransitionState {
  const prevPrimaryRef = useRef<InputConfig | null>(null);
  const prevInputsRef = useRef<InputConfig[]>(inputs);
  const [state, setState] = useState<SwapTransitionState>({
    isTransitioning: false,
    incomingInput: null,
    outgoingInput: null,
    progress: 0,
    incomingPrevIndex: 0,
    prevSecondaryCount: 0,
  });
  const animRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const currentPrimary = inputs[0] ?? null;

  useEffect(() => {
    const prevPrimary = prevPrimaryRef.current;
    const prevInputs = prevInputsRef.current;

    // Update refs for next render
    prevInputsRef.current = inputs;

    // On first render or when there's no previous primary, just record and skip
    if (!prevPrimary || !currentPrimary) {
      prevPrimaryRef.current = currentPrimary;
      return;
    }

    // If primary didn't change, no transition needed
    if (prevPrimary.inputId === currentPrimary.inputId) {
      return;
    }

    // If duration is 0, transition is disabled
    if (durationMs <= 0) {
      prevPrimaryRef.current = currentPrimary;
      return;
    }

    // Check that the old primary is still in the inputs list (it moved to secondary)
    const oldPrimaryStillExists = inputs.some(i => i.inputId === prevPrimary.inputId);
    if (!oldPrimaryStillExists) {
      // Input was removed, not swapped - no transition
      prevPrimaryRef.current = currentPrimary;
      return;
    }

    // Find where the incoming input was in the previous secondary list
    const prevSecondary = prevInputs.filter(i => i.inputId !== prevPrimary.inputId);
    const incomingPrevIndex = prevSecondary.findIndex(i => i.inputId === currentPrimary.inputId);

    // Start swap transition
    const outgoing = prevPrimary;
    const incoming = currentPrimary;
    prevPrimaryRef.current = currentPrimary;

    if (animRef.current) {
      clearInterval(animRef.current);
    }

    const startTime = Date.now();
    const initState: SwapTransitionState = {
      isTransitioning: true,
      incomingInput: incoming,
      outgoingInput: outgoing,
      progress: 0,
      incomingPrevIndex: Math.max(0, incomingPrevIndex),
      prevSecondaryCount: prevSecondary.length,
    };
    setState(initState);

    animRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const rawT = Math.min(1, elapsed / durationMs);
      const easedT = easeInOutCubic(rawT);

      if (rawT >= 1) {
        if (animRef.current) {
          clearInterval(animRef.current);
          animRef.current = null;
        }
        setState({
          isTransitioning: false,
          incomingInput: null,
          outgoingInput: null,
          progress: 1,
          incomingPrevIndex: 0,
          prevSecondaryCount: 0,
        });
      } else {
        setState({
          ...initState,
          progress: easedT,
        });
      }
    }, 16);

    return () => {
      if (animRef.current) {
        clearInterval(animRef.current);
        animRef.current = null;
      }
    };
  }, [currentPrimary?.inputId, durationMs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animRef.current) {
        clearInterval(animRef.current);
        animRef.current = null;
      }
    };
  }, []);

  return state;
}
