import React, { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Droppable, DropProvider } from "react-native-reanimated-dnd";
import type { Layer, LayerBehaviorConfig } from "../../../types/layout";
import type { InputCard } from "../../../types/input";
import { LayerRow, applyMoveLayer, applyMoveInput } from "./LayerRow";
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
}

export default function LayersPanel({
  layers,
  inputs,
  onLayersChange,
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
    (layerId: string, behavior: LayerBehaviorConfig | undefined) =>
      onLayersChange(
        layers.map((l) => (l.id === layerId ? { ...l, behavior } : l)),
      ),
    [layers, onLayersChange],
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
      if (result !== layersRef.current) onLayersChange(result);
    },
    [onLayersChange],
  );

  const handleInputDrop = useCallback(
    (
      sourceLayerId: string,
      inputId: string,
      targetLayerId: string,
      targetIndex: number,
    ) => {
      const result = applyMoveInput(
        layersRef.current,
        sourceLayerId,
        inputId,
        targetLayerId,
        targetIndex,
      );
      if (result !== layersRef.current) onLayersChange(result);
    },
    [onLayersChange],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <DropProvider>
      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>LAYERS</Text>
        </View>

        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {layers.map((layer, layerIndex) => {
            const ui = getUi(layer.id);
            return (
              <LayerRow
                key={layer.id}
                layer={layer}
                layerIndex={layerIndex}
                inputs={inputs}
                ui={ui}
                onLayerDrop={(data) =>
                  handleLayerDrop(data.layerId, layerIndex)
                }
                onInputDrop={(sourceLayerId, inputId, targetIndex) =>
                  handleInputDrop(sourceLayerId, inputId, layer.id, targetIndex)
                }
                onUiChange={(patch) => patchUi(layer.id, patch)}
                onBehaviorChange={(b) => setBehavior(layer.id, b)}
              />
            );
          })}

          {/* Drop zone to place a layer at the very end of the list */}
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
        </ScrollView>
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
    justifyContent: "center",
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
