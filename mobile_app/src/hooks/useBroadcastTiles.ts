import { useState, useCallback, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { BroadcastTile } from "@smelter-editor/types";
import { buildHttpUrl } from "../services/apiService";

const STORAGE_KEY_PREFIX = "broadcast-tiles";

type BroadcastTilesState = {
  tiles: BroadcastTile[];
  selectedTileId: string | null;
  isBroadcastMode: boolean;
};

export function useBroadcastTiles(serverUrl: string, roomId: string) {
  const [tiles, setTiles] = useState<BroadcastTile[]>([]);
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [isBroadcastMode, setIsBroadcastModeState] = useState(false);
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
          setIsBroadcastModeState(parsed.isBroadcastMode ?? false);
        }
      })
      .catch((e) => console.error("useBroadcastTiles: load error", e))
      .finally(() => setIsLoading(false));
  }, [storageKey]);

  const saveToStorage = useCallback(
    (
      newTiles: BroadcastTile[],
      newSelectedId: string | null,
      newIsBroadcastMode: boolean,
    ) => {
      const data: BroadcastTilesState = {
        tiles: newTiles,
        selectedTileId: newSelectedId,
        isBroadcastMode: newIsBroadcastMode,
      };
      AsyncStorage.setItem(storageKey, JSON.stringify(data)).catch((e) =>
        console.error("useBroadcastTiles: save error", e),
      );
    },
    [storageKey],
  );

  const syncWithServerState = useCallback(
    (
      serverTiles: BroadcastTile[],
      serverSelectedId: string | null,
      serverIsBroadcastMode: boolean,
    ) => {
      setTiles(serverTiles);
      setSelectedTileId(serverSelectedId);
      setIsBroadcastModeState(serverIsBroadcastMode);
      saveToStorage(serverTiles, serverSelectedId, serverIsBroadcastMode);
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
      saveToStorage(next, selectedTileId, isBroadcastMode);
      try {
        await post("broadcast-tile/add", { type, targetId });
      } catch (e) {
        setTiles(tiles);
        saveToStorage(tiles, selectedTileId, isBroadcastMode);
        console.error("addTile failed", e);
      }
    },
    [tiles, selectedTileId, isBroadcastMode, saveToStorage, post],
  );

  const removeTile = useCallback(
    async (tileId: string) => {
      const next = tiles.filter((t) => t.id !== tileId);
      const nextSelected = selectedTileId === tileId ? null : selectedTileId;
      setTiles(next);
      setSelectedTileId(nextSelected);
      saveToStorage(next, nextSelected, isBroadcastMode);
      try {
        await post("broadcast-tile/remove", { tileId });
      } catch (e) {
        setTiles(tiles);
        setSelectedTileId(selectedTileId);
        saveToStorage(tiles, selectedTileId, isBroadcastMode);
        console.error("removeTile failed", e);
      }
    },
    [tiles, selectedTileId, isBroadcastMode, saveToStorage, post],
  );

  const selectTile = useCallback(
    async (tileId: string | null) => {
      setSelectedTileId(tileId);
      saveToStorage(tiles, tileId, isBroadcastMode);
      try {
        await post("broadcast-tile/select", { tileId });
      } catch (e) {
        setSelectedTileId(selectedTileId);
        saveToStorage(tiles, selectedTileId, isBroadcastMode);
        console.error("selectTile failed", e);
      }
    },
    [tiles, selectedTileId, isBroadcastMode, saveToStorage, post],
  );

  const updateTileName = useCallback((tileId: string, newName: string) => {
    setTiles((prev) => {
      const tile = prev.find((t) => t.id === tileId);
      if (!tile || tile.name === newName) return prev;
      return prev.map((t) => (t.id === tileId ? { ...t, name: newName } : t));
    });
  }, []);

  const setBroadcastMode = useCallback(
    async (enabled: boolean) => {
      const previous = isBroadcastMode;
      setIsBroadcastModeState(enabled);
      saveToStorage(tiles, selectedTileId, enabled);
      try {
        await post("broadcast-mode/set", { enabled });
      } catch (e) {
        setIsBroadcastModeState(previous);
        saveToStorage(tiles, selectedTileId, previous);
        console.error("setBroadcastMode failed", e);
      }
    },
    [tiles, selectedTileId, isBroadcastMode, saveToStorage, post],
  );

  const toggleEditMode = useCallback(() => setIsEditMode((v) => !v), []);

  return {
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
  };
}
