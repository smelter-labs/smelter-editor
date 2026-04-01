import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  afterEach,
} from 'vitest';

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
  TwitchChannelSuggestions: {
    getTopStreams: vi.fn(() => []),
    monitor: vi.fn(),
    stop: vi.fn(),
  },
}));
vi.mock('../kick/KickChannelMonitor', () => ({
  KickChannelMonitor: { startMonitor: mocks.kickStartMonitor },
  KickChannelSuggestions: {
    getTopStreams: vi.fn(() => []),
    monitor: vi.fn(),
    stop: vi.fn(),
  },
}));
vi.mock('../whip/WhipInputMonitor', () => ({
  WhipInputMonitor: { startMonitor: mocks.whipStartMonitor },
}));
vi.mock('../dashboard', () => ({
  logRequest: vi.fn(),
  addLogListener: vi.fn(() => () => {}),
  getLogBuffer: vi.fn(() => []),
}));
vi.mock('../snakeGame/snakeGameRoutes', () => ({
  registerSnakeGameRoutes: vi.fn(),
  clearSnakeGameRoomInactivityTimer: vi.fn(),
}));
vi.mock('../timeline/timelineRoutes', () => ({
  registerTimelineRoutes: vi.fn(),
}));
vi.mock('../mp4/mp4SuggestionMonitor', () => ({
  default: { mp4Files: [] },
}));
vi.mock('../pictures/pictureSuggestionMonitor', () => ({
  default: { pictureFiles: [] },
}));
vi.mock('../shaders/shaders', () => ({
  default: { shaders: [] },
}));

import { createRoomStore } from '../app/store';
import { RESOLUTION_PRESETS } from '../types';

mocks.smelter.registerOutput.mockImplementation((async (
  roomId: string,
  resolution?: { width: number; height: number },
) => {
  const res = resolution ?? RESOLUTION_PRESETS['1440p'];
  return {
    id: roomId,
    url: `http://test-whep/${roomId}`,
    store: createRoomStore(res),
    resolution: res,
  };
}) as any);

const { routes } = await import('../routing/routes');
const { state } = await import('../core/serverState');
const { roomEventBus } = await import('../core/roomEventBus');

type MessageHandler = (
  data: Buffer | string | ArrayBuffer | Buffer[],
  isBinary: boolean,
) => void;
type CloseHandler = () => void;

function createMockWebSocket(readyState = 1) {
  const handlers: {
    message?: MessageHandler;
    close?: CloseHandler;
  } = {};

  const ws = {
    readyState,
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn((event: string, listener: unknown) => {
      if (event === 'message') {
        handlers.message = listener as MessageHandler;
      }
      if (event === 'close') {
        handlers.close = listener as CloseHandler;
      }
      return ws;
    }),
    _emitMessage(payload: unknown) {
      handlers.message?.(JSON.stringify(payload), false);
    },
    _emitClose() {
      handlers.close?.();
    },
  };

  return ws;
}

async function cleanupRooms() {
  const rooms = state.getRooms();
  for (const room of rooms) {
    await state.deleteRoom(room.idPrefix).catch(() => {});
  }
}

