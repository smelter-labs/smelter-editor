import type { Layer, LayerBehaviorConfig } from "../../../types/layout";

// ─── Shared types ────────────────────────────────────────────────────────────

export interface LayerUiState {
  name: string;
  isVisible: boolean;
  isCollapsed: boolean;
}

export type LayerDragData = { type: "layer"; layerId: string };
export type InputDragData = {
  type: "input";
  inputId: string;
  sourceLayerId: string;
};
export type DragData = LayerDragData | InputDragData;

// ─── Pure move helpers ───────────────────────────────────────────────────────

export function applyMoveLayer(
  layers: Layer[],
  layerId: string,
  targetIndex: number,
): Layer[] {
  const from = layers.findIndex((l) => l.id === layerId);
  if (from === -1 || from === targetIndex) return layers;
  const next = [...layers];
  const [item] = next.splice(from, 1);
  const insert = Math.min(Math.max(0, targetIndex), next.length);
  if (insert === from) return layers;
  next.splice(insert, 0, item);
  return next;
}

export function applyMoveInput(
  layers: Layer[],
  sourceLayerId: string,
  inputId: string,
  targetLayerId: string,
  targetIndex: number,
): Layer[] {
  const next = layers.map((l) => ({ ...l, inputs: [...l.inputs] }));
  const src = next.find((l) => l.id === sourceLayerId);
  const tgt = next.find((l) => l.id === targetLayerId);
  if (!src || !tgt) return layers;

  const srcIdx = src.inputs.findIndex((i) => i.inputId === inputId);
  if (srcIdx === -1) return layers;

  const [item] = src.inputs.splice(srcIdx, 1);

  const insert = Math.min(Math.max(0, targetIndex), tgt.inputs.length);
  tgt.inputs.splice(insert, 0, item);
  return next;
}
