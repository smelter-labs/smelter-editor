import React, { useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Draggable, Sortable, SortableItem } from "react-native-reanimated-dnd";
import * as Haptics from "expo-haptics";
import type { Layer, LayerBehaviorConfig } from "../../../types/layout";
import type { InputCard } from "../../../types/input";
import { LayerHeader } from "./LayerHeader";
import { InputRow } from "./InputRow";
import { BehaviorSelector } from "./BehaviorSelector";
import type { LayerDragData, LayerUiState } from "./LayerRow";

// ─── Theme ───────────────────────────────────────────────────────────────────

const C = {
  layerBg: "#2D2D2D",
  layerBorder: "#3A3A3A",
  itemBg: "#262626",
  textDim: "#777777",
  accent: "#4D9DE0",
};

const INPUT_HEIGHT = 44;

// ─── LayerComponent ──────────────────────────────────────────────────────────

export interface LayerComponentProps {
  layer: Layer;
  inputs: InputCard[];
  ui: LayerUiState;
  allLayers: Layer[];
  onInputMove: (
    layerId: string,
    inputId: string,
    fromIndex: number,
    toIndex: number,
  ) => void;
  onInputMoveLayer: (
    inputId: string,
    fromLayerId: string,
    toLayerId: string,
  ) => void;
  onUiChange: (patch: Partial<LayerUiState>) => void;
  onBehaviorChange: (behavior: LayerBehaviorConfig | undefined) => void;
  onLayerDrop: (data: LayerDragData) => void;
  onToggleLayerVisibility?: (
    layerId: string,
    shouldShow: boolean,
  ) => Promise<void>;
  onDeleteLayer?: (layerId: string) => void;
}

export function Layer({
  layer,
  inputs,
  ui,
  allLayers,
  onInputMove,
  onInputMoveLayer,
  onUiChange,
  onBehaviorChange,
  onLayerDrop,
  onToggleLayerVisibility,
  onDeleteLayer,
}: LayerComponentProps) {
  // Create sortable items from layer inputs
  const sortableInputs = layer.inputs.map((input) => ({
    id: input.inputId,
    inputId: input.inputId,
  }));

  const handleInputMove = useCallback(
    (id: string, from: number, to: number) => {
      onInputMove(layer.id, id, from, to);
    },
    [layer.id, onInputMove],
  );

  const renderInputItem = useCallback(
    ({ item, ...props }: any) => (
      <SortableItem
        key={item.id}
        id={item.id}
        data={item}
        onMove={(id, from, to) => handleInputMove(id, from, to)}
        onDragStart={() =>
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
        }
        {...props}
      >
        <InputRow
          inputId={item.inputId}
          sourceLayerId={layer.id}
          inputs={inputs}
          layers={allLayers}
          dimmed={!ui.isVisible}
          onMoveToLayer={onInputMoveLayer}
        />
      </SortableItem>
    ),
    [
      layer.id,
      inputs,
      allLayers,
      ui.isVisible,
      handleInputMove,
      onInputMoveLayer,
    ],
  );

  const handleToggleVisible = useCallback(async () => {
    const newVisibility = !ui.isVisible;
    // Update UI state immediately for visual feedback
    onUiChange({ isVisible: newVisibility });
    // Call the visibility toggle API if provided
    if (onToggleLayerVisibility) {
      try {
        await onToggleLayerVisibility(layer.id, newVisibility);
      } catch (err) {
        // Rollback UI state on error
        onUiChange({ isVisible: !newVisibility });
        console.warn("[Layer] Failed to toggle visibility:", err);
      }
    }
  }, [ui.isVisible, layer.id, onUiChange, onToggleLayerVisibility]);

  return (
    <View style={styles.container}>
      {/* Layer header — draggable */}
      <Draggable<LayerDragData>
        draggableId={`layer-${layer.id}`}
        data={{ type: "layer", layerId: layer.id }}
        dragAxis="y"
        preDragDelay={140}
        collisionAlgorithm="center"
      >
        <LayerHeader
          name={ui.name}
          isVisible={ui.isVisible}
          isCollapsed={ui.isCollapsed}
          onToggleCollapse={() => onUiChange({ isCollapsed: !ui.isCollapsed })}
          onToggleVisible={handleToggleVisible}
          onNameChange={(name) => onUiChange({ name })}
          isEmpty={layer.inputs.length === 0}
          onDelete={onDeleteLayer ? () => onDeleteLayer(layer.id) : undefined}
        />
      </Draggable>

      {/* Behavior selector */}
      {!ui.isCollapsed && (
        <BehaviorSelector
          behavior={layer.behavior}
          onChange={onBehaviorChange}
        />
      )}

      {/* Inputs sortable list */}
      {!ui.isCollapsed && (
        <>
          {layer.inputs.length > 0 ? (
            <Sortable
              data={sortableInputs}
              renderItem={renderInputItem}
              itemHeight={INPUT_HEIGHT}
              style={styles.inputsList}
            />
          ) : (
            <View style={styles.emptyInputsZone}>
              <Text style={styles.emptyHint}>No inputs</Text>
            </View>
          )}
        </>
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    borderBottomColor: C.layerBorder,
  },
  inputsList: {
    backgroundColor: C.itemBg,
  },
  emptyInputsZone: {
    height: 48,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: C.itemBg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.layerBorder,
  },
  emptyHint: {
    color: C.textDim,
    fontSize: 12,
  },
});
