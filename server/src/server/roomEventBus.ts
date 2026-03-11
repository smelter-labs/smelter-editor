import type { SocketStream } from "@fastify/websocket";
import type { PublicInputState } from "./publicInputState";

export type InputUpdatedEvent = {
  type: "input_updated";
  roomId: string;
  inputId: string;
  // full (or partial) updated state of the input after the change that triggered this event, if i understand correctly
  input: PublicInputState;
  // value of `x-source-id` header from the request that triggered this update, if any
  sourceId: string | null;
};

export type RoomEvent = InputUpdatedEvent;

class RoomEventBus {
  private readonly connections = new Map<string, Set<SocketStream>>();

  // register `ws` as a subscriber to events for `roomId`
  subscribe(roomId: string, ws: SocketStream): void {
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
      if (ws.socket.readyState === 1) {
        ws.socket.send(payload);
      }
    }
  }

  // force-close all ws
  closeRoom(roomId: string): void {
    const clients = this.connections.get(roomId);
    if (!clients) return;
    for (const ws of clients) {
      ws.socket.close(1001, "Room deleted");
    }
    this.connections.delete(roomId);
  }

  getConnectionCount(roomId: string): number {
    return this.connections.get(roomId)?.size ?? 0;
  }
}

export const roomEventBus = new RoomEventBus();
