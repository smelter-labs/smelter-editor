import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  DragCanvas,
  DraggableObject,
  DroppableLayer,
  LAYERS_CONTAINER_ID,
} from "./dnd";
import type { OrderChangeEvent } from "./dnd/types";
import type { Layer, LayerBehaviorConfig } from "../../types/layout";
import type { InputCard } from "../../types/input";

// ─── Layer UI State ─────────────────────────────────────────────────────────────

interface LayerUiState {
  name: string;
  isVisible: boolean;
  isCollapsed: boolean;
}

// ─── Props ─────────────────────────────────────────────────────────────────────

interface LayersPanelProps {
  layers: Layer[];
  inputs: InputCard[];
  onLayersChange: (layers: Layer[]) => void;
}

// ─── Color helper ────────────────────────────────────────────────────────────

function colorFromId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (Math.imul(hash, 31) + id.charCodeAt(i)) | 0;
  }
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 55%, 45%)`;
}

// ─── Editable name (double-tap to enter edit mode) ─────────────────────────────

function EditableName({
  value,
  onChange,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  style?: object;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const lastTapRef = useRef(0);

  const commit = useCallback(() => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed) onChange(trimmed);
    else setDraft(value);
  }, [draft, value, onChange]);

  const handlePress = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      setDraft(value);
      setEditing(true);
    }
    lastTapRef.current = now;
  }, [value]);

  if (editing) {
    return (
      <TextInput
        value={draft}
        onChangeText={setDraft}
        onBlur={commit}
        onSubmitEditing={commit}
        autoFocus
        selectTextOnFocus
        style={[style, styles.editInput]}
      />
    );
  }

  return (
    <Pressable onPress={handlePress} style={styles.nameHitArea}>
      <Text style={style} numberOfLines={1}>
        {value}
      </Text>
    </Pressable>
  );
}

// ─── Behavior selector ───────────────────────────────────────────────────────

const BEHAVIOR_OPTIONS: { label: string; type: LayerBehaviorConfig["type"] | "manual" }[] = [
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
  const currentType = behavior?.type ?? "manual";

  return (
    <View style={styles.behaviorRow}>
      {BEHAVIOR_OPTIONS.map((opt) => {
        const active = currentType === opt.type;
        return (
          <Pressable
            key={opt.type}
            style={[styles.behaviorChip, active && styles.behaviorChipActive]}
            onPress={() => {
              if (opt.type === "manual") {
                onChange(undefined);
              } else if (opt.type !== currentType) {
                onChange({ type: opt.type } as LayerBehaviorConfig);
              }
            }}
          >
            <Text
              style={[
                styles.behaviorChipText,
                active && styles.behaviorChipTextActive,
              ]}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Item row ─────────────────────────────────────────────────────────────────

function ItemRow({
  inputId,
  inputs,
  dimmed,
}: {
  inputId: string;
  inputs: InputCard[];
  dimmed: boolean;
}) {
  const input = inputs.find((i) => i.id === inputId);
  const name = input?.name ?? inputId;
  const color = colorFromId(inputId);

  return (
    <View style={[styles.itemRow, dimmed && styles.itemRowDimmed]}>
      <View style={[styles.colorSwatch, { backgroundColor: color }]} />
      <Text style={styles.itemName} numberOfLines={1}>
        {name}
      </Text>
    </View>
  );
}

// ─── Layer header row ──────────────────────────────────────────────────────────

function LayerHeader({
  name,
  isVisible,
  isCollapsed,
  onToggleCollapse,
  onToggleVisible,
  onNameChange,
}: {
  name: string;
  isVisible: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onToggleVisible: () => void;
  onNameChange: (name: string) => void;
}) {
  return (
    <Pressable onPress={onToggleCollapse} style={styles.layerHeader}>
      <Pressable onPress={onToggleVisible} hitSlop={8} style={styles.eyeBtn}>
        <Text style={[styles.eyeIcon, !isVisible && styles.eyeIconHidden]}>
          {isVisible ? "●" : "○"}
        </Text>
      </Pressable>

      <EditableName
        value={name}
        onChange={onNameChange}
        style={styles.layerName}
      />

      <View style={styles.collapseBtn} pointerEvents="none">
        <Text style={styles.collapseIcon}>{isCollapsed ? "▶" : "▼"}</Text>
      </View>
    </Pressable>
  );
}

// ─── LayersPanel ───────────────────────────────────────────────────────────────

export default function LayersPanel({
  layers,
  inputs,
  onLayersChange,
}: LayersPanelProps) {
  // Local UI state (names, visibility, collapsed) — not synced to server
  const [uiState, setUiState] = useState<Record<string, LayerUiState>>(() => {
    const state: Record<string, LayerUiState> = {};
    layers.forEach((l, i) => {
      state[l.id] = {
        name: `Layer ${i + 1}`,
        isVisible: true,
        isCollapsed: false,
      };
    });
    return state;
  });

  // Ensure every layer has a UI entry when layers change from outside
  useEffect(() => {
    setUiState((prev) => {
      let changed = false;
      const next = { ...prev };
      layers.forEach((l, i) => {
        if (!next[l.id]) {
          next[l.id] = {
            name: `Layer ${i + 1}`,
            isVisible: true,
            isCollapsed: false,
          };
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [layers]);

  const getUi = useCallback(
    (id: string): LayerUiState =>
      uiState[id] ?? { name: id, isVisible: true, isCollapsed: false },
    [uiState],
  );

  const setLayerUi = useCallback(
    (layerId: string, patch: Partial<LayerUiState>) => {
      setUiState((prev) => ({
        ...prev,
        [layerId]: { ...prev[layerId], ...patch },
      }));
    },
    [],
  );

  const handleOrderChange = useCallback(
    (event: OrderChangeEvent) => {
      const { sourceLayerId, targetLayerId, objectId, newIndex } = event;

      if (sourceLayerId === LAYERS_CONTAINER_ID) {
        // Reorder layers
        const ids = layers.map((l) => l.id).filter((id) => id !== objectId);
        ids.splice(newIndex, 0, objectId);
        const reordered = ids.map((id) => layers.find((l) => l.id === id)!);
        onLayersChange(reordered);
      } else {
        // Move an input between layers (or reorder within the same layer)
        const newLayers = layers.map((l) => ({
          ...l,
          inputs: [...l.inputs],
        }));
        const srcLayer = newLayers.find((l) => l.id === sourceLayerId);
        const dstLayer = newLayers.find((l) => l.id === targetLayerId);
        if (!srcLayer || !dstLayer) return;

        const itemIdx = srcLayer.inputs.findIndex(
          (i) => i.inputId === objectId,
        );
        if (itemIdx === -1) return;

        const [movedItem] = srcLayer.inputs.splice(itemIdx, 1);
        // Remove from dst in case it's a same-layer reorder
        const cleanDst = dstLayer.inputs.filter(
          (i) => i.inputId !== objectId,
        );
        cleanDst.splice(newIndex, 0, movedItem);
        dstLayer.inputs = cleanDst;

        onLayersChange(newLayers);
      }
    },
    [layers, onLayersChange],
  );

  return (
    <DragCanvas onOrderChange={handleOrderChange} style={styles.panel}>
      <View style={styles.panelHeader}>
        <Text style={styles.panelTitle}>LAYERS</Text>
      </View>

      <ScrollView
        style={styles.layersList}
        contentContainerStyle={styles.layersContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <DroppableLayer layerId={LAYERS_CONTAINER_ID} style={{ flex: 1 }}>
          {layers.map((layer, layerIndex) => {
            const ui = getUi(layer.id);
            return (
              <DraggableObject
                key={layer.id}
                objectId={layer.id}
                layerId={LAYERS_CONTAINER_ID}
                index={layerIndex}
              >
                <DroppableLayer
                  layerId={layer.id}
                  style={styles.layerContainer}
                >
                  <LayerHeader
                    name={ui.name}
                    isVisible={ui.isVisible}
                    isCollapsed={ui.isCollapsed}
                    onToggleCollapse={() =>
                      setLayerUi(layer.id, {
                        isCollapsed: !ui.isCollapsed,
                      })
                    }
                    onToggleVisible={() =>
                      setLayerUi(layer.id, { isVisible: !ui.isVisible })
                    }
                    onNameChange={(name) => setLayerUi(layer.id, { name })}
                  />

                  {!ui.isCollapsed && (
                    <BehaviorSelector
                      behavior={layer.behavior}
                      onChange={(b) => {
                        const newLayers = layers.map((l) =>
                          l.id === layer.id
                            ? { ...l, behavior: b }
                            : l,
                        );
                        onLayersChange(newLayers);
                      }}
                    />
                  )}

                  {!ui.isCollapsed &&
                    layer.inputs.map((item, itemIndex) => (
                      <DraggableObject
                        key={item.inputId}
                        objectId={item.inputId}
                        layerId={layer.id}
                        index={itemIndex}
                      >
                        <ItemRow
                          inputId={item.inputId}
                          inputs={inputs}
                          dimmed={!ui.isVisible}
                        />
                      </DraggableObject>
                    ))}
                </DroppableLayer>
              </DraggableObject>
            );
          })}
        </DroppableLayer>
      </ScrollView>
    </DragCanvas>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const PS = {
  panelBg: "#252526",
  layerBg: "#2D2D2D",
  layerBorder: "#3A3A3A",
  itemBg: "#262626",
  text: "#CCCCCC",
  textDim: "#777777",
  accent: "#4D9DE0",
  divider: "#3A3A3A",
};

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    backgroundColor: PS.panelBg,
  },
  panelHeader: {
    height: 36,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: PS.divider,
  },
  panelTitle: {
    color: PS.textDim,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  layersList: { flex: 1 },
  layersContent: { paddingBottom: 16, flexGrow: 1 },

  layerContainer: {
    borderBottomWidth: 1,
    borderBottomColor: PS.layerBorder,
    overflow: "hidden",
  },

  layerHeader: {
    flexDirection: "row",
    alignItems: "center",
    height: 38,
    paddingHorizontal: 8,
    backgroundColor: PS.layerBg,
    gap: 6,
  },
  eyeBtn: { width: 22, alignItems: "center", justifyContent: "center" },
  eyeIcon: { color: PS.text, fontSize: 14 },
  eyeIconHidden: { color: PS.textDim, opacity: 0.4 },
  layerName: {
    color: PS.text,
    fontSize: 12,
    fontWeight: "600",
  },
  nameHitArea: { flex: 1, justifyContent: "center" },
  collapseBtn: { width: 16, alignItems: "center", justifyContent: "center" },
  collapseIcon: { color: PS.textDim, fontSize: 11 },

  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 36,
    paddingLeft: 36,
    paddingRight: 10,
    backgroundColor: PS.itemBg,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: PS.layerBorder,
  },
  itemRowDimmed: { opacity: 0.4 },
  colorSwatch: {
    width: 16,
    height: 16,
    borderRadius: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.15)",
  },
  itemName: {
    color: PS.text,
    fontSize: 12,
    flex: 1,
  },

  editInput: {
    padding: 0,
    margin: 0,
    flex: 1,
    color: PS.text,
    fontSize: 12,
    borderBottomWidth: 1,
    borderBottomColor: PS.accent,
  },

  behaviorRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: PS.layerBg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: PS.layerBorder,
  },
  behaviorChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: PS.layerBorder,
    backgroundColor: PS.itemBg,
  },
  behaviorChipActive: {
    borderColor: PS.accent,
    backgroundColor: "rgba(77, 157, 224, 0.15)",
  },
  behaviorChipText: {
    color: PS.textDim,
    fontSize: 10,
    fontWeight: "500",
  },
  behaviorChipTextActive: {
    color: PS.accent,
  },
});
