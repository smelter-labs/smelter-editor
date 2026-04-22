import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const fn = vi.fn;
  return {
    smelter: {
      registerInput: fn().mockResolvedValue(''),
      unregisterInput: fn().mockResolvedValue(undefined),
      registerImage: fn().mockResolvedValue(undefined),
      unregisterImage: fn().mockResolvedValue(undefined),
      getPipelineTimeMs: fn().mockReturnValue(0),
    },
    getMp4DurationMs: fn().mockResolvedValue(10000),
    getMp4VideoDimensions: fn().mockResolvedValue({
      width: 1920,
      height: 1080,
    }),
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
    pathExists: fn().mockResolvedValue(true),
    readdir: fn().mockResolvedValue(['test-image.png']),
    createDefaultSnakeGameInputState: fn().mockReturnValue({
      snakeGameState: {
        backgroundColor: '#000',
        cellGap: 2,
        boardBorderColor: '#fff',
        boardBorderWidth: 1,
        gridLineColor: '#333',
        gridLineAlpha: 0.5,
        cells: [],
      },
      snakeEventShaders: undefined,
      snake1Shaders: [],
      snake2Shaders: [],
      activeEffects: [],
      effectTimers: [],
      metadata: { title: 'Snake Game', description: '' },
    }),
    createHandsStore: fn().mockReturnValue({}),
    logTimelineEvent: fn(),
    placeholderManager: {
      removePlaceholder: fn().mockReturnValue(false),
      ensurePlaceholder: fn().mockResolvedValue(false),
      isPlaceholder: fn().mockReturnValue(false),
    },
    motionController: {
      startMotionDetection: fn().mockResolvedValue(undefined),
      stopMotionDetection: fn().mockResolvedValue(undefined),
      startHandTracking: fn().mockResolvedValue(undefined),
      stopHandTracking: fn(),
      emitMotionScores: fn(),
    },
    onStateChange: fn(),
  };
});

vi.mock('../../smelter', () => ({ SmelterInstance: mocks.smelter }));
vi.mock('../../streamlink', () => ({
  hlsUrlForTwitchChannel: vi.fn(
    async (id: string) => `http://hls/twitch/${id}`,
  ),
  hlsUrlForKickChannel: vi.fn(async (id: string) => `http://hls/kick/${id}`),
}));
vi.mock('../../twitch/TwitchChannelMonitor', () => ({
  TwitchChannelMonitor: { startMonitor: mocks.twitchStartMonitor },
}));
vi.mock('../../kick/KickChannelMonitor', () => ({
  KickChannelMonitor: { startMonitor: mocks.kickStartMonitor },
}));
vi.mock('../../whip/WhipInputMonitor', () => ({
  WhipInputMonitor: { startMonitor: mocks.whipStartMonitor },
}));
vi.mock('../../mp4/mp4SuggestionMonitor', () => ({
  default: { mp4Files: ['test-video.mp4'] },
}));
vi.mock('../../routing/mp4Duration', () => ({
  getMp4DurationMs: mocks.getMp4DurationMs,
  getMp4VideoDimensions: mocks.getMp4VideoDimensions,
}));
vi.mock('../../snakeGame/snakeGameState', () => ({
  createDefaultSnakeGameInputState: mocks.createDefaultSnakeGameInputState,
}));
vi.mock('../../hands/handStore', () => ({
  createHandsStore: mocks.createHandsStore,
}));
vi.mock('../../dashboard', () => ({
  logTimelineEvent: mocks.logTimelineEvent,
}));
vi.mock('fs-extra', () => ({
  pathExists: mocks.pathExists,
  readdir: mocks.readdir,
}));

const { InputManager } = await import('../InputManager');

