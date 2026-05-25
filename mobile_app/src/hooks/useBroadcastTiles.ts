import { useState, useCallback, useEffect, useRef } from "react";
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
  const tilesRef = useRef<BroadcastTile[]>([]);
  const selectedTileIdRef = useRef<string | null>(null);
  const isBroadcastModeRef = useRef(false);
  useEffect(() => {
    tilesRef.current = tiles;
  }, [tiles]);
  useEffect(() => {
    selectedTileIdRef.current = selectedTileId;
  }, [selectedTileId]);
  useEffect(() => {
    isBroadcastModeRef.current = isBroadcastMode;
  }, [isBroadcastMode]);

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

  const postJson = useCallback(
    async (
      path: string,
      body: Record<string, unknown>,
    ): Promise<unknown | null> => {
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
      try {
        return await res.json();
      } catch {
        return null;
      }
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
      setTiles((prev) => {
        const next = [...prev, optimistic];
        saveToStorage(
          next,
          selectedTileIdRef.current,
          isBroadcastModeRef.current,
        );
        return next;
      });
      try {
        const data = (await postJson("broadcast-tile/add", {
          type,
          targetId,
        })) as {
          tile?: BroadcastTile;
          selectedBroadcastTileId?: string | null;
        } | null;
        const realTile = data?.tile;
        const serverSelected = data?.selectedBroadcastTileId ?? null;
        let snapshot: BroadcastTile[] = [];
        setTiles((prev) => {
          const next = realTile
            ? prev.map((t) => (t.id === optimistic.id ? realTile : t))
            : prev;
          snapshot = next;
          return next;
        });
        setSelectedTileId(serverSelected);
        saveToStorage(snapshot, serverSelected, isBroadcastModeRef.current);
      } catch (e) {
        setTiles((prev) => {
          const next = prev.filter((t) => t.id !== optimistic.id);
          saveToStorage(
            next,
            selectedTileIdRef.current === optimistic.id
              ? null
              : selectedTileIdRef.current,
            isBroadcastModeRef.current,
          );
          return next;
        });
        setSelectedTileId((prev) => (prev === optimistic.id ? null : prev));
        console.error("addTile failed", e);
      }
    },
    [saveToStorage, postJson],
  );

  const removeTile = useCallback(
    async (tileId: string) => {
      const prevTiles = tilesRef.current;
      const prevSelected = selectedTileIdRef.current;
      const next = prevTiles.filter((t) => t.id !== tileId);
      const nextSelected = prevSelected === tileId ? null : prevSelected;
      setTiles(next);
      setSelectedTileId(nextSelected);
      saveToStorage(next, nextSelected, isBroadcastModeRef.current);
      try {
        await postJson("broadcast-tile/remove", { tileId });
      } catch (e) {
        setTiles((curr) =>
          curr.some((t) => t.id === tileId)
            ? curr
            : [...curr, ...prevTiles.filter((t) => t.id === tileId)],
        );
        setSelectedTileId((curr) => curr ?? prevSelected);
        saveToStorage(
          tilesRef.current,
          selectedTileIdRef.current,
          isBroadcastModeRef.current,
        );
        console.error("removeTile failed", e);
      }
    },
    [saveToStorage, postJson],
  );

  const selectTile = useCallback(
    async (tileId: string | null) => {
      const prevSelected = selectedTileIdRef.current;
      setSelectedTileId(tileId);
      saveToStorage(tilesRef.current, tileId, isBroadcastModeRef.current);
      try {
        await postJson("broadcast-tile/select", { tileId });
      } catch (e) {
        setSelectedTileId(prevSelected);
        saveToStorage(
          tilesRef.current,
          prevSelected,
          isBroadcastModeRef.current,
        );
        console.error("selectTile failed", e);
      }
    },
    [saveToStorage, postJson],
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
      const previous = isBroadcastModeRef.current;
      setIsBroadcastModeState(enabled);
      saveToStorage(tilesRef.current, selectedTileIdRef.current, enabled);
      try {
        await postJson("broadcast-mode/set", { enabled });
      } catch (e) {
        setIsBroadcastModeState(previous);
        saveToStorage(tilesRef.current, selectedTileIdRef.current, previous);
        console.error("setBroadcastMode failed", e);
      }
    },
    [saveToStorage, postJson],
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
