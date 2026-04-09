import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { View, StyleSheet } from "react-native";
import { Chip, useTheme } from "react-native-paper";
import { useLayoutStore } from "../../store/layoutStore";
import { useConnectionStore } from "../../store/connectionStore";
import { useInputsStore } from "../../store/inputsStore";
import { wsService } from "../../services/websocketService";
import { apiService } from "../../services/apiService";
import { SidePanel } from "../../components/shared/SidePanel";
import { SettingsPanel } from "./SettingsPanel";
import { LayoutEffectsPanel } from "./LayoutEffectsPanel";
import { ScreenLabel } from "../../components/shared/ScreenLabel";
import ReshufflableGridWrapper from "./ReshufflableGridWrapper";
import GridCell from "./GridCell";
import LayersPanel from "./LayersPanel";
import type { ItemData } from "./ReshufflableGridWrapper";
import type { LayerItemProps } from "./types";
import type { Layer, LayerInput } from "../../types/layout";
import type { Resolution } from "@smelter-editor/types";
import type { WSEventPayload } from "../../types/websocket";

const areInputCardsEquivalent = (
  first: ReturnType<typeof useInputsStore.getState>["inputs"],
  second: ReturnType<typeof useInputsStore.getState>["inputs"],
): boolean => {
  if (first === second) return true;
  if (first.length !== second.length) return false;

  for (let index = 0; index < first.length; index += 1) {
    const a = first[index];
    const b = second[index];
    if (!b) return false;
    if (
      a.id !== b.id ||
      a.name !== b.name ||
      a.isHidden !== b.isHidden ||
      a.nativeWidth !== b.nativeWidth ||
      a.nativeHeight !== b.nativeHeight ||
      a.isRunning !== b.isRunning ||
      a.isMuted !== b.isMuted ||
      a.inputVolume !== b.inputVolume
    ) {
      return false;
    }
  }

  return true;
};

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
  inputs: {
    id: string;
    name: string;
    isHidden: boolean;
    nativeWidth?: number;
    nativeHeight?: number;
  }[],
  resolution: Resolution,
  gridCols: number,
  gridRows: number,
): ItemData<LayerItemProps>[] {
  const inputMap = new Map(inputs.map((i) => [i.id, i]));
  return layerInputs
    .filter((li) => {
      const input = inputMap.get(li.inputId);
      return !input?.isHidden; // Filter out hidden inputs
    })
    .map((li) => {
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
          isVisible: true, // All items in itemData are visible at this point
          nativeWidth: input?.nativeWidth,
          nativeHeight: input?.nativeHeight,
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
      height: Math.round((item.initial.height / gridRows) * resolution.height),
      transitionDurationMs: existing?.transitionDurationMs,
      transitionEasing: existing?.transitionEasing,
    };
  });
}

// ─── LayoutScreen ─────────────────────────────────────────────────────────────

