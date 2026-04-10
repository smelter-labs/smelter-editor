import { beforeEach, describe, it, expect } from 'vitest';
import {
  buildTimelineStateFromConfigTimeline,
  exportRoomConfig,
  loadTimelineFromStorage,
  parseRoomConfig,
  resolveRoomConfigTimelineState,
  restoreTimelineToStorage,
  saveOutputPlayerSettings,
  loadOutputPlayerSettings,
  type RoomConfigTransitionSettings,
  type RoomConfigTimeline,
  type RoomConfigTimelineState,
  type RoomConfigOutputPlayer,
} from '../room-config';
import type { Input, Layout } from '@/lib/types';

function createLocalStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: createLocalStorageMock(),
    configurable: true,
  });
  localStorage.clear();
});

const minimalInput: Input = {
  id: 0,
  inputId: 'room::text::1',
  title: 'Text',
  description: '',
  volume: 1,
  showTitle: false,
  type: 'text-input',
  sourceState: 'always-live',
  status: 'connected',
  shaders: [],
};

describe('parseRoomConfig', () => {
  it('parses valid config v1', () => {
    const json = JSON.stringify({
      version: 1,
      layout: 'picture-in-picture',
      inputs: [
        {
          type: 'text-input',
          title: 'Text',
          description: '',
          volume: 1,
          shaders: [],
        },
      ],
      exportedAt: new Date().toISOString(),
    });
    const config = parseRoomConfig(json);
    expect(config.version).toBe(1);
    expect(config.layout).toBe('picture-in-picture');
    expect(config.inputs).toHaveLength(1);
    expect(config.inputs[0].type).toBe('text-input');
  });

  it('throws on unsupported version', () => {
    const json = JSON.stringify({
      version: 2,
      layout: 'grid',
      inputs: [],
      exportedAt: new Date().toISOString(),
    });
    expect(() => parseRoomConfig(json)).toThrow('Unsupported config version');
  });

  it('throws on invalid format (missing layout)', () => {
    const json = JSON.stringify({
      version: 1,
      inputs: [],
      exportedAt: new Date().toISOString(),
    });
    expect(() => parseRoomConfig(json)).toThrow('Invalid config format');
  });

  it('throws on invalid format (inputs not array)', () => {
    const json = JSON.stringify({
      version: 1,
      layout: 'grid',
      inputs: null,
      exportedAt: new Date().toISOString(),
    });
    expect(() => parseRoomConfig(json)).toThrow('Invalid config format');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseRoomConfig('not json')).toThrow();
  });

  it('deduplicates imported input titles and track labels', () => {
    const json = JSON.stringify({
      version: 1,
      layout: 'grid',
      inputs: [
        {
          type: 'text-input',
          title: 'Host',
          description: '',
          volume: 1,
          shaders: [],
        },
        {
          type: 'text-input',
          title: 'Host',
          description: '',
          volume: 1,
          shaders: [],
        },
      ],
      timeline: {
        totalDurationMs: 10_000,
        pixelsPerSecond: 15,
        tracks: [
          { label: 'Layer', clips: [] },
          { label: 'Layer', clips: [] },
        ],
      },
      exportedAt: new Date().toISOString(),
    });

    const config = parseRoomConfig(json);
    expect(config.inputs.map((input) => input.title)).toEqual([
      'Host',
      'Host (2)',
    ]);
    expect(config.timeline?.tracks.map((track) => track.label)).toEqual([
      'Layer',
      'Layer (2)',
    ]);
  });
});

