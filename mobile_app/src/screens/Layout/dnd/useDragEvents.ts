import type { OrderChangeEvent } from './types';

/**
 * Stub for drag lifecycle events.
 * Implement the handlers here to add haptic feedback or analytics in the future.
 */
export interface DragEventHandlers {
  onDragStart: (objectId: string) => void;
  onDragEnd: (objectId: string) => void;
  onLayerEnter: (layerId: string) => void;
  onLayerLeave: (layerId: string) => void;
  onDrop: (event: OrderChangeEvent) => void;
}

export function useDragEvents(
  handlers?: Partial<DragEventHandlers>,
): DragEventHandlers {
  return {
    onDragStart: handlers?.onDragStart ?? (() => {}),
    onDragEnd: handlers?.onDragEnd ?? (() => {}),
    onLayerEnter: handlers?.onLayerEnter ?? (() => {}),
    onLayerLeave: handlers?.onLayerLeave ?? (() => {}),
    onDrop: handlers?.onDrop ?? (() => {}),
  };
}
