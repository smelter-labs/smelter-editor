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
  // Track whether we need to start an interval (set during render, consumed by effect)
  const needsAnimStartRef = useRef(false);

  // ── Synchronous detection during render ──
  // Detect primary change immediately so the outgoing overlay is present
  // on the very first frame — avoids a one-frame "blink".
  if (
    prevPrimaryRef.current &&
    currentPrimary &&
    prevPrimaryRef.current.inputId !== currentPrimary.inputId &&
    !state.isTransitioning &&
    durationMs > 0 &&
    inputs.some(i => i.inputId === prevPrimaryRef.current!.inputId)
  ) {
    const prevSecondary = prevInputsRef.current.filter(
      i => i.inputId !== prevPrimaryRef.current!.inputId
    );
    const idx = prevSecondary.findIndex(i => i.inputId === currentPrimary.inputId);

    // setState during render: React discards current output and re-renders
    // immediately before painting, so the outgoing overlay is never missing.
    setState({
      isTransitioning: true,
      incomingInput: currentPrimary,
      outgoingInput: prevPrimaryRef.current,
      progress: 0,
      incomingPrevIndex: Math.max(0, idx),
      prevSecondaryCount: prevSecondary.length,
    });

    prevPrimaryRef.current = currentPrimary;
    prevInputsRef.current = inputs;
    needsAnimStartRef.current = true;
  }

  // ── Effect: start / manage the animation interval ──
  useEffect(() => {
    // First render or no previous primary — just record
    if (!prevPrimaryRef.current) {
      prevPrimaryRef.current = currentPrimary;
      prevInputsRef.current = inputs;
      return;
    }

    // Refs already updated during render if a swap was detected.
    // If not a swap render, keep refs in sync.
    if (!needsAnimStartRef.current) {
      prevInputsRef.current = inputs;
      if (currentPrimary) {
        prevPrimaryRef.current = currentPrimary;
      }
      return;
    }

    // A swap was detected during render — start the animation interval.
    needsAnimStartRef.current = false;

    if (animRef.current) {
      clearInterval(animRef.current);
    }

    const startTime = Date.now();
    const initState = state; // already set synchronously above

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