describe('exportRoomConfig', () => {
  it('exports config with inputs and layout', () => {
    const inputs: Input[] = [minimalInput];
    const layout: Layout = 'grid';
    const config = exportRoomConfig(inputs, layout);
    expect(config.version).toBe(1);
    expect(config.layout).toBe('grid');
    expect(config.inputs).toHaveLength(1);
    expect(config.inputs[0].type).toBe('text-input');
    expect(config.inputs[0].title).toBe('Text');
    expect(config.exportedAt).toBeDefined();
  });

  it('includes resolution and transitionSettings when provided', () => {
    const resolution = { width: 1920, height: 1080 };
    const transitionSettings: RoomConfigTransitionSettings = {
      swapDurationMs: 500,
      swapOutgoingEnabled: true,
    };
    const config = exportRoomConfig(
      [minimalInput],
      'picture-in-picture',
      resolution,
      transitionSettings,
    );
    expect(config.resolution).toEqual(resolution);
    expect(config.transitionSettings).toEqual(transitionSettings);
  });

  it('includes outputPlayer when provided', () => {
    const outputPlayer: RoomConfigOutputPlayer = { muted: false, volume: 0.75 };
    const config = exportRoomConfig(
      [minimalInput],
      'grid',
      undefined,
      undefined,
      undefined,
      outputPlayer,
    );
    expect(config.outputPlayer).toEqual({ muted: false, volume: 0.75 });
  });

  it('omits outputPlayer when not provided', () => {
    const config = exportRoomConfig([minimalInput], 'grid');
    expect(config.outputPlayer).toBeUndefined();
  });

  it('preserves explicit local-mp4 file names', () => {
    const mp4Input: Input = {
      ...minimalInput,
      id: 1,
      inputId: 'room::local::2',
      type: 'local-mp4',
      title: '[MP4] My Video',
      description: '',
      mp4FileName: 'folder/my-video.mp4',
    };
    const config = exportRoomConfig([mp4Input], 'grid');
    expect(config.inputs[0].mp4FileName).toBe('folder/my-video.mp4');
  });

  it('preserves nested local media paths already present on the input', () => {
    const mp4Input: Input = {
      ...minimalInput,
      id: 1,
      inputId: 'room::local::2',
      type: 'local-mp4',
      title: '[MP4] Demo',
      description: '',
      mp4FileName: 'nested/folder/demo.mp4',
    };
    const audioInput: Input = {
      ...minimalInput,
      id: 2,
      inputId: 'room::local::3',
      type: 'local-mp4',
      title: '[AUDIO] Demo',
      description: '',
      audioFileName: 'nested/folder/demo.mp4',
    };

    const config = exportRoomConfig([mp4Input, audioInput], 'grid');

    expect(config.inputs[0].mp4FileName).toBe('nested/folder/demo.mp4');
    expect(config.inputs[1].audioFileName).toBe('nested/folder/demo.mp4');
  });

  it('includes url for hls inputs', () => {
    const hlsInput: Input = {
      ...minimalInput,
      id: 2,
      inputId: 'room::hls::3',
      type: 'hls',
      title: 'Example HLS',
      description: '',
      url: 'https://example.com/live.m3u8',
    };

    const config = exportRoomConfig([hlsInput], 'grid');

    expect(config.inputs[0].url).toBe('https://example.com/live.m3u8');
  });

  it('includes imageFileName for image inputs', () => {
    const imageInput: Input = {
      ...minimalInput,
      id: 3,
      inputId: 'room::image::4',
      type: 'image',
      title: 'Overlay',
      description: '',
      imageId: 'pictures::overlay',
      imageFileName: 'overlays/branding/overlay.png',
    };

    const config = exportRoomConfig([imageInput], 'grid');
    expect(config.inputs[0].imageFileName).toBe(
      'overlays/branding/overlay.png',
    );
  });

  it('includes timeline keyframes from the provided live state', () => {
    const timelineState: RoomConfigTimelineState = {
      tracks: [
        {
          id: 'track-1',
          label: 'Track 1',
          clips: [
            {
              id: 'clip-1',
              inputId: minimalInput.inputId,
              startMs: 0,
              endMs: 10_000,
              blockSettings: {
                volume: 1,
                showTitle: true,
                shaders: [],

                text: 'initial',
              },
              keyframes: [
                {
                  id: 'kf-0',
                  timeMs: 0,
                  blockSettings: {
                    volume: 1,
                    showTitle: true,
                    shaders: [],

                    text: 'initial',
                  },
                },
                {
                  id: 'kf-1',
                  timeMs: 2500,
                  blockSettings: {
                    volume: 0.5,
                    showTitle: false,
                    shaders: [],

                    text: 'updated',
                  },
                },
              ],
            },
          ],
        },
      ],
      totalDurationMs: 10_000,
      keyframeInterpolationMode: 'smooth',
      pixelsPerSecond: 15,
    };

    const config = exportRoomConfig(
      [minimalInput],
      'grid',
      undefined,
      undefined,
      timelineState,
    );

    expect(config.timeline).toEqual({
      totalDurationMs: 10_000,
      keyframeInterpolationMode: 'smooth',
      pixelsPerSecond: 15,
      tracks: [
        {
          label: 'Track 1',
          clips: [
            {
              inputIndex: 0,
              startMs: 0,
              endMs: 10_000,
              blockSettings: {
                volume: 1,
                showTitle: true,
                shaders: [],

                text: 'initial',
              },
              keyframes: [
                {
                  id: 'kf-0',
                  timeMs: 0,
                  blockSettings: {
                    volume: 1,
                    showTitle: true,
                    shaders: [],

                    text: 'initial',
                  },
                },
                {
                  id: 'kf-1',
                  timeMs: 2500,
                  blockSettings: {
                    volume: 0.5,
                    showTitle: false,
                    shaders: [],

                    text: 'updated',
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  });
});

describe('timeline config persistence helpers', () => {
  it('builds timeline state from config without storage', () => {
    const timeline: RoomConfigTimeline = {
      totalDurationMs: 12_000,
      pixelsPerSecond: 24,
      keyframeInterpolationMode: 'smooth',
      tracks: [
        {
          label: 'Track 1',
          clips: [
            {
              inputIndex: 0,
              startMs: 1000,
              endMs: 8000,
              blockSettings: {
                volume: 1,
                showTitle: true,
                shaders: [],
                text: 'intro',
              },
              keyframes: [
                {
                  id: 'kf-a',
                  timeMs: 0,
                  blockSettings: {
                    volume: 1,
                    showTitle: true,
                    shaders: [],
                    text: 'intro',
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    expect(
      buildTimelineStateFromConfigTimeline(
        timeline,
        new Map<number, string>([[0, 'room::text::1']]),
      ),
    ).toEqual({
      totalDurationMs: 12_000,
      keyframeInterpolationMode: 'smooth',
      pixelsPerSecond: 24,
      tracks: [
        {
          id: expect.any(String),
          label: 'Track 1',
          clips: [
            {
              id: expect.any(String),
              inputId: 'room::text::1',
              startMs: 1000,
              endMs: 8000,
              blockSettings: {
                volume: 1,
                showTitle: true,
                shaders: [],
                text: 'intro',
              },
              keyframes: [
                {
                  id: 'kf-a',
                  timeMs: 0,
                  blockSettings: {
                    volume: 1,
                    showTitle: true,
                    shaders: [],
                    text: 'intro',
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('restores keyframes to local timeline storage without losing them', () => {
    const timeline: RoomConfigTimeline = {
      totalDurationMs: 12_000,
      pixelsPerSecond: 24,
      keyframeInterpolationMode: 'smooth',
      tracks: [
        {
          label: 'Track 1',
          clips: [
            {
              inputIndex: 0,
              startMs: 1000,
              endMs: 8000,
              blockSettings: {
                volume: 1,
                showTitle: true,
                shaders: [],

                text: 'intro',
              },
              keyframes: [
                {
                  id: 'kf-a',
                  timeMs: 0,
                  blockSettings: {
                    volume: 1,
                    showTitle: true,
                    shaders: [],

                    text: 'intro',
                  },
                },
                {
                  id: 'kf-b',
                  timeMs: 3000,
                  blockSettings: {
                    volume: 0.2,
                    showTitle: false,
                    shaders: [],

                    text: 'middle',
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    restoreTimelineToStorage(
      'room-1',
      timeline,
      new Map<number, string>([[0, 'room::text::1']]),
    );

    expect(loadTimelineFromStorage('room-1')).toEqual({
      totalDurationMs: 12_000,
      keyframeInterpolationMode: 'smooth',
      pixelsPerSecond: 24,
      tracks: [
        {
          id: expect.any(String),
          label: 'Track 1',
          clips: [
            {
              id: expect.any(String),
              inputId: 'room::text::1',
              startMs: 1000,
              endMs: 8000,
              blockSettings: {
                volume: 1,
                showTitle: true,
                shaders: [],

                text: 'intro',
              },
              keyframes: [
                {
                  id: 'kf-a',
                  timeMs: 0,
                  blockSettings: {
                    volume: 1,
                    showTitle: true,
                    shaders: [],

                    text: 'intro',
                  },
                },
                {
                  id: 'kf-b',
                  timeMs: 3000,
                  blockSettings: {
                    volume: 0.2,
                    showTitle: false,
                    shaders: [],

                    text: 'middle',
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('prefers the live timeline state over stale local storage during export', () => {
    const staleTimeline: RoomConfigTimeline = {
      totalDurationMs: 5000,
      pixelsPerSecond: 10,
      keyframeInterpolationMode: 'step',
      tracks: [
        {
          label: 'Track 1',
          clips: [
            {
              inputIndex: 0,
              startMs: 0,
              endMs: 5000,
              blockSettings: {
                volume: 1,
                showTitle: true,
                shaders: [],

                text: 'stale',
              },
              keyframes: [
                {
                  id: 'stale-kf',
                  timeMs: 0,
                  blockSettings: {
                    volume: 1,
                    showTitle: true,
                    shaders: [],

                    text: 'stale',
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    restoreTimelineToStorage(
      'room-2',
      staleTimeline,
      new Map<number, string>([[0, minimalInput.inputId]]),
    );

    const liveTimelineState: RoomConfigTimelineState = {
      tracks: [
        {
          id: 'track-live',
          label: 'Track 1',
          clips: [
            {
              id: 'clip-live',
              inputId: minimalInput.inputId,
              startMs: 0,
              endMs: 5000,
              blockSettings: {
                volume: 1,
                showTitle: true,
                shaders: [],

                text: 'fresh',
              },
              keyframes: [
                {
                  id: 'live-kf',
                  timeMs: 0,
                  blockSettings: {
                    volume: 1,
                    showTitle: true,
                    shaders: [],

                    text: 'fresh',
                  },
                },
              ],
            },
          ],
        },
      ],
      totalDurationMs: 5000,
      keyframeInterpolationMode: 'step',
      pixelsPerSecond: 15,
    };

    expect(resolveRoomConfigTimelineState('room-2', liveTimelineState)).toBe(
      liveTimelineState,
    );
  });
});

describe('output player settings persistence', () => {
  it('saves and loads output player settings', () => {
    saveOutputPlayerSettings('room-a', { muted: false, volume: 0.5 });
    const loaded = loadOutputPlayerSettings('room-a');
    expect(loaded).toEqual({ muted: false, volume: 0.5 });
  });

  it('returns null when no settings are stored', () => {
    expect(loadOutputPlayerSettings('room-nonexistent')).toBeNull();
  });

  it('stores settings per room independently', () => {
    saveOutputPlayerSettings('room-x', { muted: true, volume: 0 });
    saveOutputPlayerSettings('room-y', { muted: false, volume: 1 });
    expect(loadOutputPlayerSettings('room-x')).toEqual({
      muted: true,
      volume: 0,
    });
    expect(loadOutputPlayerSettings('room-y')).toEqual({
      muted: false,
      volume: 1,
    });
  });
});
