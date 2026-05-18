import { useState, useCallback, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { BroadcastTile } from "@smelter-editor/types";
import { buildHttpUrl } from "../services/apiService";

const STORAGE_KEY_PREFIX = "broadcast-tiles";

type BroadcastTilesState = {
  tiles: BroadcastTile[];
  selectedTileId: string | null;
};

export function useBroadcastTiles(serverUrl: string, roomId: string) {
  const [tiles, setTiles] = useState<BroadcastTile[]>([]);
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const storageKey = `${STORAGE_KEY_PREFIX}-${serverUrl}-${roomId}`;

  useEffect(() => {
    AsyncStorage.getItem(storageKey)
      .then((cached) => {
        if (cached) {
          const parsed = JSON.parse(cached) as BroadcastTilesState;
          setTiles(parsed.tiles ?? []);
          setSelectedTileId(parsed.selectedTileId ?? null);
        }
      })
      .catch((e) => console.error("useBroadcastTiles: load error", e))
      .finally(() => setIsLoading(false));
  }, [storageKey]);

  const saveToStorage = useCallback(
    (newTiles: BroadcastTile[], newSelectedId: string | null) => {
      const data: BroadcastTilesState = {
        tiles: newTiles,
        selectedTileId: newSelectedId,
      };
      AsyncStorage.setItem(storageKey, JSON.stringify(data)).catch((e) =>
        console.error("useBroadcastTiles: save error", e),
      );
    },
    [storageKey],
  );

  const syncWithServerState = useCallback(
    (serverTiles: BroadcastTile[], serverSelectedId: string | null) => {
      setTiles(serverTiles);
      setSelectedTileId(serverSelectedId);
      saveToStorage(serverTiles, serverSelectedId);
    },
    [saveToStorage],
  );

  const post = useCallback(
    async (path: string, body: Record<string, unknown>) => {
      const base = buildHttpUrl(serverUrl);
      const res = await fetch(
        `${base}/room/${encodeURIComponent(roomId)}/${path}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
    },
    [serverUrl, roomId],
  );

  const addTile = useCallback(
    async (type: "input" | "layer", targetId: string, name: string) => {
      const optimistic: BroadcastTile = {
        id: `optimistic-${Date.now()}`,
        type,
        targetId,
        name,
      };
      const next = [...tiles, optimistic];
      setTiles(next);
      saveToStorage(next, selectedTileId);
      try {
        await post("broadcast-tile/add", { type, targetId });
      } catch (e) {
        setTiles(tiles);
        saveToStorage(tiles, selectedTileId);
        console.error("addTile failed", e);
      }
    },
    [tiles, selectedTileId, saveToStorage, post],
  );

  const removeTile = useCallback(
    async (tileId: string) => {
      const next = tiles.filter((t) => t.id !== tileId);
      const nextSelected = selectedTileId === tileId ? null : selectedTileId;
      setTiles(next);
      setSelectedTileId(nextSelected);
      saveToStorage(next, nextSelected);
      try {
        await post("broadcast-tile/remove", { tileId });
      } catch (e) {
        setTiles(tiles);
        setSelectedTileId(selectedTileId);
        saveToStorage(tiles, selectedTileId);
        console.error("removeTile failed", e);
      }
    },
    [tiles, selectedTileId, saveToStorage, post],
  );

  const selectTile = useCallback(
    async (tileId: string | null) => {
      setSelectedTileId(tileId);
      saveToStorage(tiles, tileId);
      try {
        await post("broadcast-tile/select", { tileId });
      } catch (e) {
        setSelectedTileId(selectedTileId);
        saveToStorage(tiles, selectedTileId);
        console.error("selectTile failed", e);
      }
    },
    [tiles, selectedTileId, saveToStorage, post],
  );

  const updateTileName = useCallback(
    (tileId: string, newName: string) => {
      const next = tiles.map((t) =>
        t.id === tileId ? { ...t, name: newName } : t,
      );
      setTiles(next);
      saveToStorage(next, selectedTileId);
    },
    [tiles, selectedTileId, saveToStorage],
  );

  const toggleEditMode = useCallback(() => setIsEditMode((v) => !v), []);

  return {
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
  };
}
