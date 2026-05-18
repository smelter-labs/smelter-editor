import type { BroadcastTile } from '@smelter-editor/types';

export type BroadcastModeState = {
  tiles: BroadcastTile[];
  selectedTileId: string | null;
  isEditMode: boolean;
  // Cache for offline support
  cachedTiles?: BroadcastTile[];
  cachedSelectedTileId?: string | null;
  lastSyncTime?: number;
};
