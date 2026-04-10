import { describe, expect, it } from 'vitest';
import {
  timelineReducer,
  type TimelineState,
  type BlockSettings,
  OUTPUT_TRACK_ID,
  OUTPUT_TRACK_INPUT_ID,
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
              keyframes: [],
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
      keyframeInterpolationMode: 'step',
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
              keyframes: [],
            },
            {
              id: 'clip-b',
              inputId: 'room::local::b',
              startMs: 5_000,
              endMs: 10_000,
              blockSettings: defaultBlockSettings,
              keyframes: [],
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
              keyframes: [],
            },
          ],
        },
      ],
      totalDurationMs: 60_000,
      playheadMs: 0,
      isPlaying: false,
      pixelsPerSecond: 15,
      knownInputIds: new Set<string>(),
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
      knownInputIds: new Set<string>(),
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

  // ── REORDER_TRACK ────────────────────────────────────────

  it('REORDER_TRACK: moves a track to a new index', () => {
    const state: TimelineState = {
      tracks: [
        { id: 'track-a', label: 'A', clips: [] },
        { id: 'track-b', label: 'B', clips: [] },
        { id: 'track-c', label: 'C', clips: [] },
      ],
      totalDurationMs: 60_000,
      playheadMs: 0,
      isPlaying: false,
      pixelsPerSecond: 15,
      keyframeInterpolationMode: 'step',
      knownInputIds: new Set<string>(),
    };

    const next = timelineReducer(state, {
      type: 'REORDER_TRACK',
      trackId: 'track-a',
      newIndex: 2,
    });

    expect(next.tracks.map((t) => t.id)).toEqual([
      'track-b',
      'track-c',
      'track-a',
    ]);
  });

  it('REORDER_TRACK: no-op when moving OUTPUT_TRACK', () => {
    const state: TimelineState = {
      tracks: [
        { id: OUTPUT_TRACK_ID, label: 'Output', clips: [] },
        { id: 'track-a', label: 'A', clips: [] },
      ],
      totalDurationMs: 60_000,
      playheadMs: 0,
      isPlaying: false,
      pixelsPerSecond: 15,
      keyframeInterpolationMode: 'step',
      knownInputIds: new Set<string>(),
    };

    const next = timelineReducer(state, {
      type: 'REORDER_TRACK',
      trackId: OUTPUT_TRACK_ID,
      newIndex: 1,
    });

    expect(next).toBe(state);
  });

  it('REORDER_TRACK: no-op when target index is occupied by OUTPUT_TRACK', () => {
    const state: TimelineState = {
      tracks: [
        { id: OUTPUT_TRACK_ID, label: 'Output', clips: [] },
        { id: 'track-a', label: 'A', clips: [] },
      ],
      totalDurationMs: 60_000,
      playheadMs: 0,
      isPlaying: false,
      pixelsPerSecond: 15,
      keyframeInterpolationMode: 'step',
      knownInputIds: new Set<string>(),
    };

    const next = timelineReducer(state, {
      type: 'REORDER_TRACK',
      trackId: 'track-a',
      newIndex: 0,
    });

    expect(next).toBe(state);
  });

  // ── SWAP_CLIP_INPUT ────────────────────────────────────

  it('SWAP_CLIP_INPUT: swaps inputId and updates knownInputIds', () => {
    const state: TimelineState = {
      tracks: [
        {
          id: 'track-1',
          label: 'Track 1',
          clips: [
            {
              id: 'clip-1',
              inputId: 'room::local::old',
              startMs: 0,
              endMs: 10_000,
              blockSettings: defaultBlockSettings,
              keyframes: [
                {
                  id: 'kf-1',
                  timeMs: 0,
                  blockSettings: defaultBlockSettings,
                },
              ],
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

    const next = timelineReducer(state, {
      type: 'SWAP_CLIP_INPUT',
      trackId: 'track-1',
      clipId: 'clip-1',
      newInputId: 'room::local::new',
    });

    expect(next.tracks[0].clips[0].inputId).toBe('room::local::new');
    expect(next.tracks[0].clips[0].blockSettings.swapLabelSuffix).toBe(
      ' (switched)',
    );
    expect(next.knownInputIds).toContain('room::local::old');
    expect(next.knownInputIds).toContain('room::local::new');
  });

  it('SWAP_CLIP_INPUT: applies sourceUpdates to clip and keyframe blockSettings', () => {
    const baseSettings: BlockSettings = {
      volume: 0.5,
      showTitle: true,
      shaders: [],
    };
    const state: TimelineState = {
      tracks: [
        {
          id: 'track-1',
          label: 'Track 1',
          clips: [
            {
              id: 'clip-1',
              inputId: 'room::local::old',
              startMs: 0,
              endMs: 10_000,
              blockSettings: baseSettings,
              keyframes: [
                {
                  id: 'kf-1',
                  timeMs: 0,
                  blockSettings: baseSettings,
                },
                {
                  id: 'kf-2',
                  timeMs: 5_000,
                  blockSettings: baseSettings,
                },
              ],
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

    const next = timelineReducer(state, {
      type: 'SWAP_CLIP_INPUT',
      trackId: 'track-1',
      clipId: 'clip-1',
      newInputId: 'room::local::new',
      sourceUpdates: {
        mp4DurationMs: 8000,
        sourceWidth: 1920,
        sourceHeight: 1080,
      },
    });

    const clip = next.tracks[0].clips[0];
    expect(clip.inputId).toBe('room::local::new');
    expect(clip.blockSettings.mp4DurationMs).toBe(8000);
    expect(clip.blockSettings.sourceWidth).toBe(1920);
    expect(clip.blockSettings.sourceHeight).toBe(1080);
    expect(clip.blockSettings.swapLabelSuffix).toBe(' (switched)');
    expect(clip.blockSettings.volume).toBe(0.5);

    for (const kf of clip.keyframes) {
      expect(kf.blockSettings.mp4DurationMs).toBe(8000);
      expect(kf.blockSettings.sourceWidth).toBe(1920);
      expect(kf.blockSettings.swapLabelSuffix).toBe(' (switched)');
    }
  });

  it('SWAP_CLIP_INPUT: increments suffix when target input already exists', () => {
    const state: TimelineState = {
      tracks: [
        {
          id: 'track-1',
          label: 'Track 1',
          clips: [
            {
              id: 'clip-a',
              inputId: 'room::local::existing',
              startMs: 0,
              endMs: 10_000,
              blockSettings: defaultBlockSettings,
              keyframes: [
                {
                  id: 'kf-a',
                  timeMs: 0,
                  blockSettings: defaultBlockSettings,
                },
              ],
            },
            {
              id: 'clip-b',
              inputId: 'room::local::old',
              startMs: 10_000,
              endMs: 20_000,
              blockSettings: defaultBlockSettings,
              keyframes: [
                {
                  id: 'kf-b',
                  timeMs: 0,
                  blockSettings: defaultBlockSettings,
                },
              ],
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

    const next = timelineReducer(state, {
      type: 'SWAP_CLIP_INPUT',
      trackId: 'track-1',
      clipId: 'clip-b',
      newInputId: 'room::local::existing',
    });

    expect(next.tracks[0].clips[1].blockSettings.swapLabelSuffix).toBe(
      ' (switched 2)',
    );
    expect(next.tracks[0].clips[1].keyframes[0].blockSettings.swapLabelSuffix).toBe(
      ' (switched 2)',
    );
  });

  // ── CLEANUP_SPURIOUS_WHIP_TRACK ────────────────────────

  it('CLEANUP_SPURIOUS_WHIP_TRACK: removes full-span single-clip track', () => {
    const state: TimelineState = {
      tracks: [
        {
          id: 'spurious-track',
          label: 'WHIP',
          clips: [
            {
              id: 'clip-1',
              inputId: 'room::whip::cam',
              startMs: 0,
              endMs: 60_000,
              blockSettings: defaultBlockSettings,
              keyframes: [],
            },
          ],
        },
        {
          id: OUTPUT_TRACK_ID,
          label: 'Output',
          clips: [],
        },
      ],
      totalDurationMs: 60_000,
      playheadMs: 0,
      isPlaying: false,
      pixelsPerSecond: 15,
      keyframeInterpolationMode: 'step',
      knownInputIds: new Set<string>(),
    };

    const next = timelineReducer(state, {
      type: 'CLEANUP_SPURIOUS_WHIP_TRACK',
      inputId: 'room::whip::cam',
    });

    expect(next.tracks).toHaveLength(1);
    expect(next.tracks[0].id).toBe(OUTPUT_TRACK_ID);
  });

  it('CLEANUP_SPURIOUS_WHIP_TRACK: no-op for multi-clip track', () => {
    const state: TimelineState = {
      tracks: [
        {
          id: 'track-1',
          label: 'Track',
          clips: [
            {
              id: 'clip-1',
              inputId: 'room::whip::cam',
              startMs: 0,
              endMs: 30_000,
              blockSettings: defaultBlockSettings,
              keyframes: [],
            },
            {
              id: 'clip-2',
              inputId: 'room::whip::cam',
              startMs: 30_000,
              endMs: 60_000,
              blockSettings: defaultBlockSettings,
              keyframes: [],
            },
          ],
        },
        {
          id: OUTPUT_TRACK_ID,
          label: 'Output',
          clips: [],
        },
      ],
      totalDurationMs: 60_000,
      playheadMs: 0,
      isPlaying: false,
      pixelsPerSecond: 15,
      keyframeInterpolationMode: 'step',
      knownInputIds: new Set<string>(),
    };

    const next = timelineReducer(state, {
      type: 'CLEANUP_SPURIOUS_WHIP_TRACK',
      inputId: 'room::whip::cam',
    });

    expect(next).toBe(state);
  });

  it('CLEANUP_SPURIOUS_WHIP_TRACK: no-op when inputId does not match', () => {
    const state: TimelineState = {
      tracks: [
        {
          id: 'track-1',
          label: 'Track',
          clips: [
            {
              id: 'clip-1',
              inputId: 'room::whip::other',
              startMs: 0,
              endMs: 60_000,
              blockSettings: defaultBlockSettings,
              keyframes: [],
            },
          ],
        },
        {
          id: OUTPUT_TRACK_ID,
          label: 'Output',
          clips: [],
        },
      ],
      totalDurationMs: 60_000,
      playheadMs: 0,
      isPlaying: false,
      pixelsPerSecond: 15,
      keyframeInterpolationMode: 'step',
      knownInputIds: new Set<string>(),
    };

    const next = timelineReducer(state, {
      type: 'CLEANUP_SPURIOUS_WHIP_TRACK',
      inputId: 'room::whip::cam',
    });

    expect(next).toBe(state);
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
    const nonOutputTracks = next.tracks.filter(
      (track) => track.id !== OUTPUT_TRACK_ID,
    );
    const firstTrack = nonOutputTracks[0];

    expect(new Set(nonOutputTracks.map((track) => track.id)).size).toBe(
      nonOutputTracks.length,
    );
    expect(new Set(firstTrack.clips.map((clip) => clip.id)).size).toBe(
      firstTrack.clips.length,
    );
    expect(
      new Set(firstTrack.clips[0].keyframes.map((keyframe) => keyframe.id))
        .size,
    ).toBe(firstTrack.clips[0].keyframes.length);
  });

  it('renames track to a unique label when the requested one already exists', () => {
    const state: TimelineState = {
      tracks: [
        { id: 'track-1', label: 'Main', clips: [] },
        { id: 'track-2', label: 'Main 2', clips: [] },
      ],
      totalDurationMs: 60_000,
      keyframeInterpolationMode: 'step',
      playheadMs: 0,
      isPlaying: false,
      pixelsPerSecond: 15,
      knownInputIds: new Set<string>(),
    };

    const next = timelineReducer(state, {
      type: 'RENAME_TRACK',
      trackId: 'track-2',
      newLabel: 'Main',
    });

    expect(next.tracks.find((track) => track.id === 'track-2')?.label).toBe(
      'Main (2)',
    );
  });

  it('adds a track with unique label when duplicate is requested', () => {
    const state: TimelineState = {
      tracks: [{ id: 'track-1', label: 'Layer', clips: [] }],
      totalDurationMs: 60_000,
      keyframeInterpolationMode: 'step',
      playheadMs: 0,
      isPlaying: false,
      pixelsPerSecond: 15,
      knownInputIds: new Set<string>(),
    };

    const next = timelineReducer(state, {
      type: 'ADD_TRACK',
      label: 'Layer',
    });

    expect(next.tracks[0]?.label).toBe('Layer (2)');
  });
});
