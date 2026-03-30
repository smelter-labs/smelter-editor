import type { PublicInputState } from './public-input-state.js';

export type ConnectedPeer = {
  clientId: string;
  name: string | null;
};

export type InputUpdatedEvent = {
  type: 'input_updated';
  roomId: string;
  inputId: string;
  /** Full updated state of the input after the change. */
  input: PublicInputState;
  /** Value of `x-source-id` header from the triggering request, if any. */
  sourceId: string | null;
};

export type InputDeletedEvent = {
  type: 'input_deleted';
  roomId: string;
  inputId: string;
  /** Value of `x-source-id` header from the triggering request, if any. */
  sourceId: string | null;
};

export type RoomUpdatedEvent = {
  type: 'room_updated';
  roomId: string;
  /** Value of `x-source-id` header from the triggering request, if any. */
  sourceId: string | null;
};

export type PeersUpdatedEvent = {
  type: 'peers_updated';
  roomId: string;
  peers: ConnectedPeer[];
};

export type ConnectedEvent = {
  type: 'connected';
  clientId: string;
};

export type RoomEvent =
  | InputUpdatedEvent
  | InputDeletedEvent
  | RoomUpdatedEvent
  | PeersUpdatedEvent;
