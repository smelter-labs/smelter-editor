import { describe, expect, it } from 'vitest';
import { resolveSsePlayheadSync } from '../timeline-playhead-sync';

describe('resolveSsePlayheadSync', () => {
  it('hard-resyncs to first playing SSE after play start', () => {
    const result = resolveSsePlayheadSync({
      uiPlayheadMs: 46_000,
      ssePlayheadMs: 0,
      awaitingStartPlaybackSSE: true,
    });

    expect(result).toEqual({
      nextPlayheadMs: 0,
      allowBackward: true,
      clearStartResync: true,
    });
  });

  it('keeps local monotonic playhead for small backward SSE drift', () => {
    const result = resolveSsePlayheadSync({
      uiPlayheadMs: 10_000,
      ssePlayheadMs: 9_500,
      awaitingStartPlaybackSSE: false,
    });

    expect(result).toEqual({
      nextPlayheadMs: 10_000,
      allowBackward: false,
      clearStartResync: false,
    });
  });

  it('allows backward snap when drift exceeds hard resync threshold', () => {
    const result = resolveSsePlayheadSync({
      uiPlayheadMs: 12_000,
      ssePlayheadMs: 10_500,
      awaitingStartPlaybackSSE: false,
    });

    expect(result).toEqual({
      nextPlayheadMs: 10_500,
      allowBackward: true,
      clearStartResync: false,
    });
  });
});
