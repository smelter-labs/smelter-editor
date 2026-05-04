const PLAYHEAD_BACKWARD_TOLERANCE_MS = 120;
const PLAYHEAD_HARD_RESYNC_MS = 1000;

export function resolveSsePlayheadSync(params: {
  uiPlayheadMs: number;
  ssePlayheadMs: number;
  awaitingStartPlaybackSSE: boolean;
}): {
  nextPlayheadMs: number;
  allowBackward: boolean;
  clearStartResync: boolean;
} {
  const { uiPlayheadMs, ssePlayheadMs, awaitingStartPlaybackSSE } = params;
  if (awaitingStartPlaybackSSE) {
    return {
      nextPlayheadMs: ssePlayheadMs,
      allowBackward: true,
      clearStartResync: true,
    };
  }

  const backwardDeltaMs = uiPlayheadMs - ssePlayheadMs;
  const shouldSnapBackward = backwardDeltaMs > PLAYHEAD_HARD_RESYNC_MS;
  const nextPlayheadMs =
    backwardDeltaMs > PLAYHEAD_BACKWARD_TOLERANCE_MS && !shouldSnapBackward
      ? uiPlayheadMs
      : ssePlayheadMs;

  return {
    nextPlayheadMs,
    allowBackward: shouldSnapBackward,
    clearStartResync: false,
  };
}
