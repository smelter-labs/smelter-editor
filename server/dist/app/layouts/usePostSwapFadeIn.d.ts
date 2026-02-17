/**
 * Animates opacity for secondary content during swap transitions.
 *
 * - Default (no transition yet): opacity = 1
 * - When transition starts: animates 1→0 over `fadeOutDurationMs`
 * - When transition ends: animates 0→1 over `fadeInDurationMs`
 * - If both durations are <= 0, opacity is always 1.
 */
export declare function usePostSwapFadeIn(isTransitioning: boolean, fadeInDurationMs: number, fadeOutDurationMs?: number): number;
