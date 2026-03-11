import type { PublicInputState } from "./publicInputState";

// pnpm wants node modules imports, fastify ws's use "export =".
interface RoomWebSocket {
  readonly readyState: number;
  send(data: string | Buffer): void;
  close(code?: number, reason?: string | Buffer): void;
  on(event: "close", listener: () => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

export type InputUpdatedEvent = {
  type: "input_updated";
  roomId: string;
  inputId: string;
  // full updated state of the input after the change
  input: PublicInputState;
  // value of `x-source-id` header from the request that triggered this update, if any
  sourceId: string | null;
};

export type RoomEvent = InputUpdatedEvent;

class RoomEventBus {
  private readonly connections = new Map<string, Set<RoomWebSocket>>();

  // register `ws` as a subscriber to events for `roomId`
  subscribe(roomId: string, ws: RoomWebSocket): void {
    if (!this.connections.has(roomId)) {
      this.connections.set(roomId, new Set());
    }
    const pool = this.connections.get(roomId)!;
    pool.add(ws);

    ws.on("close", () => {
      pool.delete(ws);
      if (pool.size === 0) {
        this.connections.delete(roomId);
      }
    });
  }

  // send `event` to all subscribers of `roomId`
  broadcast(roomId: string, event: RoomEvent): void {
    const clients = this.connections.get(roomId);
    if (!clients || clients.size === 0) return;

    const payload = JSON.stringify(event);
    for (const ws of clients) {
      // 1 === WebSocket.OPEN
      if (ws.readyState === 1) {
        ws.send(payload);
      }
    }
  }

  // force-close all connections for `roomId` (e.g. when the room is deleted)
  closeRoom(roomId: string): void {
    const clients = this.connections.get(roomId);
    if (!clients) return;
    for (const ws of clients) {
      ws.close(1001, "Room deleted");
    }
    this.connections.delete(roomId);
  }

  getConnectionCount(roomId: string): number {
    return this.connections.get(roomId)?.size ?? 0;
  }
}

export const roomEventBus = new RoomEventBus();
