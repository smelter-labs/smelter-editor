import type { PublicInputState } from './public-input-state.js';

export type ConnectedPeer = {
  clientId: string;
  name: string | null;
};

export type ConnectedEvent = {
  type: 'connected';
  clientId: string;
};

export type InputUpdatedEvent = {
  type: 'input_updated';
  roomId: string;
  inputId: string;
  input: PublicInputState;
  sourceId: string | null;
};

export type InputDeletedEvent = {
  type: 'input_deleted';
  roomId: string;
  inputId: string;
  sourceId: string | null;
};

export type PeersUpdatedEvent = {
  type: 'peers_updated';
  roomId: string;
  peers: ConnectedPeer[];
};

export type RoomEvent =
  | InputUpdatedEvent
  | InputDeletedEvent
  | PeersUpdatedEvent;
