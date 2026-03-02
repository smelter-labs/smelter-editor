import { describe, expect, it } from 'vitest';
import {
  timelineReducer,
  type TimelineState,
  type BlockSettings,
} from '../use-timeline-state';

const defaultBlockSettings: BlockSettings = {
  volume: 1,
  showTitle: true,
  shaders: [],
  orientation: 'horizontal',
};

describe('timelineReducer', () => {
  it('clears all tracks when SYNC_TRACKS receives empty inputs', () => {
    const state: TimelineState = {
      tracks: [
        {
          id: 'track-1',
          label: 'Track 1',
          clips: [
            {
              id: 'clip-1',
              inputId: 'room::local::one',
              startMs: 0,
              endMs: 10_000,
              blockSettings: defaultBlockSettings,
            },
          ],
        },
      ],
      totalDurationMs: 60_000,
      playheadMs: 0,
      isPlaying: false,
      pixelsPerSecond: 15,
    };

    const next = timelineReducer(state, { type: 'SYNC_TRACKS', inputs: [] });

    expect(next.tracks).toEqual([]);
  });

  it('purges an input from all tracks and removes empty ones', () => {
    const state: TimelineState = {
      tracks: [
        {
          id: 'track-1',
          label: 'Track 1',
          clips: [
            {
              id: 'clip-a',
              inputId: 'room::local::a',
              startMs: 0,
              endMs: 5_000,
              blockSettings: defaultBlockSettings,
            },
            {
              id: 'clip-b',
              inputId: 'room::local::b',
              startMs: 5_000,
              endMs: 10_000,
              blockSettings: defaultBlockSettings,
            },
          ],
        },
        {
          id: 'track-2',
          label: 'Track 2',
          clips: [
            {
              id: 'clip-c',
              inputId: 'room::local::a',
              startMs: 0,
              endMs: 8_000,
              blockSettings: defaultBlockSettings,
            },
          ],
        },
      ],
      totalDurationMs: 60_000,
      playheadMs: 0,
      isPlaying: false,
      pixelsPerSecond: 15,
    };

    const next = timelineReducer(state, {
      type: 'PURGE_INPUT_ID',
      inputId: 'room::local::a',
    });

    expect(next.tracks).toHaveLength(1);
    expect(next.tracks[0].id).toBe('track-1');
    expect(next.tracks[0].clips).toHaveLength(1);
    expect(next.tracks[0].clips[0].inputId).toBe('room::local::b');
  });
});