export function LayoutScreen() {
  const theme = useTheme();
  const {
    layers,
    setLayers,
    resolution,
    columns,
    rows,
    removeInputFromLayers,
  } = useLayoutStore();
  const { serverUrl, roomId } = useConnectionStore();
  const inputs = useInputsStore((s) => s.inputs);
  const setInputs = useInputsStore((s) => s.setInputs);

  const [layersPanelOpen, setLayersPanelOpen] = useState(false);
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [settingsPanelSide, setSettingsPanelSide] = useState<"left" | "right">(
    "right",
  );
  const [effectsPanelOpen, setEffectsPanelOpen] = useState(false);
  const [effectsInputId, setEffectsInputId] = useState<string | null>(null);

  // Hold latest room_updated payload and apply at most once per animation frame.
  const pendingEventRef = useRef<WSEventPayload<"room_updated"> | null>(null);
  const frameRef = useRef<number | null>(null);

  // Subscribe to server room updates
  useEffect(() => {
    const unsubRoom = wsService.on("room_updated", (event) => {
      pendingEventRef.current = event;
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const latest = pendingEventRef.current;
        pendingEventRef.current = null;
        if (!latest) return;
        setLayers(latest.layers);
        const nextInputs = apiService.mapInputsToCards(latest.inputs);
        const currentInputs = useInputsStore.getState().inputs;
        if (!areInputCardsEquivalent(currentInputs, nextInputs)) {
          setInputs(nextInputs);
        }
      });
    });

    // When an input is deleted, remove it from the layout immediately so the grid
    // cell doesn't linger as a UUID-labelled rectangle.
    const unsubDeleted = wsService.on("input_deleted", (event) => {
      removeInputFromLayers(event.inputId);
    });

    return () => {
      unsubRoom();
      unsubDeleted();
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [serverUrl, roomId, setLayers, setInputs, removeInputFromLayers]);

  useEffect(() => {
    if (!effectsInputId) return;
    if (!inputs.some((input) => input.id === effectsInputId)) {
      setEffectsPanelOpen(false);
      setEffectsInputId(null);
    }
  }, [effectsInputId, inputs]);

  // Push updated layers to server
  const pushLayers = useCallback(
    async (newLayers: Layer[]) => {
      const previousLayers = layers;
      setLayers(newLayers); // optimistic
      try {
        // The POST response now includes the server-authoritative layers.
        // Apply them immediately so any server-side recomputation (e.g.
        // behaviour-driven corrections) is visible without a second round-trip.
        const confirmedLayers = await apiService.updateLayers(
          serverUrl,
          roomId,
          newLayers,
        );
        setLayers(confirmedLayers);
      } catch (err) {
        console.warn("[Layout] Failed to push layer update:", err);
        setLayers(previousLayers);
      }
    },
    [layers, serverUrl, roomId, setLayers],
  );

  // Toggle visibility of all inputs in a layer (show/hide)
  const handleToggleLayerVisibility = useCallback(
    async (layerId: string, shouldShow: boolean) => {
      const layer = layers.find((l) => l.id === layerId);
      if (!layer) return;

      try {
        // Call hideInput or showInput for each input in the layer
        const promises = layer.inputs.map((li) =>
          shouldShow
            ? apiService.showInput(serverUrl, roomId, li.inputId)
            : apiService.hideInput(serverUrl, roomId, li.inputId),
        );
        await Promise.all(promises);

        // Update local inputs state to reflect visibility changes
        const updatedInputs = inputs.map((input) =>
          layer.inputs.some((li) => li.inputId === input.id)
            ? { ...input, isHidden: !shouldShow }
            : input,
        );
        setInputs(updatedInputs);
      } catch (err) {
        console.warn(
          `[Layout] Failed to ${shouldShow ? "show" : "hide"} layer inputs:`,
          err,
        );
      }
    },
    [layers, inputs, serverUrl, roomId, setInputs],
  );

  // Add a new empty layer
  const handleAddLayer = useCallback(() => {
    const newLayer: Layer = {
      id: `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      inputs: [],
    };
    const newLayers = [...layers, newLayer];
    void pushLayers(newLayers);
  }, [layers, pushLayers]);

  // Delete an empty layer
  const handleDeleteLayer = useCallback(
    (layerId: string) => {
      const layer = layers.find((l) => l.id === layerId);
      if (!layer || layer.inputs.length > 0) {
        console.warn("[Layout] Cannot delete non-empty layer");
        return;
      }
      const newLayers = layers.filter((l) => l.id !== layerId);
      void pushLayers(newLayers);
    },
    [layers, pushLayers],
  );

  // Handle grid item position change for a specific layer
  const handleGridChange = useCallback(
    (layerId: string, items: ItemData<LayerItemProps>[]) => {
      const layerIndex = layers.findIndex((l) => l.id === layerId);
      if (layerIndex === -1) return;

      const existingInputs = layers[layerIndex].inputs;

      // Sort items by their visual position (row-major) so the resulting
      // LayerInput array order reflects where the user placed each tile.
      // Behavior algorithms (equal-grid, PiP, etc.) derive slot assignments
      // from array index, so without this sort a drag only changes pixel
      // coordinates that the server immediately discards and recomputes.
      const sortedItems = [...items].sort((a, b) => {
        if (a.initial.row !== b.initial.row)
          return a.initial.row - b.initial.row;
        return a.initial.col - b.initial.col;
      });

      const newInputs = itemDataToLayerInputs(
        sortedItems,
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
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <ScreenLabel label={`Layout (${layers.length} layers)`} />

      {/* Toolbar row */}
      <View style={styles.toolbar}>
        <Chip
          compact
          mode="flat"
          style={styles.toolbarChip}
          textStyle={styles.toolbarChipText}
          onPress={() => setLayersPanelOpen((v) => !v)}
        >
          LAYERS
        </Chip>
        <Chip
          compact
          mode="flat"
          style={styles.toolbarChip}
          textStyle={styles.toolbarChipText}
          onPress={() => {
            setSettingsPanelSide("right");
            setSettingsPanelOpen(true);
          }}
        >
          ⚙
        </Chip>
      </View>

      {/* Canvas: stacked layer grids — layers[0] is topmost (highest zIndex) */}
      <View style={styles.canvas}>
        {layers.map((layer, i) => {
          // Skip rendering layer if all its inputs are hidden
          const layerInputIds = layer.inputs.map((li) => li.inputId);
          const allInputsHidden =
            layerInputIds.length > 0 &&
            layerInputIds.every((id) =>
              inputs.some((inp) => inp.id === id && inp.isHidden),
            );
          if (allInputsHidden) return null;

          const itemData = layerItemDataMap.get(layer.id) ?? [];
          return (
            <View
              key={layer.id}
              style={[
                StyleSheet.absoluteFillObject,
                { zIndex: layers.length - i },
              ]}
              pointerEvents="box-none"
            >
              <ReshufflableGridWrapper
                itemData={itemData}
                renderedComponent={GridCell}
                onItemChange={(items) => handleGridChange(layer.id, items)}
                onItemLongPress={(itemId) => {
                  setEffectsInputId(itemId);
                  setEffectsPanelOpen(true);
                }}
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
          onToggleLayerVisibility={handleToggleLayerVisibility}
          onAddLayer={handleAddLayer}
          onDeleteLayer={handleDeleteLayer}
        />
      </SidePanel>

      {/* Settings panel */}
      <SettingsPanel
        isVisible={settingsPanelOpen}
        side={settingsPanelSide}
        onClose={() => setSettingsPanelOpen(false)}
      />

      <LayoutEffectsPanel
        isVisible={effectsPanelOpen}
        inputId={effectsInputId}
        onClose={() => setEffectsPanelOpen(false)}
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
  toolbarChip: {
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  toolbarChipText: {
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
