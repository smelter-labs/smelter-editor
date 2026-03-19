import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const fn = vi.fn;
  return {
    smelter: {
      registerOutput: fn<any>(),
      registerMp4Output: fn().mockResolvedValue(undefined),
      unregisterOutput: fn().mockResolvedValue(undefined),
      registerInput: fn().mockResolvedValue(''),
      unregisterInput: fn().mockResolvedValue(undefined),
      registerImage: fn().mockResolvedValue(undefined),
      unregisterImage: fn().mockResolvedValue(undefined),
      registerMotionOutput: fn().mockResolvedValue(undefined),
      unregisterMotionOutput: fn().mockResolvedValue(undefined),
      getPipelineTimeMs: fn().mockReturnValue(0),
      terminate: fn().mockResolvedValue(undefined),
    },
    twitchStartMonitor: fn().mockResolvedValue({
      isLive: () => true,
      stop: fn(),
      onUpdate: fn(),
    }),
    kickStartMonitor: fn().mockResolvedValue({
      isLive: () => true,
      stop: fn(),
      onUpdate: fn(),
    }),
    whipStartMonitor: fn().mockResolvedValue({
      isLive: () => false,
      touch: fn().mockReturnValue({
        previousAckTimestamp: Date.now(),
        currentAckTimestamp: Date.now(),
      }),
      getUsername: fn().mockReturnValue('test-user'),
      getLastAckTimestamp: fn().mockReturnValue(Date.now()),
      stop: fn(),
    }),
    pathExists: fn().mockResolvedValue(false),
    ensureDir: fn().mockResolvedValue(undefined),
    readdir: fn().mockResolvedValue([]),
    remove: fn().mockResolvedValue(undefined),
  };
});

vi.mock('../smelter', () => ({ SmelterInstance: mocks.smelter }));
vi.mock('../streamlink', () => ({
  hlsUrlForTwitchChannel: vi.fn(
    async (id: string) => `http://hls/twitch/${id}`,
  ),
  hlsUrlForKickChannel: vi.fn(async (id: string) => `http://hls/kick/${id}`),
}));
vi.mock('../twitch/TwitchChannelMonitor', () => ({
  TwitchChannelMonitor: { startMonitor: mocks.twitchStartMonitor },
}));
vi.mock('../kick/KickChannelMonitor', () => ({
  KickChannelMonitor: { startMonitor: mocks.kickStartMonitor },
}));
vi.mock('../whip/WhipInputMonitor', () => ({
  WhipInputMonitor: { startMonitor: mocks.whipStartMonitor },
}));
vi.mock('../mp4/mp4SuggestionMonitor', () => ({
  default: { mp4Files: ['test-video.mp4'] },
}));
vi.mock('fs-extra', () => ({
  pathExists: mocks.pathExists,
  ensureDir: mocks.ensureDir,
  readdir: mocks.readdir,
  remove: mocks.remove,
}));

import { createRoomStore } from '../app/store';
import { RESOLUTION_PRESETS } from '../types';
import type { TimelineConfig } from '@smelter-editor/types';

const { RoomState } = await import('../room/RoomState');

function createTestOutput(roomId = 'test-room') {
  const res = RESOLUTION_PRESETS['1440p'];
  return {
    id: roomId,
    url: `http://test-whep/${roomId}`,
    store: createRoomStore(res),
    resolution: res,
  };
}

function createTimelineConfig(
  inputId: string,
  initialKeyframeText: string,
): TimelineConfig {
  return {
    tracks: [
      {
        id: 'track-1',
        clips: [
          {
            id: 'clip-1',
            inputId,
            startMs: 0,
            endMs: 1000,
            blockSettings: {
              volume: 1,
              showTitle: true,
              shaders: [],
              orientation: 'horizontal',
              text: 'clip-default',
            },
            keyframes: [
              {
                id: 'kf-1',
                timeMs: 0,
                blockSettings: {
                  volume: 1,
                  showTitle: true,
                  shaders: [],
                  orientation: 'horizontal',
                  text: initialKeyframeText,
                },
              },
              {
                id: 'kf-2',
                timeMs: 500,
                blockSettings: {
                  volume: 1,
                  showTitle: true,
                  shaders: [],
                  orientation: 'horizontal',
                  text: `${initialKeyframeText}-later`,
                },
              },
            ],
          },
        ],
      },
    ],
    totalDurationMs: 1000,
    keyframeInterpolationMode: 'step',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pathExists.mockResolvedValue(false);
  mocks.ensureDir.mockResolvedValue(undefined);
  mocks.readdir.mockResolvedValue([]);
});

