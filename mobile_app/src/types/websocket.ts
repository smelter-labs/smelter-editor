import type { GridItem } from "./layout";
import type { InputCard } from "./input";

/**
 * Server -> client WS events.
 *
 * The Smelter server currently broadcasts a single event type over WebSocket:
 *   input_updated — sent whenever an input is mutated via the REST API.
 *
 * The payload is a flat JSON object (not wrapped in { type, payload }).
 */
export type WSEventMap = {
  input_updated: {
    type: "input_updated";
    roomId: string;
    inputId: string;
    input: Record<string, unknown>; // PublicInputState from server
    sourceId: string | null;
  };
  input_deleted: {
    type: "input_deleted";
    roomId: string;
    inputId: string;
    sourceId: string | null;
  };
  peers_updated: {
    type: "peers_updated";
    roomId: string;
    peers: Array<{
      clientId: string;
      name: string;
    }>;
  };
  connected: {
    type: "connected";
    clientId: string;
  };
  disconnected: {
    type: "disconnected";
    code: number;
    reason: string;
  };
};

export type WSEventKey = keyof WSEventMap;
export type WSEventPayload<K extends WSEventKey> = WSEventMap[K];
