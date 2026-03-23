import React, { useState, useEffect, useCallback, useMemo } from "react";
import { View, StyleSheet, Pressable, Text } from "react-native";
import { useTheme } from "react-native-paper";
import { useLayoutStore } from "../../store/layoutStore";
import { useConnectionStore } from "../../store/connectionStore";
import { useInputsStore } from "../../store/inputsStore";
import { wsService } from "../../services/websocketService";
import { apiService } from "../../services/apiService";
import { SidePanel } from "../../components/shared/SidePanel";
import { SettingsPanel } from "./SettingsPanel";
import { ScreenLabel } from "../../components/shared/ScreenLabel";
import ReshufflableGridWrapper from "./ReshufflableGridWrapper";
import GridCell from "./GridCell";
import LayersPanel from "./LayersPanel";
import type { LayerItemProps } from "./dnd/types";
import type { ItemData } from "./ReshufflableGridWrapper";
import type { Layer, LayerInput } from "../../types/layout";
import type { Resolution } from "@smelter-editor/types";

// ─── Conversion helpers ───────────────────────────────────────────────────────

function colorFromId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (Math.imul(hash, 31) + id.charCodeAt(i)) | 0;
  }
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 55%, 45%)`;
}

function layerInputsToItemData(
  layerInputs: LayerInput[],
  inputs: { id: string; name: string; isHidden: boolean }[],
  resolution: Resolution,
  gridCols: number,
  gridRows: number,
): ItemData<LayerItemProps>[] {
  const inputMap = new Map(inputs.map((i) => [i.id, i]));
  return layerInputs.map((li) => {
    const input = inputMap.get(li.inputId);
    return {
      initial: {
        col: Math.max(
          0,
          Math.min(
            gridCols - 1,
            Math.round((li.x / resolution.width) * gridCols),
          ),
        ),
        row: Math.max(
          0,
          Math.min(
            gridRows - 1,
            Math.round((li.y / resolution.height) * gridRows),
          ),
        ),
        width: Math.max(
          1,
          Math.min(
            gridCols,
            Math.round((li.width / resolution.width) * gridCols),
          ),
        ),
        height: Math.max(
          1,
          Math.min(
            gridRows,
            Math.round((li.height / resolution.height) * gridRows),
          ),
        ),
      },
      props: {
        id: li.inputId,
        name: input?.name ?? li.inputId,
        color: colorFromId(li.inputId),
        isVisible: !(input?.isHidden ?? false),
      },
    };
  });
}

function itemDataToLayerInputs(
  items: ItemData<LayerItemProps>[],
  resolution: Resolution,
  gridCols: number,
  gridRows: number,
  existingInputs: LayerInput[],
): LayerInput[] {
  const existingMap = new Map(existingInputs.map((i) => [i.inputId, i]));
  return items.map((item) => {
    const existing = existingMap.get(item.props.id);
    return {
      inputId: item.props.id,
      x: Math.round((item.initial.col / gridCols) * resolution.width),
      y: Math.round((item.initial.row / gridRows) * resolution.height),
      width: Math.round((item.initial.width / gridCols) * resolution.width),
      height: Math.round(
        (item.initial.height / gridRows) * resolution.height,
      ),
      transitionDurationMs: existing?.transitionDurationMs,
      transitionEasing: existing?.transitionEasing,
    };
  });
}

// ─── LayoutScreen ─────────────────────────────────────────────────────────────

export function LayoutScreen() {
  const theme = useTheme();
  const { layers, setLayers, resolution, columns, rows } = useLayoutStore();
  const { serverUrl, roomId } = useConnectionStore();
  const inputs = useInputsStore((s) => s.inputs);

  const [layersPanelOpen, setLayersPanelOpen] = useState(false);
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [settingsPanelSide, setSettingsPanelSide] = useState<"left" | "right">(
    "right",
  );

  // Subscribe to server room updates
  useEffect(() => {
    const unsubRoom = wsService.on("room_updated", async () => {
      try {
        const { layers: updatedLayers } = await apiService.fetchRoomState(
          serverUrl,
          roomId,
        );
        setLayers(updatedLayers);
      } catch (err) {
        console.warn("[Layout] Failed to refresh layers on room_updated:", err);
      }
    });
    return () => {
      unsubRoom();
    };
  }, [serverUrl, roomId, setLayers]);

  // Push updated layers to server
  const pushLayers = useCallback(
    async (newLayers: Layer[]) => {
      setLayers(newLayers);
      try {
        await apiService.updateLayers(serverUrl, roomId, newLayers);
      } catch (err) {
        console.warn("[Layout] Failed to push layer update:", err);
      }
    },
    [serverUrl, roomId, setLayers],
  );

  // Handle grid item position change for a specific layer
  const handleGridChange = useCallback(
    (layerId: string, items: ItemData<LayerItemProps>[]) => {
      const layerIndex = layers.findIndex((l) => l.id === layerId);
      if (layerIndex === -1) return;

      const existingInputs = layers[layerIndex].inputs;
      const newInputs = itemDataToLayerInputs(
        items,
        resolution,
        columns,
        rows,
        existingInputs,
      );
      const newLayers = layers.map((l, i) =>
        i === layerIndex ? { ...l, inputs: newInputs } : l,
      );
      void pushLayers(newLayers);
    },
    [layers, resolution, columns, rows, pushLayers],
  );

  // Memoize item data per layer to avoid unnecessary re-renders
  const layerItemDataMap = useMemo(() => {
    const map = new Map<string, ItemData<LayerItemProps>[]>();
    for (const layer of layers) {
      map.set(
        layer.id,
        layerInputsToItemData(layer.inputs, inputs, resolution, columns, rows),
      );
    }
    return map;
  }, [layers, inputs, resolution, columns, rows]);

  return (
    <View
      style={[styles.root, { backgroundColor: theme.colors.background }]}
    >
      <ScreenLabel label={`Layout (${layers.length} layers)`} />

      {/* Toolbar row */}
      <View style={styles.toolbar}>
        <Pressable
          style={styles.toolbarBtn}
          onPress={() => setLayersPanelOpen((v) => !v)}
        >
          <Text style={styles.toolbarBtnText}>LAYERS</Text>
        </Pressable>
        <Pressable
          style={styles.toolbarBtn}
          onPress={() => {
            setSettingsPanelSide("right");
            setSettingsPanelOpen(true);
          }}
        >
          <Text style={styles.toolbarBtnText}>⚙</Text>
        </Pressable>
      </View>

      {/* Canvas: stacked layer grids (bottom layer rendered first) */}
      <View style={styles.canvas}>
        {[...layers].reverse().map((layer) => {
          const itemData = layerItemDataMap.get(layer.id) ?? [];
          return (
            <View
              key={layer.id}
              style={StyleSheet.absoluteFillObject}
              pointerEvents="box-none"
            >
              <ReshufflableGridWrapper
                itemData={itemData}
                renderedComponent={GridCell}
                onItemChange={(items) => handleGridChange(layer.id, items)}
                rows={rows}
                columns={columns}
                containerStyle={styles.layerGrid}
              />
            </View>
          );
        })}
      </View>

      {/* Layers panel — slide-in from right */}
      <SidePanel
        isVisible={layersPanelOpen}
        side="right"
        width={272}
        onClose={() => setLayersPanelOpen(false)}
      >
        <LayersPanel
          layers={layers}
          inputs={inputs}
          onLayersChange={(newLayers) => void pushLayers(newLayers)}
        />
      </SidePanel>

      {/* Settings panel */}
      <SettingsPanel
        isVisible={settingsPanelOpen}
        side={settingsPanelSide}
        onClose={() => setSettingsPanelOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    height: 36,
    paddingHorizontal: 8,
    gap: 8,
  },
  toolbarBtn: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  toolbarBtnText: {
    color: "#CCCCCC",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
  },
  canvas: {
    flex: 1,
  },
  layerGrid: {
    flex: 1,
    padding: 0,
    backgroundColor: "transparent",
  },
});