describe('RoomState', () => {
  describe('constructor and init', () => {
    it('creates a room with no non-placeholder inputs when skipDefaultInputs is true', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      const { inputs } = room.getState();
      for (const input of inputs) {
        expect(input.inputId).toContain('placeholder');
      }
    });

    it('sets creation and read timestamps', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      expect(room.creationTimestamp).toBeLessThanOrEqual(Date.now());
      expect(room.lastReadTimestamp).toBeLessThanOrEqual(Date.now());
    });

    it('assigns room name', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true, {
        pl: 'Kuchnia',
        en: 'Kitchen',
      });
      await room.init();

      expect(room.roomName.pl).toBe('Kuchnia');
      expect(room.roomName.en).toBe('Kitchen');
    });
  });

  describe('addNewInput', () => {
    it('adds a text input', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      const inputId = await room.addNewInput({
        type: 'text-input',
        text: 'Hello',
        textAlign: 'center',
      });

      expect(inputId).toBeDefined();
      const inputs = room.getInputs();
      const textInput = inputs.find((i) => i.inputId === inputId);
      expect(textInput).toBeDefined();
      expect(textInput!.type).toBe('text-input');
      if (textInput!.type === 'text-input') {
        expect(textInput!.text).toBe('Hello');
        expect(textInput!.textAlign).toBe('center');
      }
    });

    it('adds a game input with default state', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      const inputId = await room.addNewInput({
        type: 'game',
        title: 'Test Game',
      });
      expect(inputId).toBeDefined();

      const inputs = room.getInputs();
      const gameInput = inputs.find((i) => i.inputId === inputId);
      expect(gameInput).toBeDefined();
      expect(gameInput!.type).toBe('game');
      if (gameInput!.type === 'game') {
        expect(gameInput!.snakeGameState.boardWidth).toBe(20);
        expect(gameInput!.snakeGameState.boardHeight).toBe(20);
      }
    });

    it('removes placeholder when adding real inputs', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      await room.addNewInput({ type: 'text-input', text: 'Hello' });

      const inputs = room.getInputs();
      const placeholders = inputs.filter((i) =>
        i.inputId.includes('placeholder'),
      );
      expect(placeholders).toHaveLength(0);
    });

    it('adds a whip input', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      const inputId = await room.addNewInput({
        type: 'whip',
        username: 'test-user',
      });
      expect(inputId).toBeDefined();
      expect(inputId).toContain('whip');

      const whipInput = room.getInputs().find((i) => i.inputId === inputId);
      expect(whipInput).toBeDefined();
      expect(whipInput!.type).toBe('whip');
    });

    it('adds a twitch channel input', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      const inputId = await room.addNewInput({
        type: 'twitch-channel',
        channelId: 'test_channel',
      });
      expect(inputId).toBeDefined();
      expect(inputId).toContain('twitch');

      const input = room.getInputs().find((i) => i.inputId === inputId);
      expect(input).toBeDefined();
      expect(input!.type).toBe('twitch-channel');
    });

    it('adds a kick channel input', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      const inputId = await room.addNewInput({
        type: 'kick-channel',
        channelId: 'kick_channel',
      });
      expect(inputId).toBeDefined();
      expect(inputId).toContain('kick');

      const input = room.getInputs().find((i) => i.inputId === inputId);
      expect(input).toBeDefined();
      expect(input!.type).toBe('kick-channel');
    });
  });

  describe('removeInput', () => {
    it('removes an input by id', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      const inputId = (await room.addNewInput({
        type: 'text-input',
        text: 'Hello',
      }))!;
      expect(room.getInputs().some((i) => i.inputId === inputId)).toBe(true);

      await room.removeInput(inputId);

      const remaining = room
        .getInputs()
        .filter((i) => !i.inputId.includes('placeholder'));
      expect(remaining.some((i) => i.inputId === inputId)).toBe(false);
    });

    it('throws for unknown input id', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      await expect(room.removeInput('nonexistent')).rejects.toThrow(
        /not found/,
      );
    });

    it('cleans up attachedInputIds references', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      const id1 = (await room.addNewInput({ type: 'text-input', text: 'A' }))!;
      const id2 = (await room.addNewInput({ type: 'text-input', text: 'B' }))!;

      await room.updateInput(id1, { attachedInputIds: [id2] } as any);
      expect(
        room.getInputs().find((i) => i.inputId === id1)?.attachedInputIds,
      ).toContain(id2);

      await room.removeInput(id2);

      expect(
        room.getInputs().find((i) => i.inputId === id1)?.attachedInputIds ?? [],
      ).not.toContain(id2);
    });
  });

  describe('updateInput', () => {
    it('updates volume and shaders', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      const inputId = (await room.addNewInput({
        type: 'text-input',
        text: 'Test',
      }))!;

      await room.updateInput(inputId, {
        volume: 0.8,
        shaders: [
          { shaderName: 'Blur', shaderId: 'blur', enabled: true, params: [] },
        ],
      });

      const input = room.getInputs().find((i) => i.inputId === inputId);
      expect(input?.volume).toBe(0.8);
      expect(input?.shaders).toHaveLength(1);
      expect(input?.shaders[0].shaderId).toBe('blur');
    });

    it('updates text-specific fields', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      const inputId = (await room.addNewInput({
        type: 'text-input',
        text: 'Original',
      }))!;

      await room.updateInput(inputId, {
        text: 'Updated',
        textColor: '#00ff00',
        textFontSize: 48,
      });

      const input = room.getInputs().find((i) => i.inputId === inputId);
      if (input?.type === 'text-input') {
        expect(input.text).toBe('Updated');
        expect(input.textColor).toBe('#00ff00');
        expect(input.textFontSize).toBe(48);
      }
    });

    it('updates absolute position fields', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      const inputId = (await room.addNewInput({
        type: 'text-input',
        text: 'Test',
      }))!;

      await room.updateInput(inputId, {
        absolutePosition: true,
        absoluteTop: 100,
        absoluteLeft: 200,
        absoluteWidth: 300,
        absoluteHeight: 400,
      });

      const input = room.getInputs().find((i) => i.inputId === inputId);
      expect(input?.absolutePosition).toBe(true);
      expect(input?.absoluteTop).toBe(100);
      expect(input?.absoluteLeft).toBe(200);
      expect(input?.absoluteWidth).toBe(300);
      expect(input?.absoluteHeight).toBe(400);
    });

    it('updates game-specific fields', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      const inputId = (await room.addNewInput({ type: 'game' }))!;

      await room.updateInput(inputId, {
        gameBackgroundColor: '#222222',
        gameCellGap: 4,
        gameBoardBorderWidth: 8,
      });

      const input = room.getInputs().find((i) => i.inputId === inputId);
      if (input?.type === 'game') {
        expect(input.snakeGameState.backgroundColor).toBe('#222222');
        expect(input.snakeGameState.cellGap).toBe(4);
        expect(input.snakeGameState.boardBorderWidth).toBe(8);
      }
    });
  });

  describe('reorderInputs', () => {
    it('reorders inputs according to provided order', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      // Use different input types to guarantee unique IDs (Date.now may repeat)
      const id1 = (await room.addNewInput({ type: 'text-input', text: 'A' }))!;
      const id2 = (await room.addNewInput({ type: 'game', title: 'B' }))!;
      const id3 = (await room.addNewInput({ type: 'whip', username: 'C' }))!;

      await room.reorderInputs([id3, id1, id2]);

      const ids = room.getInputs().map((i) => i.inputId);
      expect(ids.indexOf(id3)).toBeLessThan(ids.indexOf(id1));
      expect(ids.indexOf(id1)).toBeLessThan(ids.indexOf(id2));
    });

    it('appends inputs not in the order list at the end', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      const id1 = (await room.addNewInput({ type: 'text-input', text: 'A' }))!;
      const id2 = (await room.addNewInput({ type: 'game', title: 'B' }))!;

      await room.reorderInputs([id2]);

      const ids = room.getInputs().map((i) => i.inputId);
      expect(ids.indexOf(id2)).toBeLessThan(ids.indexOf(id1));
    });
  });

  describe('updateLayout', () => {
    it('changes the layout', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      await room.updateLayout('grid');
      expect(room.getState().layout).toBe('grid');

      await room.updateLayout('primary-on-left');
      expect(room.getState().layout).toBe('primary-on-left');
    });
  });

  describe('hideInput / showInput', () => {
    it('hides and shows an input', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      const inputId = (await room.addNewInput({
        type: 'text-input',
        text: 'Test',
      }))!;

      await room.hideInput(inputId);
      expect(room.getInputs().find((i) => i.inputId === inputId)?.hidden).toBe(
        true,
      );

      await room.showInput(inputId);
      expect(room.getInputs().find((i) => i.inputId === inputId)?.hidden).toBe(
        false,
      );
    });
  });

  describe('getState', () => {
    it('returns RoomSnapshot with inputs, layout, and settings', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      const result = room.getState();
      expect(Array.isArray(result.inputs)).toBe(true);
      expect(typeof result.layout).toBe('string');
      expect(typeof result.swapDurationMs).toBe('number');
      expect(typeof result.swapOutgoingEnabled).toBe('boolean');
      expect(typeof result.newsStripEnabled).toBe('boolean');
    });

    it('updates lastReadTimestamp', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      const before = room.lastReadTimestamp;
      await new Promise((r) => setTimeout(r, 10));
      room.getState();
      expect(room.lastReadTimestamp).toBeGreaterThanOrEqual(before);
    });
  });

  describe('swap and news strip settings', () => {
    it('sets and gets swap duration', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      room.setSwapDurationMs(1000);
      expect(room.getSwapDurationMs()).toBe(1000);
    });

    it('sets and gets swap outgoing enabled', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      room.setSwapOutgoingEnabled(false);
      expect(room.getSwapOutgoingEnabled()).toBe(false);
    });

    it('sets and gets news strip enabled', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      room.setNewsStripEnabled(true);
      expect(room.getNewsStripEnabled()).toBe(true);
    });

    it('sets and gets fade durations', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      room.setSwapFadeInDurationMs(250);
      expect(room.getSwapFadeInDurationMs()).toBe(250);

      room.setSwapFadeOutDurationMs(750);
      expect(room.getSwapFadeOutDurationMs()).toBe(750);
    });
  });

  describe('timeline playback', () => {
    it('uses the latest keyframes when playback resumes from pause', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      const inputId = (await room.addNewInput({
        type: 'text-input',
        text: 'Original',
      }))!;

      await room.startTimelinePlayback(createTimelineConfig(inputId, 'First'), 0);
      await room.pauseTimeline();
      await room.startTimelinePlayback(createTimelineConfig(inputId, 'Updated'), 0);

      const resumedInput = room.getInputs().find((i) => i.inputId === inputId);
      expect(resumedInput?.type).toBe('text-input');
      if (resumedInput?.type === 'text-input') {
        expect(resumedInput.text).toBe('Updated');
      }

      await room.stopTimelinePlayback();

      const restoredInput = room.getInputs().find((i) => i.inputId === inputId);
      expect(restoredInput?.type).toBe('text-input');
      if (restoredInput?.type === 'text-input') {
        expect(restoredInput.text).toBe('Original');
      }
    });

    it('applies step keyframes during playback', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);

      try {
        const output = createTestOutput();
        const room = new RoomState('room-1', output, [], true);
        await room.init();

        const inputId = (await room.addNewInput({
          type: 'text-input',
          text: 'Original',
        }))!;

        await room.startTimelinePlayback(createTimelineConfig(inputId, 'First'), 0);

        const initialInput = room.getInputs().find((i) => i.inputId === inputId);
        expect(initialInput?.type).toBe('text-input');
        if (initialInput?.type === 'text-input') {
          expect(initialInput.text).toBe('First');
        }

        await vi.advanceTimersByTimeAsync(500);

        const midPlaybackInput = room.getInputs().find((i) => i.inputId === inputId);
        expect(midPlaybackInput?.type).toBe('text-input');
        if (midPlaybackInput?.type === 'text-input') {
          expect(midPlaybackInput.text).toBe('First-later');
        }

        await room.stopTimelinePlayback();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('deleteRoom', () => {
    it('unregisters output from smelter', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      await room.addNewInput({ type: 'text-input', text: 'A' });
      await room.deleteRoom();

      expect(mocks.smelter.unregisterOutput).toHaveBeenCalledWith(output.id);
    });
  });

  describe('recording', () => {
    it('reports no active recording initially', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      expect(room.hasActiveRecording()).toBe(false);
    });

    it('starts and stops recording', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      const { fileName } = await room.startRecording();
      expect(fileName).toContain('recording-');
      expect(room.hasActiveRecording()).toBe(true);

      const result = await room.stopRecording();
      expect(result.fileName).toBe(fileName);
      expect(room.hasActiveRecording()).toBe(false);
    });

    it('throws when starting recording twice', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      await room.startRecording();
      await expect(room.startRecording()).rejects.toThrow(
        /already in progress/,
      );
      await room.stopRecording();
    });
  });

  describe('state change notifications', () => {
    it('notifies listeners when isPublic changes', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      const listener = vi.fn();
      room.addStateChangeListener(listener);

      room.isPublic = false;
      expect(listener).toHaveBeenCalledTimes(1);

      room.isPublic = true;
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('notifies listeners when pendingWhipInputs changes', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      const listener = vi.fn();
      room.addStateChangeListener(listener);

      room.pendingWhipInputs = [
        {
          id: 'whip-1',
          title: 'Camera',
          position: 0,
          volume: 1,
          showTitle: true,
          shaders: [],
          orientation: 'horizontal' as const,
        },
      ];
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('notifies listeners when pendingDelete changes', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      const listener = vi.fn();
      room.addStateChangeListener(listener);

      room.pendingDelete = true;
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('notifies listeners on timeline pause/resume/stop', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      const inputId = (await room.addNewInput({
        type: 'text-input',
        text: 'Test',
      }))!;

      const listener = vi.fn();
      room.addStateChangeListener(listener);
      const callsBefore = listener.mock.calls.length;

      await room.startTimelinePlayback(
        createTimelineConfig(inputId, 'TL'),
        0,
      );
      expect(listener.mock.calls.length).toBeGreaterThan(callsBefore);

      const callsAfterStart = listener.mock.calls.length;
      await room.pauseTimeline();
      expect(listener.mock.calls.length).toBeGreaterThan(callsAfterStart);

      const callsAfterPause = listener.mock.calls.length;
      await room.resumeTimeline();
      expect(listener.mock.calls.length).toBeGreaterThan(callsAfterPause);

      const callsAfterResume = listener.mock.calls.length;
      await room.stopTimelinePlayback();
      expect(listener.mock.calls.length).toBeGreaterThan(callsAfterResume);
    });

    it('unsubscribes listener via returned function', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      const listener = vi.fn();
      const unsub = room.addStateChangeListener(listener);

      room.isPublic = false;
      expect(listener).toHaveBeenCalledTimes(1);

      unsub();
      room.isPublic = true;
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('publicInputState serialization', () => {
    it('includes activeTransition in serialized output', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      const inputId = (await room.addNewInput({
        type: 'text-input',
        text: 'Test',
      }))!;

      const transition = {
        type: 'fade',
        durationMs: 300,
        direction: 'in' as const,
      };
      await room.showInput(inputId, transition);

      const { toPublicInputState } = await import(
        '../server/publicInputState'
      );
      const input = room.getInputs().find((i) => i.inputId === inputId)!;
      const pub = toPublicInputState(input);
      expect(pub.activeTransition).toMatchObject(transition);
    });

    it('includes textScrollNudge for text-input', async () => {
      const output = createTestOutput();
      const room = new RoomState('room-1', output, [], true);
      await room.init();

      const inputId = (await room.addNewInput({
        type: 'text-input',
        text: 'Test',
      }))!;

      const { toPublicInputState } = await import(
        '../server/publicInputState'
      );
      const input = room.getInputs().find((i) => i.inputId === inputId)!;
      const pub = toPublicInputState(input);
      expect('textScrollNudge' in pub).toBe(true);
    });
  });

  describe('getWhepUrl and getResolution', () => {
    it('returns the WHEP url from output', async () => {
      const output = createTestOutput('my-room');
      const room = new RoomState('my-room', output, [], true);
      await room.init();

      expect(room.getWhepUrl()).toBe('http://test-whep/my-room');
    });

    it('returns the resolution from output', async () => {
      const res = RESOLUTION_PRESETS['1440p'];
      const output = createTestOutput();
      const room = new RoomState('test', output, [], true);
      await room.init();

      const resolution = room.getResolution();
      expect(resolution.width).toBe(res.width);
      expect(resolution.height).toBe(res.height);
    });
  });
});
