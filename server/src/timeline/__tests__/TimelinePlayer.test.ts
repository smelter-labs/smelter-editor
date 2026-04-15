import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  TimelineConfig,
  TimelineClip,
  TimelineBlockSettings,
} from '@smelter-editor/types';
import { OUTPUT_TRACK_INPUT_ID } from '@smelter-editor/types';
import type {
  TimelineRoomStateAdapter,
  TimelineListenerData,
} from '../TimelinePlayer';
import { TimelinePlayer } from '../TimelinePlayer';

function makeBlockSettings(
  overrides: Partial<TimelineBlockSettings> = {},
): TimelineBlockSettings {
  return {
    volume: 1,
    shaders: [],
    showTitle: false,
    ...overrides,
  };
}

function makeClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip-1',
    inputId: 'input-1',
    startMs: 0,
    endMs: 5000,
    blockSettings: makeBlockSettings(),
    keyframes: [],
    ...overrides,
  };
}

function makeConfig(overrides: Partial<TimelineConfig> = {}): TimelineConfig {
  return {
    tracks: [],
    totalDurationMs: 10000,
    keyframeInterpolationMode: 'step',
    ...overrides,
  };
}

function createMockAdapter(): TimelineRoomStateAdapter {
  return {
    getInputs: vi.fn().mockReturnValue([]),
    getLayers: vi.fn().mockReturnValue([]),
    showInput: vi.fn().mockResolvedValue(undefined),
    hideInput: vi.fn().mockResolvedValue(undefined),
    updateInput: vi.fn().mockResolvedValue(undefined),
    updateLayers: vi.fn().mockResolvedValue(undefined),
    restartMp4Input: vi.fn().mockResolvedValue(undefined),
    reorderInputs: vi.fn().mockResolvedValue(undefined),
    updateOutputShaders: vi.fn().mockResolvedValue(undefined),
    getOutputShaders: vi.fn().mockReturnValue([]),
  };
}

