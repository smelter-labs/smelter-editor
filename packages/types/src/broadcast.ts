export type BroadcastTile = {
  id: string; // UUID
  type: 'input' | 'layer';
  targetId: string; // The input ID or layer ID
  name: string; // Display name (synced from input/layer)
};

// WebSocket event types sent from client to server
export type BroadcastTileAddRequest = {
  type: 'add-broadcast-tile';
  tileType: 'input' | 'layer';
  targetId: string;
};

export type BroadcastTileRemoveRequest = {
  type: 'remove-broadcast-tile';
  tileId: string;
};

export type BroadcastTileSelectRequest = {
  type: 'select-broadcast-tile';
  tileId: string | null;
};

export type BroadcastClientRequest =
  | BroadcastTileAddRequest
  | BroadcastTileRemoveRequest
  | BroadcastTileSelectRequest;

// WebSocket event types sent from server to all clients
export type BroadcastTileAddedEvent = {
  type: 'broadcast-tile-added';
  tile: BroadcastTile;
};

export type BroadcastTileRemovedEvent = {
  type: 'broadcast-tile-removed';
  tileId: string;
};

export type BroadcastTileSelectedEvent = {
  type: 'broadcast-tile-selected';
  tileId: string | null;
};

export type BroadcastTilesUpdatedEvent = {
  type: 'broadcast-tiles-updated';
  tiles: BroadcastTile[];
  selectedTileId: string | null;
};

export type BroadcastServerEvent =
  | BroadcastTileAddedEvent
  | BroadcastTileRemovedEvent
  | BroadcastTileSelectedEvent
  | BroadcastTilesUpdatedEvent;
