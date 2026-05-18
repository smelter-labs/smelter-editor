import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
  FlatList,
  Pressable,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import type { BroadcastTile } from "@smelter-editor/types";
import { useBroadcastTiles } from "../../hooks/useBroadcastTiles";
import BroadcastTileAdder from "../../components/BroadcastTileAdder";
import { useInputsStore } from "../../store/inputsStore";
import { useLayoutStore } from "../../store/layoutStore";
import { buildHttpUrl } from "../../services/apiService";
import type {
  RootStackParamList,
  RootNavigationProp,
} from "../../navigation/navigationTypes";

type Props = NativeStackScreenProps<RootStackParamList, "BroadcastMode">;

export default function BroadcastModeScreen({ route }: Props) {
  const { serverUrl, roomId } = route.params;
  const navigation = useNavigation<RootNavigationProp>();
  const inputsStore = useInputsStore();
  const layoutStore = useLayoutStore();

  const [isAdderOpen, setIsAdderOpen] = useState(false);
  const [whepUrl, setWhepUrl] = useState("");
  const [isInitializing, setIsInitializing] = useState(true);

  const {
    tiles,
    selectedTileId,
    isEditMode,
    isLoading,
    addTile,
    removeTile,
    selectTile,
    updateTileName,
    toggleEditMode,
    syncWithServerState,
  } = useBroadcastTiles(serverUrl, roomId);

  // Fetch room state and poll for broadcast tile updates
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
        };
        if (cancelled) return;
        if (data.whepUrl) setWhepUrl(data.whepUrl);
        syncWithServerState(
          data.broadcastTiles ?? [],
          data.selectedBroadcastTileId ?? null,
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

  // Derive inputs/layers from Zustand stores (already kept in sync by main WS)
  const inputs = inputsStore.inputs.map((c) => ({
    inputId: c.id,
    title: c.name,
    type: c.isAudioOnly ? "audio" : "video",
  }));
  const layers = layoutStore.layers.map((l) => ({
    id: l.id,
    inputs: l.inputs,
  }));

  // Keep tile display names in sync with store changes
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
        style={[
          styles.tileItem,
          isSelected ? styles.tileItemSelected : styles.tileItemDefault,
        ]}
        onPress={() => !isEditMode && selectTile(item.id)}
      >
        <Text style={styles.tileIcon}>
          {item.type === "input" ? "🎬" : "🎞️"}
        </Text>
        <Text style={styles.tileName} numberOfLines={1}>
          {item.name}
        </Text>
        {isEditMode && (
          <Pressable
            style={styles.deleteButton}
            onPress={() => removeTile(item.id)}
          >
            <Text style={styles.deleteButtonText}>×</Text>
          </Pressable>
        )}
      </Pressable>
    );
  };

  if (isLoading || isInitializing) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color="#fff" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Text style={styles.backButtonText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Broadcast Mode</Text>
        {tiles.length > 0 && (
          <Pressable
            style={[styles.editButton, isEditMode && styles.editButtonActive]}
            onPress={toggleEditMode}
          >
            <Text style={styles.editButtonText}>
              {isEditMode ? "Done" : "Edit"}
            </Text>
          </Pressable>
        )}
      </View>

      <View style={styles.contentArea}>
        {tiles.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>No broadcast tiles added</Text>
            <Pressable
              style={styles.addButton}
              onPress={() => setIsAdderOpen(true)}
            >
              <Text style={styles.addButtonText}>+ Add Tile</Text>
            </Pressable>
          </View>
        ) : selectedTile ? (
          <View style={styles.videoContainer}>
            {/* TODO: replace with RTCView once react-native-webrtc is integrated */}
            <View style={styles.video}>
              <Text style={styles.videoPlaceholder}>Video Stream</Text>
              <Text style={styles.videoSubtext}>WHEP URL: {whepUrl}</Text>
            </View>
            <View style={styles.tileLabel}>
              <Text style={styles.tileLabelText}>
                {selectedTile.type === "input" ? "🎬" : "🎞️"}{" "}
                {selectedTile.name}
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>Select a tile to preview</Text>
            <Pressable
              style={styles.addButton}
              onPress={() => selectTile(tiles[0]?.id ?? null)}
            >
              <Text style={styles.addButtonText}>Select First Tile</Text>
            </Pressable>
          </View>
        )}
      </View>

      {tiles.length > 0 && (
        <View style={styles.tileBar}>
          <FlatList
            data={tiles}
            renderItem={renderTileItem}
            keyExtractor={(item) => item.id}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tileListContent}
          />
          <Pressable
            style={styles.addTileButton}
            onPress={() => setIsAdderOpen(true)}
          >
            <Text style={styles.addTileButtonText}>+</Text>
          </Pressable>
        </View>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#1a1a1a",
    borderBottomWidth: 1,
    borderBottomColor: "#333",
  },
  backButton: { paddingHorizontal: 8, paddingVertical: 6 },
  backButtonText: { fontSize: 16, color: "#0066ff", fontWeight: "500" },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
    flex: 1,
    textAlign: "center",
  },
  editButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#666",
  },
  editButtonActive: { backgroundColor: "#0066ff", borderColor: "#0066ff" },
  editButtonText: { fontSize: 14, color: "#fff", fontWeight: "500" },
  contentArea: { flex: 1, backgroundColor: "#000" },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
  },
  emptyStateText: { fontSize: 16, color: "#999" },
  videoContainer: { flex: 1, backgroundColor: "#000", position: "relative" },
  video: { flex: 1, justifyContent: "center", alignItems: "center" },
  videoPlaceholder: { color: "#fff", textAlign: "center" },
  videoSubtext: {
    color: "#999",
    textAlign: "center",
    marginTop: 20,
    fontSize: 12,
  },
  tileLabel: {
    position: "absolute",
    top: 12,
    left: 12,
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
  },
  tileLabelText: { fontSize: 12, color: "#fff", fontWeight: "500" },
  tileBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 8,
    backgroundColor: "#1a1a1a",
    borderTopWidth: 1,
    borderTopColor: "#333",
    gap: 8,
  },
  tileListContent: { paddingHorizontal: 4, gap: 8 },
  tileItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 4,
    minHeight: 40,
  },
  tileItemDefault: { backgroundColor: "#333" },
  tileItemSelected: { backgroundColor: "#0066ff" },
  tileIcon: { fontSize: 16 },
  tileName: { fontSize: 12, color: "#fff", fontWeight: "500", maxWidth: 100 },
  deleteButton: {
    marginLeft: 6,
    width: 20,
    height: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  deleteButtonText: { fontSize: 16, color: "#fff", fontWeight: "bold" },
  addButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#0066ff",
    borderRadius: 4,
  },
  addButtonText: { fontSize: 14, color: "#fff", fontWeight: "600" },
  addTileButton: {
    width: 40,
    height: 40,
    backgroundColor: "#333",
    borderRadius: 4,
    justifyContent: "center",
    alignItems: "center",
  },
  addTileButtonText: { fontSize: 20, color: "#fff", fontWeight: "bold" },
});
