import type { PublicInputState } from "./public-input-state.js";
import type { Layer } from "./layout.js";

export type ConnectedPeer = {
  clientId: string;
  name: string | null;
};

export type InputUpdatedEvent = {
  type: "input_updated";
  roomId: string;
  inputId: string;
  /** Full updated state of the input after the change. */
  input: PublicInputState;
  /** Value of `x-source-id` header from the triggering request, if any. */
  sourceId: string | null;
};

export type InputDeletedEvent = {
  type: "input_deleted";
  roomId: string;
  inputId: string;
  /** Value of `x-source-id` header from the triggering request, if any. */
  sourceId: string | null;
};

export type RoomUpdatedEvent = {
  type: "room_updated";
  roomId: string;
  /** Value of `x-source-id` header from the triggering request, if any. */
  sourceId: string | null;
  /** Current layers after the mutation — allows clients to apply state without an extra round-trip. */
  layers: Layer[];
  /** Current inputs after the mutation — allows clients to apply state without an extra round-trip. */
  inputs: PublicInputState[];
  /** Whether timeline playback is currently active in this room. */
  isTimelinePlaying?: boolean;
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
  | RoomUpdatedEvent
  | PeersUpdatedEvent;
