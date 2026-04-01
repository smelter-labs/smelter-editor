import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RoomEvent } from '@smelter-editor/types';

type MessageCallback = (
  data: Buffer | string | ArrayBuffer | Buffer[],
  isBinary: boolean,
) => void;
type CloseCallback = () => void;

function createMockWebSocket(readyState = 1) {
  const listeners: Record<string, Array<(...args: any[]) => void>> = {};
  const ws = {
    readyState,
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn((event: string, listener: (...args: any[]) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(listener);
      return ws;
    }),
    _emit(event: string, ...args: any[]) {
      for (const cb of listeners[event] ?? []) {
        cb(...args);
      }
    },
  };
  return ws;
}

// Import the class, not the singleton — we need fresh instances per test
// The module exports `roomEventBus` as a singleton, so we re-create the class behavior
// by importing the module and constructing fresh instances via a workaround.
// Since RoomEventBus is not exported, we'll test through the singleton but reset between tests.
// Actually, the module only exports the singleton `roomEventBus`.
// We need to re-import it fresh each test, or just clear state manually.

let roomEventBus: any;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import('../roomEventBus');
  roomEventBus = mod.roomEventBus;
});

describe('RoomEventBus', () => {
  describe('subscribe', () => {
    it('sends a "connected" event with the clientId', () => {
      const ws = createMockWebSocket();
      roomEventBus.subscribe('room-1', 'client-1', ws);

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'connected', clientId: 'client-1' }),
      );
    });

    it('broadcasts peers_updated to all clients in the room', () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();

      roomEventBus.subscribe('room-1', 'client-1', ws1);
      roomEventBus.subscribe('room-1', 'client-2', ws2);

      // ws2 should have received peers_updated with both clients
      const calls = ws2.send.mock.calls.map((c: any) => JSON.parse(c[0]));
      const peersEvent = calls.find((c: any) => c.type === 'peers_updated');
      expect(peersEvent).toBeDefined();
      expect(peersEvent.peers).toHaveLength(2);
    });

    it('registers message and close listeners on the websocket', () => {
      const ws = createMockWebSocket();
      roomEventBus.subscribe('room-1', 'client-1', ws);

      const onCalls = ws.on.mock.calls.map((c: any) => c[0]);
      expect(onCalls).toContain('message');
      expect(onCalls).toContain('close');
    });
  });

  describe('identify messages', () => {
    it('updates peer name when a valid identify message is received', () => {
      const ws = createMockWebSocket();
      roomEventBus.subscribe('room-1', 'client-1', ws);

      ws._emit(
        'message',
        JSON.stringify({ type: 'identify', name: 'Alice' }),
        false,
      );

      const peers = roomEventBus.getConnectedPeers('room-1');
      expect(peers[0].name).toBe('Alice');
    });

    it('broadcasts updated peers after identify', () => {
      const ws = createMockWebSocket();
      roomEventBus.subscribe('room-1', 'client-1', ws);
      ws.send.mockClear();

      ws._emit(
        'message',
        JSON.stringify({ type: 'identify', name: 'Bob' }),
        false,
      );

      const lastCall = ws.send.mock.calls.at(-1);
      if (!lastCall) {
        throw new Error('Expected peers_updated event to be sent');
      }
      const event = JSON.parse(lastCall[0]);
      expect(event.type).toBe('peers_updated');
      expect(event.peers[0].name).toBe('Bob');
    });

    it('ignores malformed JSON messages', () => {
      const ws = createMockWebSocket();
      roomEventBus.subscribe('room-1', 'client-1', ws);
      ws.send.mockClear();

      // Should not throw
      ws._emit('message', 'not valid json{{{', false);

      // No peers_updated broadcast after malformed message
      expect(ws.send).not.toHaveBeenCalled();
    });

    it('ignores messages with type !== "identify"', () => {
      const ws = createMockWebSocket();
      roomEventBus.subscribe('room-1', 'client-1', ws);
      ws.send.mockClear();

      ws._emit(
        'message',
        JSON.stringify({ type: 'something_else', data: 'test' }),
        false,
      );

      expect(ws.send).not.toHaveBeenCalled();
    });

    it('sets name to null when identify name is not a string', () => {
      const ws = createMockWebSocket();
      roomEventBus.subscribe('room-1', 'client-1', ws);

      ws._emit(
        'message',
        JSON.stringify({ type: 'identify', name: 42 }),
        false,
      );

      const peers = roomEventBus.getConnectedPeers('room-1');
      expect(peers[0].name).toBeNull();
    });
  });

  describe('close handling', () => {
    it('removes client from pool on ws close', () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();
      roomEventBus.subscribe('room-1', 'client-1', ws1);
      roomEventBus.subscribe('room-1', 'client-2', ws2);

      ws1._emit('close');

      expect(roomEventBus.getConnectionCount('room-1')).toBe(1);
      const peers = roomEventBus.getConnectedPeers('room-1');
      expect(peers).toHaveLength(1);
      expect(peers[0].clientId).toBe('client-2');
    });

    it('deletes the room entry when last client disconnects', () => {
      const ws = createMockWebSocket();
      roomEventBus.subscribe('room-1', 'client-1', ws);

      ws._emit('close');

      expect(roomEventBus.getConnectionCount('room-1')).toBe(0);
      expect(roomEventBus.getConnectedPeers('room-1')).toEqual([]);
    });

    it('broadcasts peers_updated to remaining clients after close', () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();
      roomEventBus.subscribe('room-1', 'client-1', ws1);
      roomEventBus.subscribe('room-1', 'client-2', ws2);
      ws2.send.mockClear();

      ws1._emit('close');

      const lastCall = ws2.send.mock.calls.at(-1);
      if (!lastCall) {
        throw new Error('Expected peers_updated event after client close');
      }
      const event = JSON.parse(lastCall[0]);
      expect(event.type).toBe('peers_updated');
      expect(event.peers).toHaveLength(1);
      expect(event.peers[0].clientId).toBe('client-2');
    });
  });

  describe('broadcast', () => {
    it('sends JSON payload to all clients with readyState=1', () => {
      const ws1 = createMockWebSocket(1);
      const ws2 = createMockWebSocket(1);
      roomEventBus.subscribe('room-1', 'client-1', ws1);
      roomEventBus.subscribe('room-1', 'client-2', ws2);
      ws1.send.mockClear();
      ws2.send.mockClear();

      const event: RoomEvent = {
        type: 'input_deleted',
        roomId: 'room-1',
        inputId: 'inp-1',
        sourceId: null,
      };
      roomEventBus.broadcast('room-1', event);

      expect(ws1.send).toHaveBeenCalledWith(JSON.stringify(event));
      expect(ws2.send).toHaveBeenCalledWith(JSON.stringify(event));
    });

    it('skips clients with readyState !== 1', () => {
      const wsOpen = createMockWebSocket(1);
      const wsClosed = createMockWebSocket(3);
      roomEventBus.subscribe('room-1', 'client-1', wsOpen);
      roomEventBus.subscribe('room-1', 'client-2', wsClosed);
      wsOpen.send.mockClear();
      wsClosed.send.mockClear();

      const event: RoomEvent = {
        type: 'input_deleted',
        roomId: 'room-1',
        inputId: 'inp-1',
        sourceId: null,
      };
      roomEventBus.broadcast('room-1', event);

      expect(wsOpen.send).toHaveBeenCalledTimes(1);
      expect(wsClosed.send).not.toHaveBeenCalled();
    });

    it('does nothing for unknown roomId', () => {
      // Should not throw
      roomEventBus.broadcast('unknown-room', {
        type: 'input_deleted',
        roomId: 'unknown-room',
        inputId: 'x',
        sourceId: null,
      });
    });
  });

  describe('closeRoom', () => {
    it('calls ws.close(1001, "Room deleted") on all clients', () => {
      const ws1 = createMockWebSocket();
      const ws2 = createMockWebSocket();
      roomEventBus.subscribe('room-1', 'client-1', ws1);
      roomEventBus.subscribe('room-1', 'client-2', ws2);

      roomEventBus.closeRoom('room-1');

      expect(ws1.close).toHaveBeenCalledWith(1001, 'Room deleted');
      expect(ws2.close).toHaveBeenCalledWith(1001, 'Room deleted');
    });

    it('removes the room from connections map', () => {
      const ws = createMockWebSocket();
      roomEventBus.subscribe('room-1', 'client-1', ws);

      roomEventBus.closeRoom('room-1');

      expect(roomEventBus.getConnectionCount('room-1')).toBe(0);
    });

    it('does nothing for unknown roomId', () => {
      // Should not throw
      roomEventBus.closeRoom('nonexistent');
    });
  });

  describe('getConnectionCount', () => {
    it('returns 0 for unknown room', () => {
      expect(roomEventBus.getConnectionCount('nonexistent')).toBe(0);
    });

    it('returns correct count after subscribes', () => {
      roomEventBus.subscribe('room-1', 'c1', createMockWebSocket());
      roomEventBus.subscribe('room-1', 'c2', createMockWebSocket());
      expect(roomEventBus.getConnectionCount('room-1')).toBe(2);
    });
  });

  describe('getConnectedPeers', () => {
    it('returns empty array for unknown room', () => {
      expect(roomEventBus.getConnectedPeers('nonexistent')).toEqual([]);
    });

    it('reflects full subscribe/identify/close lifecycle', () => {
      const ws = createMockWebSocket();
      roomEventBus.subscribe('room-1', 'client-1', ws);

      let peers = roomEventBus.getConnectedPeers('room-1');
      expect(peers).toEqual([{ clientId: 'client-1', name: null }]);

      ws._emit(
        'message',
        JSON.stringify({ type: 'identify', name: 'Alice' }),
        false,
      );

      peers = roomEventBus.getConnectedPeers('room-1');
      expect(peers).toEqual([{ clientId: 'client-1', name: 'Alice' }]);

      ws._emit('close');

      peers = roomEventBus.getConnectedPeers('room-1');
      expect(peers).toEqual([]);
    });
  });
});
