import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useTransition,
} from "react";
import { View, StyleSheet } from "react-native";
import { Chip, useTheme } from "react-native-paper";
import { useLayoutStore } from "../../store/layoutStore";
import { useConnectionStore } from "../../store/connectionStore";
import { useInputsStore } from "../../store/inputsStore";
import { wsService } from "../../services/websocketService";
import { apiService } from "../../services/apiService";
import { TimelineInProgressOverlay } from "../../components/shared/TimelineInProgressOverlay";
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
import { areInputCardsEquivalent } from "../../utils/inputCardEquality";

// ─── Conversion helpers ───────────────────────────────────────────────────────

function colorFromId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (Math.imul(hash, 31) + id.charCodeAt(i)) | 0;
  }
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 55%, 45%)`;
}

const clampInt = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const toPixelInterval = (
  startCell: number,
  spanCells: number,
  totalCells: number,
  totalPx: number,
): { start: number; span: number } => {
  const safeTotalCells = Math.max(1, totalCells);
  const safeTotalPx = Math.max(1, totalPx);

  const start = clampInt(startCell, 0, Math.max(0, safeTotalCells - 1));
  const endCell = clampInt(
    start + Math.max(1, spanCells),
    start + 1,
    safeTotalCells,
  );

  const startPxValue = Math.round((start / safeTotalCells) * safeTotalPx);
  const endPxValue = Math.round((endCell / safeTotalCells) * safeTotalPx);

  return {
    start: startPxValue,
    span: Math.max(1, endPxValue - startPxValue),
  };
};

// Inverse of toPixelInterval: convert pixels back to grid cells
const toGridInterval = (
  startPx: number,
  spanPx: number,
  totalCells: number,
  totalPx: number,
): { startCell: number; spanCells: number } => {
  const safeTotalCells = Math.max(1, totalCells);
  const safeTotalPx = Math.max(1, totalPx);

  // Reverse calculation: pixels -> grid cells
  const startCell = clampInt(
    Math.round((startPx / safeTotalPx) * safeTotalCells),
    0,
    Math.max(0, safeTotalCells - 1),
  );
  const endPx = startPx + Math.max(1, spanPx);
  const endCell = clampInt(
    Math.round((endPx / safeTotalPx) * safeTotalCells),
    startCell + 1,
    safeTotalCells,
  );

  return {
    startCell,
    spanCells: Math.max(1, endCell - startCell),
  };
};

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
      const colInterval = toGridInterval(
        li.x,
        li.width,
        gridCols,
        resolution.width,
      );
      const rowInterval = toGridInterval(
        li.y,
        li.height,
        gridRows,
        resolution.height,
      );
      return {
        initial: {
          col: colInterval.startCell,
          row: rowInterval.startCell,
          width: colInterval.spanCells,
          height: rowInterval.spanCells,
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
    const horizontal = toPixelInterval(
      item.initial.col,
      item.initial.width,
      gridCols,
      resolution.width,
    );
    const vertical = toPixelInterval(
      item.initial.row,
      item.initial.height,
      gridRows,
      resolution.height,
    );

    return {
      inputId: item.props.id,
      x: horizontal.start,
      y: vertical.start,
      width: horizontal.span,
      height: vertical.span,
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
  const isTimelinePlaying = useConnectionStore((s) => s.isTimelinePlaying);
  const setTimelinePlaying = useConnectionStore((s) => s.setTimelinePlaying);
  const inputs = useInputsStore((s) => s.inputs);
  const setInputs = useInputsStore((s) => s.setInputs);

  const [layersPanelOpen, setLayersPanelOpen] = useState(false);
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [settingsPanelSide, setSettingsPanelSide] = useState<"left" | "right">(
    "right",
  );
  const [effectsPanelOpen, setEffectsPanelOpen] = useState(false);
  const [effectsInputId, setEffectsInputId] = useState<string | null>(null);
  const [layoutResetToken, setLayoutResetToken] = useState(0);

  const pendingEventRef = useRef<WSEventPayload<"room_updated"> | null>(null);
  const [, startTransition] = useTransition();
  const frameRef = useRef<number | null>(null);

  // Subscribe to server room updates
  useEffect(() => {
    const unsubRoom = wsService.on("room_updated", (event) => {
      pendingEventRef.current = event;

      if (frameRef.current !== null) return;
      frameRef.current = requestIdleCallback(() => {
        frameRef.current = null;
        const latest = pendingEventRef.current;
        pendingEventRef.current = null;
        if (!latest) return;

        startTransition(() => {
          if (latest.isTimelinePlaying !== undefined) {
            setTimelinePlaying(latest.isTimelinePlaying);
          }
          setLayers(latest.layers);

          const nextInputs = apiService.mapInputsToCards(latest.inputs);
          const currentInputs = useInputsStore.getState().inputs;
          if (!areInputCardsEquivalent(currentInputs, nextInputs)) {
            setInputs(nextInputs);
          }
        });
      });
    });

    const unsubDeleted = wsService.on("input_deleted", (event) => {
      removeInputFromLayers(event.inputId);
    });

    return () => {
      unsubRoom();
      unsubDeleted();
      if (frameRef.current !== null) {
        cancelIdleCallback(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [
    serverUrl,
    roomId,
    setLayers,
    setInputs,
    setTimelinePlaying,
    removeInputFromLayers,
  ]);

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
      try {
        console.log("[Layout] Pushing layers to server:", {
          layerCount: newLayers.length,
          firstLayerInputs: newLayers[0]?.inputs.length ?? 0,
          firstLayerInputIds:
            newLayers[0]?.inputs.map((li) => li.inputId).slice(0, 3) ?? [],
        });
        const correctedLayers = await apiService.updateLayers(
          serverUrl,
          roomId,
          newLayers,
        );
        console.log("[Layout] Server returned corrected layers:", {
          layerCount: correctedLayers.length,
          firstLayerInputs: correctedLayers[0]?.inputs.length ?? 0,
          // Log a few inputs to see if order changed
          firstLayerInputIds:
            correctedLayers[0]?.inputs.map((li) => li.inputId).slice(0, 3) ??
            [],
          changed:
            JSON.stringify(newLayers[0]?.inputs) !==
            JSON.stringify(correctedLayers[0]?.inputs),
        });
        // Apply the server's corrected layout immediately, don't wait for room_updated
        setLayers(correctedLayers);
      } catch (err) {
        console.warn("[Layout] Failed to push layer update:", err);
        setLayoutResetToken((value) => value + 1);
      }
    },
    [serverUrl, roomId, setLayers],
  );

  // Toggle visibility of all inputs in a layer (show/hide)
  const handleToggleLayerVisibility = useCallback(
    async (layerId: string, shouldShow: boolean) => {
      const layer = layers.find((l) => l.id === layerId);
      if (!layer) return;

      const inputIds = layer.inputs.map((li) => li.inputId);
      if (inputIds.length === 0) return;

      try {
        // Use batch API to hide/show all inputs at once
        if (shouldShow) {
          await apiService.batchShowInputs(serverUrl, roomId, inputIds);
        } else {
          await apiService.batchHideInputs(serverUrl, roomId, inputIds);
        }
      } catch (err) {
        console.warn(
          `[Layout] Failed to ${shouldShow ? "show" : "hide"} layer inputs:`,
          err,
        );
        // Propagate error so caller can rollback UI changes
        throw err;
      }
    },
    [layers, serverUrl, roomId],
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
      console.log("[Layout] Grid changed for layer:", {
        layerId,
        newInputOrder: newInputs.map((li) => li.inputId),
      });
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
      <View
        style={styles.screenContent}
        pointerEvents={isTimelinePlaying ? "none" : "auto"}
      >
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
                  key={`${layer.id}-${layoutResetToken}`}
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

      {isTimelinePlaying && <TimelineInProgressOverlay />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  screenContent: {
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
