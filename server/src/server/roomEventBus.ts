import type { PublicInputState } from "./publicInputState";

// pnpm wants node modules imports, fastify ws's use "export =".
interface RoomWebSocket {
  readonly readyState: number;
  send(data: string | Buffer): void;
  close(code?: number, reason?: string | Buffer): void;
  on(event: "close", listener: () => void): this;
  on(event: "message", listener: (data: Buffer) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

export type ConnectedPeer = {
  clientId: string;
  name: string | null;
};

export type InputUpdatedEvent = {
  type: "input_updated";
  roomId: string;
  inputId: string;
  // full updated state of the input after the change
  input: PublicInputState;
  // value of `x-source-id` header from the request that triggered this update, if any
  sourceId: string | null;
};

export type InputDeletedEvent = {
  type: "input_deleted";
  roomId: string;
  inputId: string;
  // value of `x-source-id` header from the request that triggered this deletion, if any
  sourceId: string | null;
};

export type PeersUpdatedEvent = {
  type: "peers_updated";
  roomId: string;
  peers: ConnectedPeer[];
};

export type ConnectedEvent = {
  type: "connected";
  clientId: string;
};

export type RoomEvent =
  | InputUpdatedEvent
  | InputDeletedEvent
  | PeersUpdatedEvent;

interface ClientRecord {
  ws: RoomWebSocket;
  info: ConnectedPeer;
}

class RoomEventBus {
  private readonly connections = new Map<string, Map<string, ClientRecord>>();

  // register `ws` as a subscriber to events for `roomId`, returns the assigned clientId
  subscribe(roomId: string, clientId: string, ws: RoomWebSocket): void {
    if (!this.connections.has(roomId)) {
      this.connections.set(roomId, new Map());
    }
    const pool = this.connections.get(roomId)!;
    pool.set(clientId, { ws, info: { clientId, name: null } });

    // Announce connection to the client itself
    const connectedMsg: ConnectedEvent = { type: "connected", clientId };
    ws.send(JSON.stringify(connectedMsg));

    // Broadcast updated peer list to everyone in the room
    this._broadcastPeers(roomId);

    // Listen for identify / other client→server messages
    ws.on("message", (data: Buffer) => {
      let msg: unknown;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (
        msg &&
        typeof msg === "object" &&
        (msg as Record<string, unknown>).type === "identify"
      ) {
        const name = (msg as Record<string, unknown>).name;
        const record = pool.get(clientId);
        if (record) {
          record.info.name = typeof name === "string" ? name : null;
          this._broadcastPeers(roomId);
        }
      }
    });

    ws.on("close", () => {
      pool.delete(clientId);
      if (pool.size === 0) {
        this.connections.delete(roomId);
      } else {
        this._broadcastPeers(roomId);
      }
    });
  }

  // send `event` to all subscribers of `roomId`
  broadcast(roomId: string, event: RoomEvent): void {
    const clients = this.connections.get(roomId);
    if (!clients || clients.size === 0) return;

    const payload = JSON.stringify(event);
    for (const { ws } of clients.values()) {
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
    for (const { ws } of clients.values()) {
      ws.close(1001, "Room deleted");
    }
    this.connections.delete(roomId);
  }

  getConnectionCount(roomId: string): number {
    return this.connections.get(roomId)?.size ?? 0;
  }

  getConnectedPeers(roomId: string): ConnectedPeer[] {
    const clients = this.connections.get(roomId);
    if (!clients) return [];
    return [...clients.values()].map((r) => r.info);
  }

  private _broadcastPeers(roomId: string): void {
    const peers = this.getConnectedPeers(roomId);
    this.broadcast(roomId, { type: "peers_updated", roomId, peers });
  }
}

export const roomEventBus = new RoomEventBus();