type InputManagerInstance = InstanceType<typeof InputManager>;
let manager: InputManagerInstance;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.pathExists.mockResolvedValue(true);
  mocks.readdir.mockResolvedValue(['test-image.png']);
  mocks.placeholderManager.removePlaceholder.mockReturnValue(false);
  mocks.placeholderManager.ensurePlaceholder.mockResolvedValue(false);
  mocks.placeholderManager.isPlaceholder.mockReturnValue(false);
  manager = new InputManager(
    'room-1',
    mocks.placeholderManager as any,
    mocks.motionController as any,
    mocks.onStateChange,
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('InputManager', () => {
  describe('addNewInput', () => {
    describe('whip', () => {
      it('creates input with correct type and starts monitor', async () => {
        const inputId = await manager.addNewInput({
          type: 'whip',
          username: 'test-user',
        });
        expect(inputId).toContain('::whip::');
        expect(mocks.whipStartMonitor).toHaveBeenCalled();
        expect(manager.getInput(inputId!).type).toBe('whip');
      });

      it('cleans "[Camera]" prefix from username', async () => {
        const inputId = await manager.addNewInput({
          type: 'whip',
          username: '[Camera] Alice',
        });
        const input = manager.getInput(inputId!);
        expect(input.metadata.title).toBe('[Live] Camera');
        expect(input.metadata.description).toContain('Alice');
      });
    });

    describe('twitch-channel', () => {
      it('creates input with channelId-based ID', async () => {
        const inputId = await manager.addNewInput({
          type: 'twitch-channel',
          channelId: 'streamer1',
        });
        expect(inputId).toContain('streamer1');
        expect(mocks.twitchStartMonitor).toHaveBeenCalledWith('streamer1');
      });

      it('throws for duplicate channel', async () => {
        await manager.addNewInput({
          type: 'twitch-channel',
          channelId: 'streamer1',
        });
        await expect(
          manager.addNewInput({
            type: 'twitch-channel',
            channelId: 'streamer1',
          }),
        ).rejects.toThrow(/already exists/);
      });
    });

    describe('kick-channel', () => {
      it('creates input with channelId-based ID', async () => {
        const inputId = await manager.addNewInput({
          type: 'kick-channel',
          channelId: 'kicker1',
        });
        expect(inputId).toContain('kicker1');
        expect(mocks.kickStartMonitor).toHaveBeenCalledWith('kicker1');
      });
    });

    describe('hls', () => {
      it('creates input with URL-derived label', async () => {
        const inputId = await manager.addNewInput({
          type: 'hls',
          url: 'http://example.com/live/stream.m3u8',
        });
        const input = manager.getInput(inputId!);
        expect(input.type).toBe('hls');
        expect(input.metadata.title).toContain('HLS');
      });
    });

    describe('local-mp4', () => {
      it('throws when source.fileName is missing', async () => {
        await expect(
          manager.addNewInput({ type: 'local-mp4', source: {} as any }),
        ).rejects.toThrow(/source.fileName/);
      });

      it('throws when file does not exist', async () => {
        mocks.pathExists.mockResolvedValue(false);
        const inputId = await manager.addNewInput({
          type: 'local-mp4',
          source: { fileName: 'missing.mp4' },
        });
        const input = manager.getInput(inputId!);
        expect(input.type).toBe('local-mp4');
        expect(input.type === 'local-mp4' && input.mp4AssetMissing).toBe(true);
      });

      it('probes video dimensions', async () => {
        const inputId = await manager.addNewInput({
          type: 'local-mp4',
          source: { fileName: 'test-video.mp4' },
        });
        expect(mocks.getMp4VideoDimensions).toHaveBeenCalled();
        const input = manager.getInput(inputId!);
        expect(input.type === 'local-mp4' && input.mp4VideoWidth).toBe(1920);
      });
    });

    describe('image', () => {
      it('registers image with Smelter', async () => {
        const inputId = await manager.addNewInput({
          type: 'image',
          fileName: 'test-image.png',
        });
        expect(mocks.smelter.registerImage).toHaveBeenCalled();
        expect(manager.getInput(inputId!).type).toBe('image');
      });

      it('throws when file not found', async () => {
        mocks.pathExists.mockResolvedValue(false);
        const inputId = await manager.addNewInput({
          type: 'image',
          fileName: 'missing.png',
        });
        const input = manager.getInput(inputId!);
        expect(input.type).toBe('image');
        expect(input.type === 'image' && input.imageAssetMissing).toBe(true);
      });
    });

    describe('text-input', () => {
      it('applies default values for optional text properties', async () => {
        const inputId = await manager.addNewInput({
          type: 'text-input',
          text: 'Hello',
        } as any);
        const input = manager.getInput(inputId!);
        expect(input.type === 'text-input' && input.textAlign).toBe('left');
        expect(input.type === 'text-input' && input.textColor).toBe('#ffffff');
        expect(input.type === 'text-input' && input.textScrollEnabled).toBe(
          true,
        );
        expect(input.type === 'text-input' && input.textFontSize).toBe(80);
      });
    });

    describe('game', () => {
      it('delegates to createDefaultSnakeGameInputState', async () => {
        const inputId = await manager.addNewInput({
          type: 'game',
          title: 'My Game',
        } as any);
        expect(mocks.createDefaultSnakeGameInputState).toHaveBeenCalledWith(
          'My Game',
        );
        expect(manager.getInput(inputId!).type).toBe('game');
      });
    });

    describe('hands', () => {
      it('starts hand tracking via motionController', async () => {
        const inputId = await manager.addNewInput({
          type: 'hands',
          sourceInputId: 'source-1',
        } as any);
        expect(mocks.motionController.startHandTracking).toHaveBeenCalledWith(
          'source-1',
          expect.anything(),
        );
        expect(manager.getInput(inputId!).type).toBe('hands');
      });
    });
  });

  describe('removeInput', () => {
    it('filters input from array', async () => {
      const inputId = (await manager.addNewInput({
        type: 'text-input',
        text: 'hi',
      } as any))!;
      expect(manager.getInputs()).toHaveLength(1);
      await manager.removeInput(inputId);
      expect(manager.getInputs()).toHaveLength(0);
    });

    it('removes input from other inputs attachedInputIds', async () => {
      // Advance time between adds so Date.now() generates unique IDs
      const id1 = (await manager.addNewInput({
        type: 'text-input',
        text: 'a',
      } as any))!;
      vi.advanceTimersByTime(1);
      const id2 = (await manager.addNewInput({
        type: 'text-input',
        text: 'b',
      } as any))!;
      vi.advanceTimersByTime(1);
      (await manager.addNewInput({
        type: 'text-input',
        text: 'c',
      } as any))!;

      // Manually set attachedInputIds on id2 to reference id1
      manager.updateInput(id2, { attachedInputIds: [id1] });
      expect(manager.getInput(id2).attachedInputIds).toContain(id1);

      // Removing id1 should clean up the reference in id2
      await manager.removeInput(id1);
      expect(manager.getInputs()).toHaveLength(2);
      expect(manager.getInput(id2).attachedInputIds).not.toContain(id1);
    });

    it('stops monitor for twitch channels', async () => {
      const monitor = {
        isLive: () => true,
        stop: vi.fn(),
        onUpdate: vi.fn(),
      };
      mocks.twitchStartMonitor.mockResolvedValueOnce(monitor);
      const inputId = (await manager.addNewInput({
        type: 'twitch-channel',
        channelId: 'ch1',
      }))!;
      await manager.removeInput(inputId);
      expect(monitor.stop).toHaveBeenCalled();
    });

    it('ensures placeholder when removing last non-placeholder input', async () => {
      const inputId = (await manager.addNewInput({
        type: 'text-input',
        text: 'only',
      } as any))!;
      await manager.removeInput(inputId);
      expect(mocks.placeholderManager.ensurePlaceholder).toHaveBeenCalled();
    });
  });

  describe('connectInput', () => {
    it('registers video input with Smelter and sets status to connected', async () => {
      const inputId = (await manager.addNewInput({
        type: 'hls',
        url: 'http://example.com/stream.m3u8',
      }))!;
      expect(manager.getInput(inputId).status).toBe('disconnected');

      await manager.connectInput(inputId);

      expect(mocks.smelter.registerInput).toHaveBeenCalled();
      expect(manager.getInput(inputId).status).toBe('connected');
    });

    it('sets status to connected immediately for image/game/hands', async () => {
      const inputId = (await manager.addNewInput({
        type: 'game',
        title: 'game',
      } as any))!;
      // Game inputs start as connected
      expect(manager.getInput(inputId).status).toBe('connected');
    });

    it('no-op when already connected', async () => {
      const inputId = (await manager.addNewInput({
        type: 'text-input',
        text: 'x',
      } as any))!;
      // text-input starts as connected
      mocks.smelter.registerInput.mockClear();
      await manager.connectInput(inputId);
      expect(mocks.smelter.registerInput).not.toHaveBeenCalled();
    });
  });

  describe('disconnectInput', () => {
    it('unregisters from Smelter and sets status to disconnected', async () => {
      const inputId = (await manager.addNewInput({
        type: 'hls',
        url: 'http://example.com/stream.m3u8',
      }))!;
      await manager.connectInput(inputId);

      await manager.disconnectInput(inputId);

      expect(mocks.smelter.unregisterInput).toHaveBeenCalledWith(inputId);
      expect(manager.getInput(inputId).status).toBe('disconnected');
    });

    it('stops motion detection', async () => {
      const inputId = (await manager.addNewInput({
        type: 'hls',
        url: 'http://example.com/stream.m3u8',
      }))!;
      await manager.connectInput(inputId);
      await manager.disconnectInput(inputId);
      expect(mocks.motionController.stopMotionDetection).toHaveBeenCalledWith(
        inputId,
      );
    });

    it('no-op when already disconnected', async () => {
      const inputId = (await manager.addNewInput({
        type: 'hls',
        url: 'http://example.com/stream.m3u8',
      }))!;
      mocks.smelter.unregisterInput.mockClear();
      await manager.disconnectInput(inputId);
      expect(mocks.smelter.unregisterInput).not.toHaveBeenCalled();
    });
  });

  describe('updateInput', () => {
    it('updates metadata title', async () => {
      const inputId = (await manager.addNewInput({
        type: 'text-input',
        text: 'hi',
      } as any))!;
      manager.updateInput(inputId, { title: 'New Title' });
      expect(manager.getInput(inputId).metadata.title).toBe('New Title');
    });

    it('updates text-specific fields for text-input type', async () => {
      const inputId = (await manager.addNewInput({
        type: 'text-input',
        text: 'hi',
      } as any))!;
      manager.updateInput(inputId, {
        text: 'updated',
        textAlign: 'center',
        textScrollEnabled: false,
        textFontSize: 48,
      });
      const input = manager.getInput(inputId);
      expect(input.type === 'text-input' && input.text).toBe('updated');
      expect(input.type === 'text-input' && input.textAlign).toBe('center');
      expect(input.type === 'text-input' && input.textScrollEnabled).toBe(
        false,
      );
      expect(input.type === 'text-input' && input.textFontSize).toBe(48);
    });

    it('swaps native resolution on orientation change', async () => {
      const inputId = (await manager.addNewInput({
        type: 'whip',
        username: 'user',
      }))!;
      expect(manager.getInput(inputId).nativeWidth).toBe(1920);
      expect(manager.getInput(inputId).nativeHeight).toBe(1080);

      manager.updateInput(inputId, { orientation: 'vertical' });
      expect(manager.getInput(inputId).nativeWidth).toBe(1080);
      expect(manager.getInput(inputId).nativeHeight).toBe(1920);
    });

    it('sets up transition timer that clears activeTransition after durationMs', async () => {
      const inputId = (await manager.addNewInput({
        type: 'text-input',
        text: 'hi',
      } as any))!;
      manager.updateInput(inputId, {
        activeTransition: { type: 'fade', durationMs: 500, direction: 'in' },
      });
      expect(manager.getInput(inputId).activeTransition).toBeDefined();

      vi.advanceTimersByTime(501);
      expect(manager.getInput(inputId).activeTransition).toBeUndefined();
    });
  });

  describe('reorderInputs', () => {
    it('reorders inputs according to provided order', async () => {
      const id1 = (await manager.addNewInput({
        type: 'text-input',
        text: 'a',
      } as any))!;
      vi.advanceTimersByTime(1);
      const id2 = (await manager.addNewInput({
        type: 'text-input',
        text: 'b',
      } as any))!;
      vi.advanceTimersByTime(1);
      const id3 = (await manager.addNewInput({
        type: 'text-input',
        text: 'c',
      } as any))!;

      manager.reorderInputs([id3, id1, id2]);
      const ids = manager.getInputs().map((i) => i.inputId);
      expect(ids).toEqual([id3, id1, id2]);
    });

    it('appends inputs not in the order list at the end', async () => {
      const id1 = (await manager.addNewInput({
        type: 'text-input',
        text: 'a',
      } as any))!;
      vi.advanceTimersByTime(1);
      const id2 = (await manager.addNewInput({
        type: 'text-input',
        text: 'b',
      } as any))!;
      vi.advanceTimersByTime(1);
      const id3 = (await manager.addNewInput({
        type: 'text-input',
        text: 'c',
      } as any))!;

      manager.reorderInputs([id2]);
      const ids = manager.getInputs().map((i) => i.inputId);
      expect(ids[0]).toBe(id2);
      expect(ids).toContain(id1);
      expect(ids).toContain(id3);
    });
  });

  describe('hideInput / showInput', () => {
    it('sets hidden to true/false', async () => {
      const inputId = (await manager.addNewInput({
        type: 'text-input',
        text: 'hi',
      } as any))!;
      expect(manager.getInput(inputId).hidden).toBe(false);

      manager.hideInput(inputId);
      expect(manager.getInput(inputId).hidden).toBe(true);

      manager.showInput(inputId);
      expect(manager.getInput(inputId).hidden).toBe(false);
    });

    it('applies transition with timer when activeTransition provided', async () => {
      const inputId = (await manager.addNewInput({
        type: 'text-input',
        text: 'hi',
      } as any))!;

      manager.hideInput(inputId, {
        type: 'fade',
        durationMs: 300,
        direction: 'out',
      });

      // During transition, hidden is not yet set
      expect(manager.getInput(inputId).hidden).toBe(false);
      expect(manager.getInput(inputId).activeTransition).toBeDefined();

      // After timer fires, hidden becomes true and transition clears
      vi.advanceTimersByTime(301);
      expect(manager.getInput(inputId).hidden).toBe(true);
      expect(manager.getInput(inputId).activeTransition).toBeUndefined();
    });

    it('showInput sets hidden=false immediately even with transition', async () => {
      const inputId = (await manager.addNewInput({
        type: 'text-input',
        text: 'hi',
      } as any))!;
      manager.hideInput(inputId);

      manager.showInput(inputId, {
        type: 'fade',
        durationMs: 300,
        direction: 'in',
      });
      expect(manager.getInput(inputId).hidden).toBe(false);
      expect(manager.getInput(inputId).activeTransition).toBeDefined();

      vi.advanceTimersByTime(301);
      expect(manager.getInput(inputId).activeTransition).toBeUndefined();
    });
  });

  describe('restartMp4Input', () => {
    it('throws for non-mp4 input', async () => {
      const inputId = (await manager.addNewInput({
        type: 'text-input',
        text: 'hi',
      } as any))!;
      await expect(manager.restartMp4Input(inputId, 0, true)).rejects.toThrow(
        /not a local-mp4/,
      );
    });
  });
});
