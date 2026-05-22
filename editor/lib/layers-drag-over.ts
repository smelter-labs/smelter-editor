import { arrayMove } from '@dnd-kit/sortable';
import type { UniqueIdentifier } from '@dnd-kit/core';
import type { Layer } from '@/lib/types';

export type DragItemRef = {
  type: 'layer' | 'input';
  layerId: string;
  inputId?: string;
};

export function findDragItem(
  layers: Layer[],
  id: UniqueIdentifier,
): DragItemRef | null {
  const sid = String(id);
  if (sid.startsWith('layer::')) {
    return { type: 'layer', layerId: sid.slice(7) };
  }
  for (const layer of layers) {
    if (layer.inputs.some((i) => i.inputId === sid)) {
      return { type: 'input', layerId: layer.id, inputId: sid };
    }
  }
  return null;
}

function resolveDropTarget(
  layers: Layer[],
  overId: UniqueIdentifier,
): { overLayerId: string; overInputId: string | null } | null {
  const overIdStr = String(overId);
  if (overIdStr.startsWith('layer::')) {
    return { overLayerId: overIdStr.slice(7), overInputId: null };
  }

  const owningLayer = layers.find((l) =>
    l.inputs.some((i) => i.inputId === overIdStr),
  );
  if (!owningLayer) return null;

  return { overLayerId: owningLayer.id, overInputId: overIdStr };
}

export function applyDragOverToLayers(
  layers: Layer[],
  activeId: UniqueIdentifier,
  overId: UniqueIdentifier,
): Layer[] | null {
  if (activeId === overId) return null;

  const activeRef = findDragItem(layers, activeId);
  if (!activeRef) return null;

  const dropTarget = resolveDropTarget(layers, overId);
  if (!dropTarget) return null;

  const { overLayerId, overInputId } = dropTarget;

  if (activeRef.type === 'layer') {
    const oldIdx = layers.findIndex((l) => l.id === activeRef.layerId);
    const newIdx = layers.findIndex((l) => l.id === overLayerId);
    if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return null;
    return arrayMove(layers, oldIdx, newIdx);
  }

  if (activeRef.type !== 'input' || !activeRef.inputId) return null;

  const srcLayerIdx = layers.findIndex((l) => l.id === activeRef.layerId);
  if (srcLayerIdx === -1) return null;

  const srcInputIdx = layers[srcLayerIdx].inputs.findIndex(
    (i) => i.inputId === activeRef.inputId,
  );
  if (srcInputIdx === -1) return null;

  const dstLayerIdx = layers.findIndex((l) => l.id === overLayerId);
  if (dstLayerIdx === -1) return null;

  if (srcLayerIdx === dstLayerIdx) {
    if (!overInputId) return null;
    const dstInputIdx = layers[dstLayerIdx].inputs.findIndex(
      (i) => i.inputId === overInputId,
    );
    if (dstInputIdx === -1 || srcInputIdx === dstInputIdx) return null;
    return layers.map((l, i) =>
      i === srcLayerIdx
        ? { ...l, inputs: arrayMove(l.inputs, srcInputIdx, dstInputIdx) }
        : l,
    );
  }

  const next = layers.map((l) => ({
    ...l,
    inputs: [...l.inputs],
  }));
  const [moved] = next[srcLayerIdx].inputs.splice(srcInputIdx, 1);
  let insertIdx = next[dstLayerIdx].inputs.length;
  if (overInputId) {
    const overInputIdx = next[dstLayerIdx].inputs.findIndex(
      (i) => i.inputId === overInputId,
    );
    if (overInputIdx !== -1) insertIdx = overInputIdx;
  }
  next[dstLayerIdx].inputs.splice(insertIdx, 0, moved);
  return next;
}
