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
  Draggable,
  Droppable,
  DropProvider,
} from "react-native-reanimated-dnd";
import { Chip } from "react-native-paper";
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

type LayerDragData = {
  type: "layer";
  layerId: string;
};

type InputDragData = {
  type: "input";
  inputId: string;
  sourceLayerId: string;
};

type DragData = LayerDragData | InputDragData;

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
  const currentType = behavior?.type ?? "manual";

  return (
    <View style={styles.behaviorRow}>
      {BEHAVIOR_OPTIONS.map((opt) => {
        const active = currentType === opt.type;
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
              if (opt.type === "manual") {
                onChange(undefined);
              } else if (opt.type !== currentType) {
                onChange({ type: opt.type } as LayerBehaviorConfig);
              }
            }}
          >
            {opt.label}
          </Chip>
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

  const moveLayer = useCallback(
    (layerId: string, targetIndex: number) => {
      const fromIndex = layers.findIndex((l) => l.id === layerId);
      if (fromIndex === -1) return;

      const boundedTarget = Math.max(0, Math.min(targetIndex, layers.length));
      const adjustedTarget =
        fromIndex < boundedTarget ? boundedTarget - 1 : boundedTarget;
      if (adjustedTarget === fromIndex) return;

      const next = [...layers];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(adjustedTarget, 0, moved);
      onLayersChange(next);
    },
    [layers, onLayersChange],
  );

  const moveInput = useCallback(
    (
      sourceLayerId: string,
      inputId: string,
      targetLayerId: string,
      targetIndex: number,
    ) => {
      const nextLayers = layers.map((layer) => ({
        ...layer,
        inputs: [...layer.inputs],
      }));

      const sourceLayer = nextLayers.find(
        (layer) => layer.id === sourceLayerId,
      );
      const targetLayer = nextLayers.find(
        (layer) => layer.id === targetLayerId,
      );
      if (!sourceLayer || !targetLayer) return;

      const sourceIndex = sourceLayer.inputs.findIndex(
        (input) => input.inputId === inputId,
      );
      if (sourceIndex === -1) return;

      const [movedInput] = sourceLayer.inputs.splice(sourceIndex, 1);

      const duplicateIndex = targetLayer.inputs.findIndex(
        (input) => input.inputId === inputId,
      );
      if (duplicateIndex !== -1) {
        targetLayer.inputs.splice(duplicateIndex, 1);
      }

      const boundedTarget = Math.max(
        0,
        Math.min(targetIndex, targetLayer.inputs.length),
      );
      const adjustedTarget =
        sourceLayerId === targetLayerId && sourceIndex < boundedTarget
          ? boundedTarget - 1
          : boundedTarget;

      targetLayer.inputs.splice(adjustedTarget, 0, movedInput);
      onLayersChange(nextLayers);
    },
    [layers, onLayersChange],
  );

  return (
    <DropProvider>
      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>LAYERS</Text>
        </View>

        <ScrollView
          style={styles.layersList}
          contentContainerStyle={styles.layersContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {layers.map((layer, layerIndex) => {
            const ui = getUi(layer.id);

            return (
              <View key={layer.id} style={styles.layerContainer}>
                <Droppable<DragData>
                  style={styles.layerDropZone}
                  activeStyle={styles.layerDropZoneActive}
                  onDrop={(data) => {
                    if (data.type === "layer") {
                      moveLayer(data.layerId, layerIndex);
                      return;
                    }
                    moveInput(
                      data.sourceLayerId,
                      data.inputId,
                      layer.id,
                      layer.inputs.length,
                    );
                  }}
                >
                  <Draggable<LayerDragData>
                    data={{ type: "layer", layerId: layer.id }}
                    dragAxis="y"
                    preDragDelay={140}
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
                  </Draggable>
                </Droppable>

                {!ui.isCollapsed && (
                  <BehaviorSelector
                    behavior={layer.behavior}
                    onChange={(behavior) => {
                      const newLayers = layers.map((entry) =>
                        entry.id === layer.id ? { ...entry, behavior } : entry,
                      );
                      onLayersChange(newLayers);
                    }}
                  />
                )}

                {!ui.isCollapsed &&
                  layer.inputs.map((item, itemIndex) => (
                    <Droppable<DragData>
                      key={item.inputId}
                      style={styles.itemDropZone}
                      activeStyle={styles.itemDropZoneActive}
                      onDrop={(data) => {
                        if (data.type !== "input") return;
                        moveInput(
                          data.sourceLayerId,
                          data.inputId,
                          layer.id,
                          itemIndex,
                        );
                      }}
                    >
                      <Draggable<InputDragData>
                        data={{
                          type: "input",
                          inputId: item.inputId,
                          sourceLayerId: layer.id,
                        }}
                        dragAxis="y"
                        preDragDelay={140}
                      >
                        <ItemRow
                          inputId={item.inputId}
                          inputs={inputs}
                          dimmed={!ui.isVisible}
                        />
                      </Draggable>
                    </Droppable>
                  ))}

                {!ui.isCollapsed && (
                  <Droppable<DragData>
                    style={styles.layerTailDropZone}
                    activeStyle={styles.layerTailDropZoneActive}
                    onDrop={(data) => {
                      if (data.type !== "input") return;
                      moveInput(
                        data.sourceLayerId,
                        data.inputId,
                        layer.id,
                        layer.inputs.length,
                      );
                    }}
                  >
                    <View style={styles.layerTailDropLine} />
                  </Droppable>
                )}
              </View>
            );
          })}

          <Droppable<DragData>
            style={styles.layersTailDropZone}
            activeStyle={styles.layersTailDropZoneActive}
            onDrop={(data) => {
              if (data.type !== "layer") return;
              moveLayer(data.layerId, layers.length);
            }}
          >
            <View style={styles.layersTailDropLine} />
          </Droppable>
        </ScrollView>
      </View>
    </DropProvider>
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
  layerDropZone: {
    backgroundColor: PS.layerBg,
  },
  layerDropZoneActive: {
    backgroundColor: "rgba(77, 157, 224, 0.2)",
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
  itemDropZone: {
    backgroundColor: PS.itemBg,
  },
  itemDropZoneActive: {
    backgroundColor: "rgba(77, 157, 224, 0.2)",
  },
  layerTailDropZone: {
    height: 10,
    justifyContent: "center",
    paddingHorizontal: 8,
    backgroundColor: PS.itemBg,
  },
  layerTailDropZoneActive: {
    backgroundColor: "rgba(77, 157, 224, 0.2)",
  },
  layerTailDropLine: {
    height: 2,
    borderRadius: 999,
    backgroundColor: "rgba(77, 157, 224, 0.6)",
  },
  layersTailDropZone: {
    height: 20,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  layersTailDropZoneActive: {
    backgroundColor: "rgba(77, 157, 224, 0.2)",
  },
  layersTailDropLine: {
    height: 2,
    borderRadius: 999,
    backgroundColor: "rgba(77, 157, 224, 0.6)",
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
