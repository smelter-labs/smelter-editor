import React, { useState, useCallback, useEffect, useMemo } from "react";
import { View, StyleSheet, FlatList, Pressable } from "react-native";
import {
  ActivityIndicator,
  Chip,
  Surface,
  Text,
  useTheme,
} from "react-native-paper";
import type { BroadcastTile } from "@smelter-editor/types";
import { useBroadcastTiles } from "../../hooks/useBroadcastTiles";
import { BroadcastTileAdder } from "../../components/BroadcastTileAdder";
import { useInputsStore } from "../../store/inputsStore";
import { useLayoutStore } from "../../store/layoutStore";
import { useConnectionStore } from "../../store/connectionStore";
import { buildHttpUrl } from "../../services/apiService";
import { ScreenLabel } from "../../components/shared/ScreenLabel";
import {
  ScreenToolbar,
  ScreenToolbarChip,
  ToolbarIcon,
} from "../../components/shared/ScreenToolbar";
import { QRToolbarChip } from "../../components/shared/QRToolbarChip";

export function BroadcastModeScreen() {
  const theme = useTheme();
  const { serverUrl, roomId } = useConnectionStore();

  const [isAdderOpen, setIsAdderOpen] = useState(false);
  const [whepUrl, setWhepUrl] = useState("");
  const [isInitializing, setIsInitializing] = useState(true);

  const {
    tiles,
    selectedTileId,
    isBroadcastMode,
    isEditMode,
    isLoading,
    addTile,
    removeTile,
    selectTile,
    updateTileName,
    toggleEditMode,
    setBroadcastMode,
    syncWithServerState,
  } = useBroadcastTiles(serverUrl, roomId);

  useEffect(() => {
    let cancelled = false;
    const base = buildHttpUrl(serverUrl);
    const url = `${base}/room/${encodeURIComponent(roomId)}`;

    const fetchState = async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const data = (await res.json()) as {
          whepUrl?: string;
          broadcastTiles?: BroadcastTile[];
          selectedBroadcastTileId?: string | null;
          isBroadcastMode?: boolean;
        };
        if (cancelled) return;
        if (data.whepUrl) setWhepUrl(data.whepUrl);
        syncWithServerState(
          data.broadcastTiles ?? [],
          data.selectedBroadcastTileId ?? null,
          data.isBroadcastMode ?? false,
        );
      } catch (e) {
        console.error("BroadcastMode: fetch error", e);
      } finally {
        if (!cancelled) setIsInitializing(false);
      }
    };

    void fetchState();
    const interval = setInterval(fetchState, 3_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [serverUrl, roomId]);

  const rawInputs = useInputsStore((s) => s.inputs);
  const inputs = useMemo(
    () =>
      rawInputs.map((c) => ({
        inputId: c.id,
        title: c.name,
        type: c.isAudioOnly ? ("audio" as const) : ("video" as const),
      })),
    [rawInputs],
  );

  const rawLayers = useLayoutStore((s) => s.layers);
  const layers = useMemo(
    () => rawLayers.map((l) => ({ id: l.id, inputs: l.inputs })),
    [rawLayers],
  );

  useEffect(() => {
    tiles.forEach((tile) => {
      if (tile.type === "input") {
        const input = inputs.find((i) => i.inputId === tile.targetId);
        if (input && input.title !== tile.name)
          updateTileName(tile.id, input.title);
      }
    });
  }, [inputs, tiles, updateTileName]);

  const selectedTile = tiles.find((t) => t.id === selectedTileId);

  const handleAddTile = useCallback(
    async (type: "input" | "layer", targetId: string) => {
      const name =
        type === "input"
          ? (inputs.find((i) => i.inputId === targetId)?.title ?? targetId)
          : targetId;
      await addTile(type, targetId, name);
      setIsAdderOpen(false);
    },
    [inputs, addTile],
  );

  const renderTileItem = ({ item }: { item: BroadcastTile }) => {
    const isSelected = selectedTileId === item.id;
    return (
      <Pressable
        onPress={() => !isEditMode && selectTile(item.id)}
        style={styles.tileItemWrapper}
      >
        <Chip
          selected={isSelected}
          showSelectedOverlay
          onClose={isEditMode ? () => removeTile(item.id) : undefined}
          icon={item.type === "input" ? "video" : "layers"}
          style={[
            styles.tileChip,
            isSelected && { backgroundColor: theme.colors.primary },
          ]}
          textStyle={isSelected ? { color: theme.colors.onPrimary } : undefined}
        >
          {item.name}
        </Chip>
      </Pressable>
    );
  };

  if (isLoading || isInitializing) {
    return (
      <View
        style={[styles.container, { backgroundColor: theme.colors.background }]}
      >
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <ScreenLabel
        label={`Broadcast${tiles.length > 0 ? ` (${tiles.length})` : ""}`}
      />

      <ScreenToolbar style={styles.toolbar}>
        <ScreenToolbarChip
          onPress={() => setBroadcastMode(!isBroadcastMode)}
          disabled={!isBroadcastMode && !selectedTileId}
          style={
            isBroadcastMode
              ? { backgroundColor: theme.colors.error }
              : undefined
          }
        >
          {isBroadcastMode ? "IS LIVE" : "GO LIVE"}
        </ScreenToolbarChip>
        {tiles.length > 0 && (
          <ScreenToolbarChip onPress={toggleEditMode}>
            {isEditMode ? "DONE" : "EDIT"}
          </ScreenToolbarChip>
        )}
        <ScreenToolbarChip onPress={() => setIsAdderOpen(true)}>
          <ToolbarIcon name="plus" />
        </ScreenToolbarChip>
        <QRToolbarChip serverUrl={serverUrl} roomId={roomId} />
      </ScreenToolbar>

      {/* Main content */}
      <View style={styles.contentArea}>
        {tiles.length === 0 ? (
          <View style={styles.emptyState}>
            <Text
              variant="bodyLarge"
              style={{ color: theme.colors.onSurfaceVariant }}
            >
              No broadcast tiles added
            </Text>
            <Text
              variant="bodyMedium"
              style={{ color: theme.colors.onSurfaceVariant, marginTop: 4 }}
            >
              Tap + to add an input or layer
            </Text>
          </View>
        ) : selectedTile ? (
          <View style={styles.videoContainer}>
            <Surface style={styles.videoPlaceholder} elevation={1}>
              <Text
                variant="bodyLarge"
                style={{ color: theme.colors.onSurface }}
              >
                Video Stream
              </Text>
              <Text
                variant="bodySmall"
                style={{
                  color: theme.colors.onSurfaceVariant,
                  marginTop: 8,
                }}
              >
                WHEP URL: {whepUrl || "—"}
              </Text>
            </Surface>
            <Surface style={styles.tileLabel} elevation={3}>
              <Text
                variant="labelMedium"
                style={{ color: theme.colors.onSurface }}
              >
                {selectedTile.type === "input" ? "Input" : "Layer"} ·{" "}
                {selectedTile.name}
              </Text>
            </Surface>
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Text
              variant="bodyLarge"
              style={{ color: theme.colors.onSurfaceVariant }}
            >
              Select a tile to preview
            </Text>
          </View>
        )}
      </View>

      {/* Tile bar */}
      {tiles.length > 0 && (
        <Surface style={styles.tileBar} elevation={2}>
          <FlatList
            data={tiles}
            renderItem={renderTileItem}
            keyExtractor={(item) => item.id}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tileListContent}
          />
        </Surface>
      )}

      <BroadcastTileAdder
        isOpen={isAdderOpen}
        inputs={inputs}
        layers={layers}
        existingTileTargets={
          new Set(tiles.map((t) => `${t.type}-${t.targetId}`))
        }
        onAddTile={handleAddTile}
        onClose={() => setIsAdderOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    height: 36,
    paddingHorizontal: 8,
    gap: 8,
  },
  contentArea: { flex: 1 },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 4,
  },
  videoContainer: { flex: 1, position: "relative" },
  videoPlaceholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    margin: 0,
    borderRadius: 0,
  },
  tileLabel: {
    position: "absolute",
    top: 12,
    left: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  tileBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "transparent",
  },
  tileListContent: { paddingHorizontal: 4, gap: 8 },
  tileItemWrapper: { flexShrink: 0 },
  tileChip: { height: 36 },
});
