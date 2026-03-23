import { createContext, useContext } from 'react';
import type { SharedValue } from 'react-native-reanimated';
import type React from 'react';
import type { LayerBounds, LayerId, ObjectBoundsEntry, ObjectId } from './types';

export interface PreviewState {
  layerId: LayerId;
  index: number;
}

export interface DragContextValue {
  // SharedValues — live on the UI thread, accessible from worklets
  activeId: SharedValue<ObjectId | null>;
  absoluteX: SharedValue<number>;
  absoluteY: SharedValue<number>;
  translationX: SharedValue<number>;
  translationY: SharedValue<number>;
  itemStartPageX: SharedValue<number>;
  itemStartPageY: SharedValue<number>;
  hoverLayerId: SharedValue<LayerId | null>;
  layerBounds: SharedValue<Record<LayerId, LayerBounds>>;
  objectBounds: SharedValue<Record<ObjectId, ObjectBoundsEntry>>;
  hoverPreviewIndex: SharedValue<number>;

  // JS-thread reactive state
  previewState: PreviewState | null;
  activeObjectId: ObjectId | null;

  // JS-thread API
  registerLayer: (id: LayerId, bounds: LayerBounds) => void;
  unregisterLayer: (id: LayerId) => void;
  registerObject: (
    id: ObjectId,
    layerId: LayerId,
    bounds: LayerBounds,
    index: number,
  ) => void;
  unregisterObject: (id: ObjectId) => void;
  setChildrenForObject: (id: ObjectId, children: React.ReactNode) => void;
  startDrag: (objectId: ObjectId, width: number, height: number) => void;
  handleDrop: (objectId: ObjectId, sourceLayerId: LayerId) => void;
}

export const DragContext = createContext<DragContextValue | null>(null);

export function useDragContext(): DragContextValue {
  const ctx = useContext(DragContext);
  if (!ctx) throw new Error('useDragContext must be used inside <DragCanvas>');
  return ctx;
}

/**
 * True when the consuming component is being rendered inside the ghost overlay.
 * DroppableLayer and DraggableObject skip registration while in the ghost
 * to avoid corrupting the real layout bounds.
 */
export const GhostContext = createContext(false);
export function useIsInGhost() {
  return useContext(GhostContext);
}
