import type { InputConfig } from '../store';
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
export declare function usePrimarySwapTransition(inputs: InputConfig[], durationMs?: number): SwapTransitionState;
