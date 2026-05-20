// @vitest-environment jsdom
import { renderHook, act, waitFor } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { useTimelineServerSync } from '../use-timeline-server-sync';

const makeInput = (id: string): any => ({
  inputId: id,
  absoluteTop: 10,
  absoluteLeft: 20,
  absoluteWidth: 100,
  absoluteHeight: 200,
  absoluteTransitionDurationMs: 0,
  absoluteTransitionEasing: 'linear',
  cropTop: 0,
  cropLeft: 0,
  cropRight: 0,
  cropBottom: 0,
});

const makeTrackWithClip = (
  trackId: string,
  clipId: string,
  inputId: string,
): any => ({
  id: trackId,
  clips: [
    {
      id: clipId,
      inputId,
      startMs: 0,
      endMs: 1000,
      blockSettings: {},
      keyframes: [],
    },
  ],
});

describe('useTimelineServerSync seenClipIds pruning', () => {
  it('calls updateClipSettings again after a clip is removed then re-added', async () => {
    const updateClipSettings = vi.fn();

    const initialProps = {
      inputs: [],
      layers: [],
      state: { tracks: [] },
      updateClipSettings,
    } as Parameters<typeof useTimelineServerSync>[0];

    const { rerender } = renderHook((props) => useTimelineServerSync(props), {
      initialProps,
    });

    // Add an input and a track with a clip -> should call updateClipSettings once
    const propsWithClip: Parameters<typeof useTimelineServerSync>[0] = {
      inputs: [makeInput('i1')],
      layers: [],
      state: { tracks: [makeTrackWithClip('t1', 'c1', 'i1')] },
      updateClipSettings,
    };

    await act(async () => {
      rerender(propsWithClip);
    });

    await waitFor(() => expect(updateClipSettings).toHaveBeenCalled());
    const initialCalls = updateClipSettings.mock.calls.length;
    expect(initialCalls).toBeGreaterThanOrEqual(1);

    // Remove the clip (simulate user/deletion)
    const propsNoClip: Parameters<typeof useTimelineServerSync>[0] = {
      ...propsWithClip,
      state: { tracks: [] },
    };
    await act(async () => {
      rerender(propsNoClip);
    });

    // Re-add the same clip; pruning should have removed the seen id so the hook
    // will call updateClipSettings again for the clip.
    await act(async () => {
      rerender(propsWithClip);
    });

    await waitFor(() =>
      expect(updateClipSettings).toHaveBeenCalledTimes(initialCalls + 1),
    );
  });
});