function parseSentEvents(ws: ReturnType<typeof createMockWebSocket>) {
  return ws.send.mock.calls
    .map((call: unknown[]) => {
      const payload = call[0];
      if (typeof payload !== 'string') {
        return null;
      }
      try {
        return JSON.parse(payload);
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Array<Record<string, any>>;
}

beforeAll(async () => {
  await routes.ready();
});

afterEach(async () => {
  await cleanupRooms();
});

afterAll(async () => {
  await cleanupRooms();
  await routes.close();
  state.stopMonitoring();
});

describe('Room lifecycle e2e (HTTP + WS broadcast)', () => {
  it('handles room join, input/layer changes, input reordering and input removal', async () => {
    const createRoomRes = await routes.inject({
      method: 'POST',
      url: '/room',
      payload: { skipDefaultInputs: true },
    });

    expect(createRoomRes.statusCode).toBe(200);
    const { roomId } = createRoomRes.json() as { roomId: string };
    expect(roomId).toBeTruthy();

    const ws1 = createMockWebSocket();
    const ws2 = createMockWebSocket();

    roomEventBus.subscribe(roomId, 'client-1', ws1 as any);
    roomEventBus.subscribe(roomId, 'client-2', ws2 as any);

    const ws1EventsAfterJoin = parseSentEvents(ws1);
    const hasTwoPeerBroadcast = ws1EventsAfterJoin.some(
      (event) =>
        event.type === 'peers_updated' &&
        event.roomId === roomId &&
        Array.isArray(event.peers) &&
        event.peers.length === 2,
    );

    expect(hasTwoPeerBroadcast).toBe(true);

    const addInput1Res = await routes.inject({
      method: 'POST',
      url: `/room/${roomId}/input`,
      payload: { type: 'text-input', text: 'First input' },
    });
    expect(addInput1Res.statusCode).toBe(200);
    const inputId1 = (addInput1Res.json() as { inputId: string }).inputId;

    const addInput2Res = await routes.inject({
      method: 'POST',
      url: `/room/${roomId}/input`,
      payload: { type: 'game', title: 'Second input' },
    });
    expect(addInput2Res.statusCode).toBe(200);
    const inputId2 = (addInput2Res.json() as { inputId: string }).inputId;

    expect(inputId1).toBeTruthy();
    expect(inputId2).toBeTruthy();

    const layer1Base = {
      id: 'layer-1',
      behavior: { type: 'equal-grid', autoscale: true },
      inputs: [
        { inputId: inputId1, x: 0, y: 0, width: 0, height: 0 },
        { inputId: inputId2, x: 0, y: 0, width: 0, height: 0 },
      ],
    };
    const layer2Empty = { id: 'layer-2', inputs: [] as any[] };

    const setBehaviorRes = await routes.inject({
      method: 'POST',
      url: `/room/${roomId}`,
      payload: { layers: [layer1Base, layer2Empty] },
    });
    expect(setBehaviorRes.statusCode).toBe(200);

    const moveInputToLayer2Res = await routes.inject({
      method: 'POST',
      url: `/room/${roomId}`,
      payload: {
        layers: [
          {
            ...layer1Base,
            inputs: [{ inputId: inputId1, x: 0, y: 0, width: 0, height: 0 }],
          },
          {
            id: 'layer-2',
            inputs: [{ inputId: inputId2, x: 0, y: 0, width: 0, height: 0 }],
          },
        ],
      },
    });
    expect(moveInputToLayer2Res.statusCode).toBe(200);

    const switchLayerOrderRes = await routes.inject({
      method: 'POST',
      url: `/room/${roomId}`,
      payload: {
        layers: [
          {
            id: 'layer-2',
            inputs: [{ inputId: inputId2, x: 0, y: 0, width: 0, height: 0 }],
          },
          {
            ...layer1Base,
            inputs: [{ inputId: inputId1, x: 0, y: 0, width: 0, height: 0 }],
          },
        ],
      },
    });
    expect(switchLayerOrderRes.statusCode).toBe(200);

    const addInput3Res = await routes.inject({
      method: 'POST',
      url: `/room/${roomId}/input`,
      payload: { type: 'text-input', text: 'Third input' },
    });
    expect(addInput3Res.statusCode).toBe(200);
    const inputId3 = (addInput3Res.json() as { inputId: string }).inputId;

    const addThirdToLayer1Res = await routes.inject({
      method: 'POST',
      url: `/room/${roomId}`,
      payload: {
        layers: [
          {
            id: 'layer-2',
            inputs: [{ inputId: inputId2, x: 0, y: 0, width: 0, height: 0 }],
          },
          {
            ...layer1Base,
            inputs: [
              { inputId: inputId1, x: 0, y: 0, width: 0, height: 0 },
              { inputId: inputId3, x: 0, y: 0, width: 0, height: 0 },
            ],
          },
        ],
      },
    });
    expect(addThirdToLayer1Res.statusCode).toBe(200);

    const reorderInputsInLayer1Res = await routes.inject({
      method: 'POST',
      url: `/room/${roomId}`,
      payload: {
        layers: [
          {
            id: 'layer-2',
            inputs: [{ inputId: inputId2, x: 0, y: 0, width: 0, height: 0 }],
          },
          {
            ...layer1Base,
            inputs: [
              { inputId: inputId3, x: 0, y: 0, width: 0, height: 0 },
              { inputId: inputId1, x: 0, y: 0, width: 0, height: 0 },
            ],
          },
        ],
      },
    });
    expect(reorderInputsInLayer1Res.statusCode).toBe(200);

    const deleteInput1Res = await routes.inject({
      method: 'DELETE',
      url: `/room/${roomId}/input/${inputId1}`,
    });
    const deleteInput2Res = await routes.inject({
      method: 'DELETE',
      url: `/room/${roomId}/input/${inputId2}`,
    });
    const deleteInput3Res = await routes.inject({
      method: 'DELETE',
      url: `/room/${roomId}/input/${inputId3}`,
    });

    expect(deleteInput1Res.statusCode).toBe(200);
    expect(deleteInput2Res.statusCode).toBe(200);
    expect(deleteInput3Res.statusCode).toBe(200);

    const roomStateRes = await routes.inject({
      method: 'GET',
      url: `/room/${roomId}`,
    });
    expect(roomStateRes.statusCode).toBe(200);

    const roomState = roomStateRes.json() as {
      inputs: Array<{ inputId: string }>;
      layers: Array<{ id: string; inputs: Array<{ inputId: string }> }>;
    };

    expect(roomState.inputs).toHaveLength(0);

    const wsEvents = parseSentEvents(ws1);
    const roomUpdatedEvents = wsEvents.filter(
      (event) => event.type === 'room_updated' && event.roomId === roomId,
    );
    const inputDeletedEvents = wsEvents.filter(
      (event) => event.type === 'input_deleted' && event.roomId === roomId,
    );

    expect(roomUpdatedEvents.length).toBeGreaterThanOrEqual(8);
    expect(inputDeletedEvents.map((event) => event.inputId)).toEqual([
      inputId1,
      inputId2,
      inputId3,
    ]);

    ws1._emitClose();
    ws2._emitClose();
  });
});
