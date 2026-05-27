export type BroadcastTile = {
  id: string; // UUID
  type: 'input' | 'layer';
  targetId: string; // The input ID or layer ID
  name: string; // Display name (synced from input/layer)
};
