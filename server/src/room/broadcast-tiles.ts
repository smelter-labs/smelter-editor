import { randomUUID } from 'crypto';
import type { BroadcastTile, BroadcastServerEvent } from '../types';
import type { RoomState } from './RoomState';
import type { RoomSnapshot } from './types';

export function initializeBroadcastTiles(snapshot: RoomSnapshot): void {
  if (!snapshot.broadcastTiles) {
    snapshot.broadcastTiles = [];
  }
  if (snapshot.selectedBroadcastTileId === undefined) {
    snapshot.selectedBroadcastTileId = null;
  }
}

export function addBroadcastTile(
  snapshot: RoomSnapshot,
  type: 'input' | 'layer',
  targetId: string,
): BroadcastServerEvent | null {
  // Validate that the target exists
  if (type === 'input') {
    const inputExists = snapshot.inputs.some((i) => i.inputId === targetId);
    if (!inputExists) {
      return null;
    }
  } else if (type === 'layer') {
    const layerExists = snapshot.layers.some((l) => l.id === targetId);
    if (!layerExists) {
      return null;
    }
  }

  // Get the display name
  let name = targetId;
  if (type === 'input') {
    const input = snapshot.inputs.find((i) => i.inputId === targetId);
    name = input?.metadata.title || targetId;
  } else if (type === 'layer') {
    // For layers, the name is the ID
    name = targetId;
  }

  // Check for duplicates - don't add if already in tiles
  const alreadyExists = snapshot.broadcastTiles.some(
    (tile) => tile.type === type && tile.targetId === targetId,
  );
  if (alreadyExists) {
    return null;
  }

  const tile: BroadcastTile = {
    id: randomUUID(),
    type,
    targetId,
    name,
  };

  snapshot.broadcastTiles.push(tile);

  return {
    type: 'broadcast-tile-added',
    tile,
  };
}

export function removeBroadcastTile(
  snapshot: RoomSnapshot,
  tileId: string,
): BroadcastServerEvent | null {
  const index = snapshot.broadcastTiles.findIndex((t) => t.id === tileId);
  if (index === -1) {
    return null;
  }

  snapshot.broadcastTiles.splice(index, 1);

  // If this was the selected tile, clear selection
  if (snapshot.selectedBroadcastTileId === tileId) {
    snapshot.selectedBroadcastTileId = null;
  }

  return {
    type: 'broadcast-tile-removed',
    tileId,
  };
}

export function selectBroadcastTile(
  snapshot: RoomSnapshot,
  tileId: string | null,
): BroadcastServerEvent | null {
  // If a specific tile is selected, validate it exists
  if (tileId !== null) {
    const exists = snapshot.broadcastTiles.some((t) => t.id === tileId);
    if (!exists) {
      return null;
    }
  }

  snapshot.selectedBroadcastTileId = tileId;

  return {
    type: 'broadcast-tile-selected',
    tileId,
  };
}

export function validateBroadcastTiles(snapshot: RoomSnapshot): void {
  // Remove tiles whose targets no longer exist
  snapshot.broadcastTiles = snapshot.broadcastTiles.filter((tile) => {
    if (tile.type === 'input') {
      return snapshot.inputs.some((i) => i.inputId === tile.targetId);
    } else if (tile.type === 'layer') {
      return snapshot.layers.some((l) => l.id === tile.targetId);
    }
    return false;
  });

  // If selected tile no longer exists, clear selection
  if (
    snapshot.selectedBroadcastTileId &&
    !snapshot.broadcastTiles.some(
      (t) => t.id === snapshot.selectedBroadcastTileId,
    )
  ) {
    snapshot.selectedBroadcastTileId = null;
  }
}

export function updateBroadcastTileNames(snapshot: RoomSnapshot): void {
  for (const tile of snapshot.broadcastTiles) {
    if (tile.type === 'input') {
      const input = snapshot.inputs.find((i) => i.inputId === tile.targetId);
      if (input) {
        tile.name = input.metadata.title;
      }
    } else if (tile.type === 'layer') {
      // Layer names are typically their IDs
      const layer = snapshot.layers.find((l) => l.id === tile.targetId);
      if (layer) {
        tile.name = layer.id;
      }
    }
  }
}

