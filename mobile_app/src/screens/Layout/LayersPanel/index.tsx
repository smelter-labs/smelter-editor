import React, { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";
import type { Layer, LayerBehaviorConfig } from "../../../types/layout";
import type { InputCard } from "../../../types/input";
import { Layer as LayerComponent } from "./Layer";
import { applyMoveLayer, applyMoveInput } from "./LayerRow";
import type { LayerUiState } from "./LayerRow";

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
    (layerId: string, behavior: LayerBehaviorConfig | undefined) =>
      onLayersChange(
        layers.map((l) => (l.id === layerId ? { ...l, behavior } : l)),
      ),
    [layers, onLayersChange],
  );

  const handleLayerMoveBy = useCallback(
    (layerId: string, delta: -1 | 1) => {
      const currentIndex = layersRef.current.findIndex((l) => l.id === layerId);
      if (currentIndex === -1) return;

      const targetIndex = Math.max(
        0,
        Math.min(layersRef.current.length - 1, currentIndex + delta),
      );
      if (targetIndex === currentIndex) return;

      const result = applyMoveLayer(layersRef.current, layerId, targetIndex);
      if (result !== layersRef.current) {
        onLayersChange(result);
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
              canMoveUp={layerIndex > 0}
              canMoveDown={layerIndex < layers.length - 1}
              allLayers={layers}
              onInputMove={(layerId, inputId, from, to) =>
                handleInputMove(layerId, inputId, from, to)
              }
              onInputMoveLayer={(inputId, fromLayerId, toLayerId) =>
                handleInputMoveLayer(inputId, fromLayerId, toLayerId)
              }
              onUiChange={(patch) => patchUi(layer.id, patch)}
              onBehaviorChange={(b) => setBehavior(layer.id, b)}
              onMoveUp={() => handleLayerMoveBy(layer.id, -1)}
              onMoveDown={() => handleLayerMoveBy(layer.id, 1)}
              onToggleLayerVisibility={onToggleLayerVisibility}
              onDeleteLayer={onDeleteLayer}
            />
          );
        }}
      />
    </View>
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
});