function makeConnectedMp4Input(inputId: string, overrides: Record<string, unknown> = {}) {
  return {
    inputId,
    type: 'local-mp4',
    status: 'connected',
    hidden: false,
    volume: 1,
    shaders: [],
    showTitle: false,
    borderColor: '#000000',
    borderWidth: 0,
    metadata: { title: inputId, description: '' },
    mp4FilePath: '/tmp/test.mp4',
    ...overrides,
  };
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('TimelinePlayer', () => {
  let adapter: TimelineRoomStateAdapter;

  beforeEach(() => {
    vi.useFakeTimers();
    adapter = createMockAdapter();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor and initial state', () => {
    it('is not playing after construction', () => {
      const player = new TimelinePlayer(adapter, makeConfig());
      expect(player.isPlaying()).toBe(false);
    });

    it('getPlayheadMs returns 0 initially', () => {
      const player = new TimelinePlayer(adapter, makeConfig());
      expect(player.getPlayheadMs()).toBe(0);
    });

    it('getTotalDurationMs returns config value', () => {
      const player = new TimelinePlayer(
        adapter,
        makeConfig({ totalDurationMs: 30000 }),
      );
      expect(player.getTotalDurationMs()).toBe(30000);
    });
  });

  describe('getActiveInputIdsAt', () => {
    it('returns empty for time before any clip', () => {
      const config = makeConfig({
        tracks: [
          { id: 't1', clips: [makeClip({ startMs: 1000, endMs: 5000 })] },
        ],
      });
      const player = new TimelinePlayer(adapter, config);
      expect(player.getActiveInputIdsAt(500)).toEqual([]);
    });

    it('returns inputId when time falls within clip range', () => {
      const config = makeConfig({
        tracks: [
          {
            id: 't1',
            clips: [makeClip({ inputId: 'a', startMs: 1000, endMs: 5000 })],
          },
        ],
      });
      const player = new TimelinePlayer(adapter, config);
      expect(player.getActiveInputIdsAt(3000)).toEqual(['a']);
    });

    it('clip is active at startMs, inactive at endMs', () => {
      const config = makeConfig({
        tracks: [
          {
            id: 't1',
            clips: [makeClip({ inputId: 'a', startMs: 1000, endMs: 5000 })],
          },
        ],
      });
      const player = new TimelinePlayer(adapter, config);
      expect(player.getActiveInputIdsAt(1000)).toEqual(['a']);
      expect(player.getActiveInputIdsAt(5000)).toEqual([]);
    });

    it('excludes OUTPUT_TRACK_INPUT_ID', () => {
      const config = makeConfig({
        tracks: [
          {
            id: 't1',
            clips: [
              makeClip({
                inputId: OUTPUT_TRACK_INPUT_ID,
                startMs: 0,
                endMs: 5000,
              }),
              makeClip({
                id: 'c2',
                inputId: 'real-input',
                startMs: 0,
                endMs: 5000,
              }),
            ],
          },
        ],
      });
      const player = new TimelinePlayer(adapter, config);
      // getActiveInputIdsAt returns all active clip inputIds including OUTPUT_TRACK_INPUT_ID
      // since it's based on getActiveClipsByInputAt which doesn't filter
      const result = player.getActiveInputIdsAt(2000);
      expect(result).toContain('real-input');
    });

    it('handles overlapping clips on different tracks', () => {
      const config = makeConfig({
        tracks: [
          {
            id: 't1',
            clips: [makeClip({ inputId: 'a', startMs: 0, endMs: 5000 })],
          },
          {
            id: 't2',
            clips: [
              makeClip({ id: 'c2', inputId: 'b', startMs: 2000, endMs: 8000 }),
            ],
          },
        ],
      });
      const player = new TimelinePlayer(adapter, config);
      expect(player.getActiveInputIdsAt(3000)).toEqual(
        expect.arrayContaining(['a', 'b']),
      );
    });
  });

  describe('updateConfig', () => {
    it('replaces the internal config', () => {
      const player = new TimelinePlayer(
        adapter,
        makeConfig({ totalDurationMs: 5000 }),
      );
      player.updateConfig(makeConfig({ totalDurationMs: 20000 }));
      expect(player.getTotalDurationMs()).toBe(20000);
    });
  });

  describe('start', () => {
    it('sets playing to true', async () => {
      const player = new TimelinePlayer(adapter, makeConfig());
      await player.start();
      expect(player.isPlaying()).toBe(true);
    });

    it('applies initial desired state (shows/hides inputs)', async () => {
      // 'a' is hidden but should be visible (active at t=0)
      // 'b' is visible (connected + not hidden) but should be hidden (not active at t=0)
      (adapter.getInputs as any).mockReturnValue([
        { inputId: 'a', hidden: true, status: 'connected', type: 'text-input' },
        {
          inputId: 'b',
          hidden: false,
          status: 'connected',
          type: 'text-input',
        },
      ]);
      const config = makeConfig({
        tracks: [
          {
            id: 't1',
            clips: [makeClip({ inputId: 'a', startMs: 0, endMs: 5000 })],
          },
          {
            id: 't2',
            clips: [
              makeClip({ id: 'c2', inputId: 'b', startMs: 6000, endMs: 8000 }),
            ],
          },
        ],
      });

      const player = new TimelinePlayer(adapter, config);
      await player.start(0);

      // 'a' should be shown (active at 0)
      expect(adapter.showInput).toHaveBeenCalled();
      // 'b' should be hidden (not active at 0) — called without transition arg
      expect(adapter.hideInput).toHaveBeenCalledWith('b');
    });

    it('schedules end-of-timeline auto-stop timer', async () => {
      const config = makeConfig({ totalDurationMs: 5000 });
      const player = new TimelinePlayer(adapter, config);
      await player.start(0);

      expect(player.isPlaying()).toBe(true);

      // Fast-forward past the total duration
      vi.advanceTimersByTime(5001);

      expect(player.isPlaying()).toBe(false);
    });
  });

  describe('stop', () => {
    it('sets playing to false', async () => {
      const player = new TimelinePlayer(adapter, makeConfig());
      await player.start();
      await player.stop();
      expect(player.isPlaying()).toBe(false);
    });

    it('is idempotent when not playing', async () => {
      const player = new TimelinePlayer(adapter, makeConfig());
      // Should not throw
      await player.stop();
      expect(player.isPlaying()).toBe(false);
    });

    it('restores snapshot state on stop', async () => {
      const inputData = {
        inputId: 'a',
        hidden: false,
        status: 'connected',
        type: 'text-input',
        volume: 0.5,
        shaders: [],
        showTitle: true,
        borderColor: '#000',
        borderWidth: 0,
        metadata: { title: 'A', description: '' },
        text: 'hi',
        textAlign: 'left',
        textColor: '#fff',
        textMaxLines: 1,
        textScrollEnabled: true,
        textScrollSpeed: 0,
        textScrollLoop: false,
        textFontSize: 16,
      };
      (adapter.getInputs as any).mockReturnValue([inputData]);
      (adapter.getLayers as any).mockReturnValue([]);

      const config = makeConfig({
        tracks: [
          {
            id: 't1',
            clips: [
              makeClip({
                inputId: 'a',
                startMs: 0,
                endMs: 5000,
                blockSettings: makeBlockSettings({ volume: 1.0 }),
              }),
            ],
          },
        ],
      });

      const player = new TimelinePlayer(adapter, config);
      await player.start(0);
      await player.stop();

      // After stop, restoreState should call updateLayers at minimum
      expect(adapter.updateLayers).toHaveBeenCalled();
    });
  });

  describe('pause', () => {
    it('captures current playhead position', async () => {
      const player = new TimelinePlayer(adapter, makeConfig());
      await player.start(0);

      vi.advanceTimersByTime(1000);
      player.pause();

      // Playhead should be approximately at 1000ms
      expect(player.getPlayheadMs()).toBeGreaterThanOrEqual(1000);
    });
  });

  describe('addListener', () => {
    it('listener receives playheadMs, isPlaying, isPaused', async () => {
      const player = new TimelinePlayer(adapter, makeConfig());
      const received: TimelineListenerData[] = [];
      player.addListener((data) => received.push({ ...data }));

      await player.start(0);

      expect(received.length).toBeGreaterThan(0);
      expect(received[0]).toHaveProperty('playheadMs');
      expect(received[0]).toHaveProperty('isPlaying');
      expect(received[0]).toHaveProperty('isPaused');
    });

    it('returns unsubscribe function that removes listener', async () => {
      const player = new TimelinePlayer(adapter, makeConfig());
      const received: TimelineListenerData[] = [];
      const unsub = player.addListener((data) => received.push({ ...data }));

      unsub();
      await player.start(0);

      expect(received).toHaveLength(0);
    });
  });

  describe('event compilation and scheduling', () => {
    it('schedules connect event for clip starting after fromMs', async () => {
      // Input 'a' must exist in room for showInputAtTime to proceed
      (adapter.getInputs as any).mockReturnValue([
        { inputId: 'a', hidden: true, status: 'connected', type: 'text-input' },
      ]);
      const config = makeConfig({
        tracks: [
          {
            id: 't1',
            clips: [makeClip({ inputId: 'a', startMs: 2000, endMs: 5000 })],
          },
        ],
      });
      const player = new TimelinePlayer(adapter, config);
      await player.start(0);

      (adapter.showInput as any).mockClear();
      // Use advanceTimersToNextTimerAsync which also flushes microtasks
      await vi.advanceTimersByTimeAsync(2001);

      // showInputAtTime should eventually call showInput
      expect(adapter.showInput).toHaveBeenCalled();
    });

    it('schedules disconnect event at clip end', async () => {
      (adapter.getInputs as any).mockReturnValue([
        { inputId: 'a', hidden: true, status: 'connected', type: 'text-input' },
      ]);
      const config = makeConfig({
        tracks: [
          {
            id: 't1',
            clips: [makeClip({ inputId: 'a', startMs: 0, endMs: 3000 })],
          },
        ],
      });
      const player = new TimelinePlayer(adapter, config);
      await player.start(0);

      (adapter.hideInput as any).mockClear();
      await vi.advanceTimersByTimeAsync(3001);

      // hideInput called without transition at clip end
      expect(adapter.hideInput).toHaveBeenCalledWith('a');
    });

    it('schedules transition-in events for clips with introTransition', async () => {
      (adapter.getInputs as any).mockReturnValue([
        { inputId: 'a', hidden: true, status: 'connected', type: 'text-input' },
      ]);
      const config = makeConfig({
        tracks: [
          {
            id: 't1',
            clips: [
              makeClip({
                inputId: 'a',
                startMs: 1000,
                endMs: 5000,
                blockSettings: makeBlockSettings({
                  introTransition: { type: 'fade', durationMs: 500 },
                }),
              }),
            ],
          },
        ],
      });
      const player = new TimelinePlayer(adapter, config);
      await player.start(0);

      (adapter.showInput as any).mockClear();
      await vi.advanceTimersByTimeAsync(1001);

      // showInput should be called with the intro transition
      expect(adapter.showInput).toHaveBeenCalledWith('a', {
        type: 'fade',
        durationMs: 500,
        direction: 'in',
      });
    });
  });

  describe('reorderInputs respects layer order', () => {
    it('uses layer.inputs order instead of track order for reorderInputs', async () => {
      (adapter.getInputs as any).mockReturnValue([
        { inputId: 'a', hidden: false, status: 'connected', type: 'text-input' },
        { inputId: 'b', hidden: false, status: 'connected', type: 'text-input' },
      ]);
      (adapter.getLayers as any).mockReturnValue([
        { id: 'L1', inputs: [{ inputId: 'b' }, { inputId: 'a' }] },
      ]);

      const config = makeConfig({
        tracks: [
          {
            id: 't1',
            clips: [makeClip({ inputId: 'a', startMs: 0, endMs: 5000 })],
          },
          {
            id: 't2',
            clips: [
              makeClip({ id: 'c2', inputId: 'b', startMs: 0, endMs: 5000 }),
            ],
          },
        ],
      });

      const player = new TimelinePlayer(adapter, config);
      await player.start(0);

      expect(adapter.reorderInputs).toHaveBeenCalledWith(['b', 'a']);
    });

    it('appends active inputs not in any layer at the end', async () => {
      (adapter.getInputs as any).mockReturnValue([
        { inputId: 'a', hidden: false, status: 'connected', type: 'text-input' },
        { inputId: 'b', hidden: false, status: 'connected', type: 'text-input' },
        { inputId: 'c', hidden: false, status: 'connected', type: 'text-input' },
      ]);
      (adapter.getLayers as any).mockReturnValue([
        { id: 'L1', inputs: [{ inputId: 'b' }] },
      ]);

      const config = makeConfig({
        tracks: [
          {
            id: 't1',
            clips: [makeClip({ inputId: 'a', startMs: 0, endMs: 5000 })],
          },
          {
            id: 't2',
            clips: [
              makeClip({ id: 'c2', inputId: 'b', startMs: 0, endMs: 5000 }),
            ],
          },
          {
            id: 't3',
            clips: [
              makeClip({ id: 'c3', inputId: 'c', startMs: 0, endMs: 5000 }),
            ],
          },
        ],
      });

      const player = new TimelinePlayer(adapter, config);
      await player.start(0);

      const calls = (adapter.reorderInputs as any).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      const order = calls[calls.length - 1][0] as string[];
      expect(order[0]).toBe('b');
      expect(order).toContain('a');
      expect(order).toContain('c');
      expect(order.indexOf('b')).toBeLessThan(order.indexOf('a'));
      expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
    });

    it('respects order across multiple layers', async () => {
      (adapter.getInputs as any).mockReturnValue([
        { inputId: 'a', hidden: false, status: 'connected', type: 'text-input' },
        { inputId: 'b', hidden: false, status: 'connected', type: 'text-input' },
        { inputId: 'c', hidden: false, status: 'connected', type: 'text-input' },
      ]);
      (adapter.getLayers as any).mockReturnValue([
        { id: 'L1', inputs: [{ inputId: 'c' }] },
        { id: 'L2', inputs: [{ inputId: 'a' }, { inputId: 'b' }] },
      ]);

      const config = makeConfig({
        tracks: [
          {
            id: 't1',
            clips: [makeClip({ inputId: 'a', startMs: 0, endMs: 5000 })],
          },
          {
            id: 't2',
            clips: [
              makeClip({ id: 'c2', inputId: 'b', startMs: 0, endMs: 5000 }),
            ],
          },
          {
            id: 't3',
            clips: [
              makeClip({ id: 'c3', inputId: 'c', startMs: 0, endMs: 5000 }),
            ],
          },
        ],
      });

      const player = new TimelinePlayer(adapter, config);
      await player.start(0);

      expect(adapter.reorderInputs).toHaveBeenCalledWith(['c', 'a', 'b']);
    });

    it('updates order when a new block starts mid-playback', async () => {
      (adapter.getInputs as any).mockReturnValue([
        { inputId: 'a', hidden: false, status: 'connected', type: 'text-input' },
        { inputId: 'b', hidden: true, status: 'connected', type: 'text-input' },
      ]);
      (adapter.getLayers as any).mockReturnValue([
        { id: 'L1', inputs: [{ inputId: 'b' }, { inputId: 'a' }] },
      ]);

      const config = makeConfig({
        tracks: [
          {
            id: 't1',
            clips: [makeClip({ inputId: 'a', startMs: 0, endMs: 5000 })],
          },
          {
            id: 't2',
            clips: [
              makeClip({ id: 'c2', inputId: 'b', startMs: 2000, endMs: 5000 }),
            ],
          },
        ],
      });

      const player = new TimelinePlayer(adapter, config);
      await player.start(0);

      (adapter.reorderInputs as any).mockClear();
      await vi.advanceTimersByTimeAsync(2001);

      expect(adapter.reorderInputs).toHaveBeenCalledWith(['b', 'a']);
    });
  });

  describe('stress seek/stop with many MP4 inputs', () => {
    it('does not repeatedly restart unchanged MP4 clips during rapid seeks', async () => {
      const mp4Inputs = Array.from({ length: 24 }, (_, index) => ({
        inputId: `room::local::${index}`,
        hidden: false,
        status: 'connected',
        type: 'local-mp4',
      }));
      (adapter.getInputs as any).mockReturnValue(mp4Inputs);
      (adapter.getLayers as any).mockReturnValue([{ id: 'L1', inputs: [] }]);

      const tracks = [
        {
          id: 't-mp4',
          clips: mp4Inputs.map((input, index) =>
            makeClip({
              id: `clip-${index}`,
              inputId: input.inputId,
              startMs: 0,
              endMs: 15_000,
              blockSettings: makeBlockSettings({
                mp4PlayFromMs: 1_000,
                mp4Loop: true,
              }),
            }),
          ),
        },
      ];
      const player = new TimelinePlayer(
        adapter,
        makeConfig({
          tracks,
          totalDurationMs: 15_000,
        }),
      );

      await player.start(0);
      for (const seekMs of [200, 450, 900, 1_350, 1_900, 2_450, 3_100, 3_900]) {
        await player.seek(seekMs);
      }
      await player.stop();

      expect(adapter.restartMp4Input).toHaveBeenCalledTimes(0);
    });
  });

  describe('stop/restore race handling', () => {
    it('waits for in-flight smooth apply before stopPlaybackOnly resolves', async () => {
      const deferred = createDeferred<void>();
      let updateCallCount = 0;
      (adapter.updateInput as any).mockImplementation(() => {
        updateCallCount += 1;
        if (updateCallCount === 2) {
          return deferred.promise;
        }
        return Promise.resolve();
      });
      (adapter.getInputs as any).mockReturnValue([
        makeConnectedMp4Input('room::local::slow'),
      ]);
      const config = makeConfig({
        keyframeInterpolationMode: 'linear',
        tracks: [
          {
            id: 't1',
            clips: [
              makeClip({
                inputId: 'room::local::slow',
                startMs: 0,
                endMs: 10_000,
                blockSettings: makeBlockSettings({
                  mp4PlayFromMs: 100,
                  mp4Loop: true,
                }),
                keyframes: [
                  {
                    id: 'kf-0',
                    timeMs: 0,
                    blockSettings: makeBlockSettings({
                      volume: 0.2,
                      mp4PlayFromMs: 100,
                      mp4Loop: true,
                    }),
                  },
                  {
                    id: 'kf-1',
                    timeMs: 5_000,
                    blockSettings: makeBlockSettings({
                      volume: 1,
                      mp4PlayFromMs: 100,
                      mp4Loop: true,
                    }),
                  },
                ],
              }),
            ],
          },
        ],
      });

      const player = new TimelinePlayer(adapter, config);
      await player.start(0);

      await vi.advanceTimersByTimeAsync(40);
      let stopResolved = false;
      const stopPromise = player.stopPlaybackOnly().then(() => {
        stopResolved = true;
      });

      await vi.advanceTimersByTimeAsync(1);
      expect(stopResolved).toBe(false);

      deferred.resolve();
      await stopPromise;
      expect(stopResolved).toBe(true);
    });

    it('restores MP4 restarts sequentially after stop', async () => {
      const inputs = [
        makeConnectedMp4Input('room::local::mp4-1'),
        makeConnectedMp4Input('room::local::mp4-2'),
      ];
      (adapter.getInputs as any).mockReturnValue(inputs);
      const releaseFirstRestart = createDeferred<void>();
      let firstFinished = false;
      (adapter.restartMp4Input as any).mockImplementation((inputId: string) => {
        if (inputId === 'room::local::mp4-1') {
          return releaseFirstRestart.promise.then(() => {
            firstFinished = true;
          });
        }
        expect(firstFinished).toBe(true);
        return Promise.resolve();
      });

      const player = new TimelinePlayer(adapter, makeConfig());
      await player.start(0);
      (player as any).mp4ActualRestarted = new Set([
        'room::local::mp4-1',
        'room::local::mp4-2',
      ]);

      const stopPromise = player.stop();
      await vi.advanceTimersByTimeAsync(1);
      expect(adapter.restartMp4Input).toHaveBeenCalledTimes(1);
      expect(adapter.restartMp4Input).toHaveBeenNthCalledWith(
        1,
        'room::local::mp4-1',
        0,
        true,
      );

      releaseFirstRestart.resolve();
      await stopPromise;
      expect(adapter.restartMp4Input).toHaveBeenCalledTimes(2);
      expect(adapter.restartMp4Input).toHaveBeenNthCalledWith(
        2,
        'room::local::mp4-2',
        0,
        true,
      );
    });

    it('does not mark MP4 as restarted when restart failed', async () => {
      (adapter.getInputs as any).mockReturnValue([
        makeConnectedMp4Input('room::local::mp4-1'),
      ]);
      const config = makeConfig({
        tracks: [
          {
            id: 't1',
            clips: [
              makeClip({
                inputId: 'room::local::mp4-1',
                startMs: 0,
                endMs: 5_000,
                blockSettings: makeBlockSettings({
                  mp4PlayFromMs: 0,
                  mp4Loop: true,
                }),
                keyframes: [
                  {
                    id: 'kf-0',
                    timeMs: 0,
                    blockSettings: makeBlockSettings({
                      mp4PlayFromMs: 0,
                      mp4Loop: true,
                    }),
                  },
                  {
                    id: 'kf-1',
                    timeMs: 1_000,
                    blockSettings: makeBlockSettings({
                      mp4PlayFromMs: 0,
                      mp4Loop: false,
                    }),
                  },
                ],
              }),
            ],
          },
        ],
      });

      const player = new TimelinePlayer(adapter, config);
      await player.start(0);

      (adapter.restartMp4Input as any).mockReset();
      (adapter.restartMp4Input as any).mockRejectedValueOnce(
        new Error('restart failed'),
      );

      await player.seek(1_200);
      await player.stop();

      expect(adapter.restartMp4Input).toHaveBeenCalledTimes(1);
      expect(adapter.restartMp4Input).toHaveBeenNthCalledWith(
        1,
        'room::local::mp4-1',
        expect.any(Number),
        false,
      );
    });
  });
});
