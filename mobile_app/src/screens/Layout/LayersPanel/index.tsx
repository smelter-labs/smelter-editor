import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  InteractionManager,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Droppable, DropProvider } from "react-native-reanimated-dnd";
import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import type { Layer, LayerBehaviorConfig } from "../../../types/layout";
import type { InputCard } from "../../../types/input";
import { Layer as LayerComponent } from "./Layer";
import { applyMoveLayer, applyMoveInput } from "./LayerRow";
import type { DragData, LayerUiState } from "./LayerRow";

const C = {
  panelBg: "#252526",
  textDim: "#777777",
  divider: "#3A3A3A",
  accent: "#4D9DE0",
};

interface LayersPanelProps {
  layers: Layer[];
  inputs: InputCard[];
  onLayersChange: (layers: Layer[]) => void;
  onToggleLayerVisibility?: (
    layerId: string,
    shouldShow: boolean,
  ) => Promise<void>;
  onAddLayer?: () => void;
  onDeleteLayer?: (layerId: string) => void;
}

export default function LayersPanel({
  layers,
  inputs,
  onLayersChange,
  onToggleLayerVisibility,
  onAddLayer,
  onDeleteLayer,
}: LayersPanelProps) {
  // Always-fresh ref so onDrop closures never use stale layers.
  const layersRef = useRef(layers);
  layersRef.current = layers;

  // ── Layer UI state ────────────────────────────────────────────────────────

  const [uiState, setUiState] = useState<Record<string, LayerUiState>>(() =>
    Object.fromEntries(
      layers.map((l, i) => [
        l.id,
        { name: `Layer ${i + 1}`, isVisible: true, isCollapsed: false },
      ]),
    ),
  );

  useEffect(() => {
    setUiState((prev) => {
      const additions: Record<string, LayerUiState> = {};
      layers.forEach((l, i) => {
        if (!prev[l.id]) {
          additions[l.id] = {
            name: `Layer ${i + 1}`,
            isVisible: true,
            isCollapsed: false,
          };
        }
      });
      return Object.keys(additions).length > 0
        ? { ...prev, ...additions }
        : prev;
    });
  }, [layers]);

  const getUi = useCallback(
    (id: string): LayerUiState =>
      uiState[id] ?? { name: id, isVisible: true, isCollapsed: false },
    [uiState],
  );

  const patchUi = useCallback(
    (layerId: string, patch: Partial<LayerUiState>) =>
      setUiState((prev) => ({
        ...prev,
        [layerId]: { ...prev[layerId], ...patch },
      })),
    [],
  );

  const setBehavior = useCallback(
    (layerId: string, behavior: LayerBehaviorConfig | undefined) => {
      const currentLayers = layersRef.current;
      const layerIndex = currentLayers.findIndex((l) => l.id === layerId);
      if (layerIndex === -1) return;

      const currentLayer = currentLayers[layerIndex];
      if (
        currentLayer.behavior?.type === "picture-in-picture" &&
        behavior === undefined &&
        currentLayer.inputs.length > 1
      ) {
        const [mainInput, ...remainingInputs] = currentLayer.inputs;
        if (!mainInput) return;

        const newLayer: Layer = {
          id: `${layerId}-pip-main-${Date.now()}`,
          inputs: [mainInput],
        };
        const updatedCurrentLayer: Layer = {
          ...currentLayer,
          behavior,
          inputs: remainingInputs,
        };

        const nextLayers = [...currentLayers];
        nextLayers[layerIndex] = updatedCurrentLayer;
        nextLayers.splice(layerIndex, 0, newLayer);
        onLayersChange(nextLayers);
        return;
      }

      onLayersChange(
        currentLayers.map((l) => (l.id === layerId ? { ...l, behavior } : l)),
      );
    },
    [onLayersChange],
  );

  // ── Drop handlers ─────────────────────────────────────────────────────────
  //
  // All drops apply immediately via onLayersChange.
  // The library will spring-animate the Draggable toward the Droppable, but
  // the React re-render unmounts the old Draggable (keyed by stable id) and
  // mounts a fresh one at the correct position, so the orphaned animation is
  // harmless.

  const handleLayerDrop = useCallback(
    (draggedLayerId: string, targetLayerIndex: number) => {
      const result = applyMoveLayer(
        layersRef.current,
        draggedLayerId,
        targetLayerIndex,
      );
      if (result !== layersRef.current) {
        // Defer until after the drag-release spring animation completes so the
        // Draggable's animated view doesn't leave an empty-space ghost in the list.
        InteractionManager.runAfterInteractions(() => onLayersChange(result));
      }
    },
    [onLayersChange],
  );

  const handleInputMove = useCallback(
    (layerId: string, inputId: string, fromIndex: number, toIndex: number) => {
      const result = applyMoveInput(
        layersRef.current,
        layerId,
        inputId,
        layerId,
        toIndex,
      );
      if (result !== layersRef.current) {
        onLayersChange(result);
      }
    },
    [onLayersChange],
  );

  const handleInputMoveLayer = useCallback(
    (inputId: string, fromLayerId: string, toLayerId: string) => {
      const targetLayer = layersRef.current.find((l) => l.id === toLayerId);
      const targetIndex = targetLayer ? targetLayer.inputs.length : 0;
      const result = applyMoveInput(
        layersRef.current,
        fromLayerId,
        inputId,
        toLayerId,
        targetIndex,
      );
      if (result !== layersRef.current) {
        onLayersChange(result);
      }
    },
    [onLayersChange],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <DropProvider>
      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>LAYERS</Text>
          {onAddLayer && (
            <Pressable
              onPress={onAddLayer}
              hitSlop={8}
              style={styles.addLayerBtn}
            >
              <MaterialDesignIcons name="plus" color={C.accent} size={18} />
            </Pressable>
          )}
        </View>

        <FlatList
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          data={layers}
          keyExtractor={(layer) => layer.id}
          renderItem={({ item: layer, index: layerIndex }) => {
            const ui = getUi(layer.id);
            return (
              <LayerComponent
                layer={layer}
                inputs={inputs}
                ui={ui}
                allLayers={layers}
                onInputMove={(layerId, inputId, from, to) =>
                  handleInputMove(layerId, inputId, from, to)
                }
                onInputMoveLayer={(inputId, fromLayerId, toLayerId) =>
                  handleInputMoveLayer(inputId, fromLayerId, toLayerId)
                }
                onUiChange={(patch) => patchUi(layer.id, patch)}
                onBehaviorChange={(b) => setBehavior(layer.id, b)}
                onLayerDrop={(data) =>
                  handleLayerDrop(data.layerId, layerIndex)
                }
                onToggleLayerVisibility={onToggleLayerVisibility}
                onDeleteLayer={onDeleteLayer}
              />
            );
          }}
          ListFooterComponent={
            <Droppable<DragData>
              style={styles.tailDropZone}
              activeStyle={styles.tailDropZoneActive}
              onDrop={(data) => {
                if (data.type === "layer") {
                  handleLayerDrop(data.layerId, layers.length);
                }
              }}
            >
              <View style={styles.tailLine} />
            </Droppable>
          }
        />
      </View>
    </DropProvider>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    backgroundColor: C.panelBg,
  },
  panelHeader: {
    height: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.divider,
  },
  panelTitle: {
    color: C.textDim,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  addLayerBtn: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  list: { flex: 1 },
  listContent: { paddingBottom: 16, flexGrow: 1 },
  tailDropZone: {
    height: 20,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  tailDropZoneActive: {
    backgroundColor: "rgba(77, 157, 224, 0.06)",
  },
  tailLine: {
    height: 2,
    borderRadius: 999,
    backgroundColor: "rgba(77, 157, 224, 0.35)",
  },
});
