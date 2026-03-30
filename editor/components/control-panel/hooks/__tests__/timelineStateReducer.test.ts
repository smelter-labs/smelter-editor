import { describe, expect, it } from 'vitest';
import {
  timelineReducer,
  type TimelineState,
  type BlockSettings,
  OUTPUT_TRACK_ID,
} from '../use-timeline-state';

const defaultBlockSettings: BlockSettings = {
  volume: 1,
  showTitle: true,
  shaders: [],
};

describe('timelineReducer', () => {
  it('preserves existing clips when SYNC_TRACKS receives a transient empty input list', () => {
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
      keyframeInterpolationMode: 'step',
      knownInputIds: new Set<string>(),
    };

    const next = timelineReducer(state, { type: 'SYNC_TRACKS', inputs: [] });

    expect(next).toBe(state);
  });

  it('clears tracks when SYNC_TRACKS receives empty inputs and there are no clips yet', () => {
    const state: TimelineState = {
      tracks: [],
      totalDurationMs: 60_000,
      playheadMs: 0,
      isPlaying: false,
      pixelsPerSecond: 15,
      keyframeInterpolationMode: 'step',
      knownInputIds: new Set<string>(),
    };

    const next = timelineReducer(state, { type: 'SYNC_TRACKS', inputs: [] });

    expect(next.tracks).toHaveLength(1);
    expect(next.tracks[0].id).toBe(OUTPUT_TRACK_ID);
  });

  it('preserves known input ids on LOAD', () => {
    const loaded: TimelineState = {
      tracks: [],
      totalDurationMs: 60_000,
      playheadMs: 0,
      isPlaying: false,
      pixelsPerSecond: 15,
      keyframeInterpolationMode: 'step',
      knownInputIds: new Set(['room::local::one', 'room::local::two']),
    };

    const next = timelineReducer(loaded, { type: 'LOAD', state: loaded });

    expect([...next.knownInputIds].sort()).toEqual([
      'room::local::one',
      'room::local::two',
    ]);
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

  it('keeps the base keyframe locked at 0ms and clamps moved keyframes into clip bounds', () => {
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
              keyframes: [
                {
                  id: 'kf-base',
                  timeMs: 0,
                  blockSettings: defaultBlockSettings,
                },
                {
                  id: 'kf-move',
                  timeMs: 2_000,
                  blockSettings: defaultBlockSettings,
                },
              ],
            },
          ],
        },
      ],
      totalDurationMs: 60_000,
      keyframeInterpolationMode: 'step',
      playheadMs: 0,
      isPlaying: false,
      pixelsPerSecond: 15,
    };

    const movedBase = timelineReducer(state, {
      type: 'MOVE_KEYFRAME',
      trackId: 'track-1',
      clipId: 'clip-1',
      keyframeId: 'kf-base',
      timeMs: 1_000,
    });

    expect(movedBase.tracks[0].clips[0].keyframes[0].timeMs).toBe(0);

    const movedIntoStart = timelineReducer(state, {
      type: 'MOVE_KEYFRAME',
      trackId: 'track-1',
      clipId: 'clip-1',
      keyframeId: 'kf-move',
      timeMs: 0,
    });

    expect(
      movedIntoStart.tracks[0].clips[0].keyframes.find(
        (keyframe) => keyframe.id === 'kf-move',
      )?.timeMs,
    ).toBe(1);

    const movedPastEnd = timelineReducer(state, {
      type: 'MOVE_KEYFRAME',
      trackId: 'track-1',
      clipId: 'clip-1',
      keyframeId: 'kf-move',
      timeMs: 25_000,
    });

    expect(
      movedPastEnd.tracks[0].clips[0].keyframes.find(
        (keyframe) => keyframe.id === 'kf-move',
      )?.timeMs,
    ).toBe(10_000);
  });

  it('reassigns duplicate track, clip, and keyframe ids on load', () => {
    const loaded: TimelineState = {
      tracks: [
        {
          id: 'duplicate-track',
          label: 'Track 1',
          clips: [
            {
              id: 'duplicate-clip',
              inputId: 'room::local::one',
              startMs: 0,
              endMs: 10_000,
              blockSettings: defaultBlockSettings,
              keyframes: [
                {
                  id: 'duplicate-kf',
                  timeMs: 0,
                  blockSettings: defaultBlockSettings,
                },
                {
                  id: 'duplicate-kf',
                  timeMs: 2_000,
                  blockSettings: defaultBlockSettings,
                },
              ],
            },
            {
              id: 'duplicate-clip',
              inputId: 'room::local::one',
              startMs: 10_000,
              endMs: 20_000,
              blockSettings: defaultBlockSettings,
              keyframes: [
                {
                  id: 'kf-2',
                  timeMs: 0,
                  blockSettings: defaultBlockSettings,
                },
              ],
            },
          ],
        },
        {
          id: 'duplicate-track',
          label: 'Track 2',
          clips: [
            {
              id: 'clip-3',
              inputId: 'room::local::two',
              startMs: 0,
              endMs: 10_000,
              blockSettings: defaultBlockSettings,
              keyframes: [
                {
                  id: 'kf-3',
                  timeMs: 0,
                  blockSettings: defaultBlockSettings,
                },
              ],
            },
          ],
        },
      ],
      totalDurationMs: 60_000,
      keyframeInterpolationMode: 'step',
      playheadMs: 0,
      isPlaying: false,
      pixelsPerSecond: 15,
      knownInputIds: new Set<string>(),
    };

    const next = timelineReducer(loaded, { type: 'LOAD', state: loaded });
    const nonOutputTracks = next.tracks.filter((track) => track.id !== OUTPUT_TRACK_ID);
    const firstTrack = nonOutputTracks[0];

    expect(new Set(nonOutputTracks.map((track) => track.id)).size).toBe(
      nonOutputTracks.length,
    );
    expect(new Set(firstTrack.clips.map((clip) => clip.id)).size).toBe(
      firstTrack.clips.length,
    );
    expect(
      new Set(firstTrack.clips[0].keyframes.map((keyframe) => keyframe.id)).size,
    ).toBe(firstTrack.clips[0].keyframes.length);
  });
});
