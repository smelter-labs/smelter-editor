export type LayerId = string;
export type ObjectId = string;

export type FlatDataTree = Record<LayerId, ObjectId[]>;

/** Reserved ID for the top-level DroppableLayer that holds draggable layers. */
export const LAYERS_CONTAINER_ID = "__layers__";

export interface LayerBounds {
  pageX: number;
  pageY: number;
  width: number;
  height: number;
}

export interface ObjectBoundsEntry extends LayerBounds {
  layerId: LayerId;
  index: number;
}

export interface OrderChangeEvent {
  sourceLayerId: LayerId;
  targetLayerId: LayerId;
  objectId: ObjectId;
  newIndex: number;
}

export interface LayerItemProps {
  id: string;
  name: string;
  color: string;
  isVisible: boolean;
}
