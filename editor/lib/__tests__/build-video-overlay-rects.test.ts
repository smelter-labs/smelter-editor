import { describe, expect, it } from 'vitest';
import { buildVideoOverlayRects } from '../build-video-overlay-rects';
import {
  INPUT_LEVEL_CLIP_ID,
  INPUT_LEVEL_TRACK_ID,
} from '@/components/control-panel/components/block-clip/block-clip-utils';
import type { SelectedTimelineClip } from '@/components/control-panel/components/BlockClipPropertiesPanel';
import type { Layer } from '@/lib/types';

const layers: Layer[] = [
  {
    id: 'layer-1',
    inputs: [
      {
        inputId: 'input-a',
        x: 100,
        y: 200,
        width: 640,
        height: 360,
      },
    ],
  },
];

const colorMap = new Map([['input-a', { dot: '#ff0000' }]]);

const timelineClip: SelectedTimelineClip = {
  trackId: 'track-1',
  clipId: 'clip-1',
  inputId: 'input-a',
  startMs: 1000,
  endMs: 5000,
  blockSettings: { volume: 1, showTitle: true, shaders: [] },
  keyframes: [],
};

const inputLevelClip: SelectedTimelineClip = {
  trackId: INPUT_LEVEL_TRACK_ID,
  clipId: INPUT_LEVEL_CLIP_ID,
  inputId: 'input-a',
  startMs: 0,
  endMs: 0,
  blockSettings: { volume: 1, showTitle: true, shaders: [] },
  keyframes: [],
};

describe('buildVideoOverlayRects', () => {
  it('returns empty array when overlay is disabled', () => {
    expect(
      buildVideoOverlayRects({
        enabled: false,
        clips: [timelineClip],
        playheadMs: 2000,
        layers,
        colorMap,
      }),
    ).toEqual([]);
  });

  it('returns empty array when no clips are selected', () => {
    expect(
      buildVideoOverlayRects({
        enabled: true,
        clips: [],
        playheadMs: 2000,
        layers,
        colorMap,
      }),
    ).toEqual([]);
  });

  it('returns rect for timeline clip when playhead is within range', () => {
    expect(
      buildVideoOverlayRects({
        enabled: true,
        clips: [timelineClip],
        playheadMs: 2000,
        layers,
        colorMap,
      }),
    ).toEqual([
      {
        x: 100,
        y: 200,
        width: 640,
        height: 360,
        color: '#ff0000',
      },
    ]);
  });

  it('returns no rect for timeline clip when playhead is outside range', () => {
    expect(
      buildVideoOverlayRects({
        enabled: true,
        clips: [timelineClip],
        playheadMs: 500,
        layers,
        colorMap,
      }),
    ).toEqual([]);
  });

  it('returns rect for input-level clip regardless of playhead', () => {
    expect(
      buildVideoOverlayRects({
        enabled: true,
        clips: [inputLevelClip],
        playheadMs: 99999,
        layers,
        colorMap,
      }),
    ).toEqual([
      {
        x: 100,
        y: 200,
        width: 640,
        height: 360,
        color: '#ff0000',
      },
    ]);
  });

  it('uses timelineColor from block settings when present', () => {
    const clipWithColor: SelectedTimelineClip = {
      ...timelineClip,
      blockSettings: {
        ...timelineClip.blockSettings,
        timelineColor: '#00ff00',
      },
    };

    expect(
      buildVideoOverlayRects({
        enabled: true,
        clips: [clipWithColor],
        playheadMs: 2000,
        layers,
        colorMap,
      }),
    ).toEqual([
      {
        x: 100,
        y: 200,
        width: 640,
        height: 360,
        color: '#00ff00',
      },
    ]);
  });
});
