import type { InputCard } from "./input";
import type { Layer } from "./layout";
import type { PublicInputState } from "./room";

/**
 * Server -> client WS events.
 *
 * The Smelter server broadcasts flat JSON events over WebSocket for room/input
 * state changes and presence updates.
 * Current server events are:
 *   input_updated, input_deleted, room_updated, peers_updated, connected.
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
  room_updated: {
    type: "room_updated";
    roomId: string;
    sourceId: string | null;
    /** Authoritative layers after the mutation — apply directly, no extra fetch needed. */
    layers: Layer[];
    /** Authoritative inputs after the mutation — apply directly, no extra fetch needed. */
    inputs: PublicInputState[];
    /** Whether timeline playback is currently running in this room. */
    isTimelinePlaying?: boolean;
  };
  timeline_playback_updated: {
    type: "timeline_playback_updated";
    roomId: string;
    isTimelinePlaying: boolean;
    isPaused?: boolean;
    playheadMs?: number;
    totalDurationMs?: number;
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
