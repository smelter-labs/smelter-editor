import { LAYERS_CONTAINER_ID } from './types';
import type { LayerBounds, LayerId, ObjectBoundsEntry, ObjectId } from './types';

/**
 * Returns the best-matching layer ID for point (x, y).
 *
 * - When `forLayerDrag` is true  → only the layers-container zone is considered.
 * - When `forLayerDrag` is false → the layers-container is excluded; among the
 *   remaining candidates the smallest bounding-box wins (most specific).
 *
 * Runs entirely on the UI thread.
 */
export function findCollidingLayer(
  x: number,
  y: number,
  layers: Record<LayerId, LayerBounds>,
  forLayerDrag: boolean,
): LayerId | null {
  'worklet';
  let bestId: string | null = null;
  let bestArea = Infinity;

  for (const id in layers) {
    if (forLayerDrag && id !== LAYERS_CONTAINER_ID) continue;
    if (!forLayerDrag && id === LAYERS_CONTAINER_ID) continue;

    const b = layers[id];
    if (x >= b.pageX && x <= b.pageX + b.width && y >= b.pageY && y <= b.pageY + b.height) {
      const area = b.width * b.height;
      if (area < bestArea) {
        bestArea = area;
        bestId = id;
      }
    }
  }
  return bestId;
}

/**
 * Returns the insertion index (among non-active items) in targetLayerId
 * for a drag point at dropY.
 *
 * ActiveItemHider collapses the dragged item to zero height, which causes
 * siblings to shift up. Their onLayout fires and objectBounds is updated
 * to reflect the new (post-shift) positions, so no manual adjustment is
 * needed here — we just compare dropY against the live midpoints.
 *
 * Runs entirely on the UI thread.
 */
export function findPreviewIndex(
  dropY: number,
  targetLayerId: LayerId,
  objectBounds: Record<ObjectId, ObjectBoundsEntry>,
  activeObjectId: ObjectId | null,
): number {
  'worklet';
  const items: ObjectBoundsEntry[] = [];
  for (const id in objectBounds) {
    const entry = objectBounds[id];
    if (entry.layerId === targetLayerId && id !== activeObjectId) {
      items.push(entry);
    }
  }
  items.sort((a, b) => a.index - b.index);

  for (let i = 0; i < items.length; i++) {
    if (dropY < items[i].pageY + items[i].height / 2) return i;
  }
  return items.length;
}
