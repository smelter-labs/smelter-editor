import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

// Wire up registerOutput to return a proper SmelterOutput
mocks.smelter.registerOutput.mockImplementation(
  async (roomId: string, resolution?: { width: number; height: number }) => {
    const res = resolution ?? RESOLUTION_PRESETS['1440p'];
    return {
      id: roomId,
      url: `http://test-whep/${roomId}`,
      store: createRoomStore(res),
      resolution: res,
    };
  },
);

const { ServerState } = await import('../server/serverState');

type ServerStateInstance = InstanceType<typeof ServerState>;
let state: ServerStateInstance;

beforeEach(() => {
  vi.clearAllMocks();
  // Re-apply default implementation after clearAllMocks
  mocks.smelter.registerOutput.mockImplementation(
    async (roomId: string, resolution?: { width: number; height: number }) => {
      const res = resolution ?? RESOLUTION_PRESETS['1440p'];
      return {
        id: roomId,
        url: `http://test-whep/${roomId}`,
        store: createRoomStore(res),
        resolution: res,
      };
    },
  );
  mocks.pathExists.mockResolvedValue(false);
  mocks.ensureDir.mockResolvedValue(undefined);
  mocks.readdir.mockResolvedValue([]);
  state = new ServerState();
});

afterEach(() => {
  state.stopMonitoring();
});

describe('ServerState', () => {
  describe('createRoom', () => {
    it('creates a room and returns roomId, roomName, and room', async () => {
      const result = await state.createRoom([], true);

      expect(result.roomId).toBeDefined();
      expect(typeof result.roomId).toBe('string');
      expect(result.roomName).toBeDefined();
      expect(result.roomName.pl).toBeDefined();
      expect(result.roomName.en).toBeDefined();
      expect(result.room).toBeDefined();
      expect(mocks.smelter.registerOutput).toHaveBeenCalledOnce();
    });

    it('creates rooms with unique IDs', async () => {
      const r1 = await state.createRoom([], true);
      const r2 = await state.createRoom([], true);
      expect(r1.roomId).not.toBe(r2.roomId);
    });

    it('creates rooms with unique names', async () => {
      const r1 = await state.createRoom([], true);
      const r2 = await state.createRoom([], true);
      expect(r1.roomName.pl).not.toBe(r2.roomName.pl);
    });

    it('uses provided resolution', async () => {
      const resolution = { width: 1920, height: 1080 };
      await state.createRoom([], true, resolution);
      expect(mocks.smelter.registerOutput).toHaveBeenCalledWith(
        expect.any(String),
        resolution,
      );
    });
  });

  describe('getRoom', () => {
    it('returns the room by ID', async () => {
      const { roomId, room } = await state.createRoom([], true);
      expect(state.getRoom(roomId)).toBe(room);
    });

    it('throws for unknown roomId', () => {
      expect(() => state.getRoom('nonexistent')).toThrow(/does not exist/);
    });
  });

  describe('getRooms', () => {
    it('returns empty array initially', () => {
      expect(state.getRooms()).toEqual([]);
    });

    it('returns all created rooms', async () => {
      await state.createRoom([], true);
      await state.createRoom([], true);
      expect(state.getRooms()).toHaveLength(2);
    });
  });

  describe('deleteRoom', () => {
    it('deletes an existing room', async () => {
      const { roomId } = await state.createRoom([], true);
      expect(state.getRooms()).toHaveLength(1);
      await state.deleteRoom(roomId);
      expect(state.getRooms()).toHaveLength(0);
    });

    it('throws for unknown roomId', async () => {
      await expect(state.deleteRoom('nonexistent')).rejects.toThrow(
        /does not exist/,
      );
    });
  });

  describe('isChannelIdUsed', () => {
    it('returns false when no rooms exist', () => {
      expect(state.isChannelIdUsed('some-channel')).toBe(false);
    });
  });
});
