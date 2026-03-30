import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Draggable, Droppable } from "react-native-reanimated-dnd";
import { Chip } from "react-native-paper";
import type { Layer, LayerBehaviorConfig } from "../../../types/layout";
import type { InputCard } from "../../../types/input";
import { LayerHeader } from "./LayerHeader";
import { InputRow } from "./InputRow";

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

// ─── Theme ───────────────────────────────────────────────────────────────────

const C = {
  layerBg: "#2D2D2D",
  layerBorder: "#3A3A3A",
  itemBg: "#262626",
  textDim: "#777777",
  accent: "#4D9DE0",
};

// ─── BehaviorSelector ────────────────────────────────────────────────────────

const BEHAVIOR_OPTIONS: {
  label: string;
  type: LayerBehaviorConfig["type"] | "manual";
}[] = [
  { label: "Equal Grid", type: "equal-grid" },
  { label: "≈ Aspect Grid", type: "approximate-aspect-grid" },
  { label: "Exact Aspect", type: "exact-aspect-grid" },
  { label: "PiP", type: "picture-in-picture" },
  { label: "Manual", type: "manual" },
];

function BehaviorSelector({
  behavior,
  onChange,
}: {
  behavior: LayerBehaviorConfig | undefined;
  onChange: (b: LayerBehaviorConfig | undefined) => void;
}) {
  const current = behavior?.type ?? "manual";
  return (
    <View style={styles.behaviorRow}>
      {BEHAVIOR_OPTIONS.map((opt) => {
        const active = current === opt.type;
        return (
          <Chip
            key={opt.type}
            compact
            mode={active ? "flat" : "outlined"}
            selected={active}
            showSelectedCheck={false}
            style={[styles.behaviorChip, active && styles.behaviorChipActive]}
            textStyle={[
              styles.behaviorChipText,
              active && styles.behaviorChipTextActive,
            ]}
            onPress={() => {
              if (opt.type === "manual") onChange(undefined);
              else if (opt.type !== current)
                onChange({ type: opt.type } as LayerBehaviorConfig);
            }}
          >
            {opt.label}
          </Chip>
        );
      })}
    </View>
  );
}

// ─── LayerRow ────────────────────────────────────────────────────────────────

export interface LayerRowProps {
  layer: Layer;
  layerIndex: number;
  inputs: InputCard[];
  ui: LayerUiState;
  onLayerDrop: (data: LayerDragData) => void;
  onInputDrop: (
    sourceLayerId: string,
    inputId: string,
    targetIndex: number,
  ) => void;
  onUiChange: (patch: Partial<LayerUiState>) => void;
  onBehaviorChange: (behavior: LayerBehaviorConfig | undefined) => void;
}

export function LayerRow({
  layer,
  layerIndex,
  inputs,
  ui,
  onLayerDrop,
  onInputDrop,
  onUiChange,
  onBehaviorChange,
}: LayerRowProps) {
  return (
    <View style={styles.container}>
      {/*
       * The layer Draggable wraps the entire card. Draggable.Handle limits
       * drag initiation to the header. On drop, the Draggable springs to the
       * Droppable's center and becomes orphaned when React re-renders the new
       * order — this is fine because the old animated view gets unmounted.
       */}
      <Draggable<LayerDragData>
        data={{ type: "layer", layerId: layer.id }}
        dragAxis="y"
        preDragDelay={140}
        collisionAlgorithm="center"
      >
        {/* Header drop zone */}
        <Droppable<DragData>
          style={styles.headerDropZone}
          activeStyle={styles.headerDropZoneActive}
          onDrop={(data) => {
            if (data.type === "layer") {
              onLayerDrop(data);
            } else {
              onInputDrop(
                data.sourceLayerId,
                data.inputId,
                layer.inputs.length,
              );
            }
          }}
        >
          <Draggable.Handle>
            <LayerHeader
              name={ui.name}
              isVisible={ui.isVisible}
              isCollapsed={ui.isCollapsed}
              onToggleCollapse={() =>
                onUiChange({ isCollapsed: !ui.isCollapsed })
              }
              onToggleVisible={() => onUiChange({ isVisible: !ui.isVisible })}
              onNameChange={(name) => onUiChange({ name })}
            />
          </Draggable.Handle>
        </Droppable>

        {!ui.isCollapsed && (
          <BehaviorSelector
            behavior={layer.behavior}
            onChange={onBehaviorChange}
          />
        )}

        {!ui.isCollapsed &&
          layer.inputs.map((item, itemIndex) => (
            <InputRow
              key={`${item.inputId}-${itemIndex}`}
              inputId={item.inputId}
              sourceLayerId={layer.id}
              inputs={inputs}
              dimmed={!ui.isVisible}
              onDrop={(data) =>
                onInputDrop(data.sourceLayerId, data.inputId, itemIndex)
              }
              onLayerDrop={onLayerDrop}
            />
          ))}

        {/* Tail / empty-layer drop zone — appends an input to this layer */}
        {!ui.isCollapsed && (
          <Droppable<DragData>
            style={
              layer.inputs.length === 0
                ? styles.emptyDropZone
                : styles.tailDropZone
            }
            activeStyle={styles.tailDropZoneActive}
            onDrop={(data) => {
              if (data.type === "input") {
                onInputDrop(
                  data.sourceLayerId,
                  data.inputId,
                  layer.inputs.length,
                );
              } else if (data.type === "layer") {
                onLayerDrop(data);
              }
            }}
          >
            {layer.inputs.length === 0 ? (
              <Text style={styles.emptyHint}>Drop input here</Text>
            ) : (
              <View style={styles.tailLine} />
            )}
          </Droppable>
        )}
      </Draggable>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    borderBottomColor: C.layerBorder,
  },
  headerDropZone: {
    backgroundColor: C.layerBg,
    borderTopWidth: 2,
    borderTopColor: "transparent",
  },
  headerDropZoneActive: {
    borderTopColor: C.accent,
    backgroundColor: "rgba(77, 157, 224, 0.06)",
  },
  emptyDropZone: {
    height: 48,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: C.itemBg,
  },
  emptyHint: {
    color: C.textDim,
    fontSize: 11,
  },
  tailDropZone: {
    height: 16,
    justifyContent: "center",
    paddingHorizontal: 8,
    backgroundColor: C.itemBg,
  },
  tailDropZoneActive: {
    backgroundColor: "rgba(77, 157, 224, 0.06)",
  },
  tailLine: {
    height: 2,
    borderRadius: 999,
    backgroundColor: "rgba(77, 157, 224, 0.35)",
  },
  behaviorRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: C.layerBg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.layerBorder,
  },
  behaviorChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.layerBorder,
    backgroundColor: C.itemBg,
  },
  behaviorChipActive: {
    borderColor: C.accent,
    backgroundColor: "rgba(77, 157, 224, 0.15)",
  },
  behaviorChipText: {
    color: C.textDim,
    fontSize: 10,
    fontWeight: "500",
  },
  behaviorChipTextActive: {
    color: C.accent,
  },
});
