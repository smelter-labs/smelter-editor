/**
 * Animates opacity from 0 to 1 after a swap transition completes.
 *
 * - While `isTransitioning` is true, fadeOpacity is 0.
 * - When `isTransitioning` transitions from true to false, fadeOpacity
 *   animates from 0 to 1 over `durationMs` milliseconds.
 * - When no transition has occurred yet, fadeOpacity is 1 (default).
 * - If `durationMs <= 0`, fadeOpacity is always 1.
 *
 * @param isTransitioning - whether a swap transition is currently in progress
 * @param durationMs - fade-in duration in ms (e.g. 500)
 */
export declare function usePostSwapFadeIn(isTransitioning: boolean, durationMs: number): number;
