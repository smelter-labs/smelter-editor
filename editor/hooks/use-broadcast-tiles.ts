'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { BroadcastTile } from '@smelter-editor/types';
import { getEffectiveClientServerUrl } from '@/lib/server-url';

const STORAGE_KEY_PREFIX = 'broadcast-tiles';

type BroadcastTilesState = {
  tiles: BroadcastTile[];
  selectedTileId: string | null;
  isBroadcastMode: boolean;
};

export function useBroadcastTiles(roomId: string) {
  const [tiles, setTiles] = useState<BroadcastTile[]>([]);
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [isBroadcastMode, setIsBroadcastModeState] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const cacheRef = useRef<BroadcastTilesState | null>(null);
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

  const getStorageKey = useCallback(() => {
    return `${STORAGE_KEY_PREFIX}-${roomId}`;
  }, [roomId]);

  // Load from localStorage on mount
  useEffect(() => {
    const key = getStorageKey();
    try {
      const cached = localStorage.getItem(key);
      if (cached) {
        const parsed = JSON.parse(cached) as BroadcastTilesState;
        setTiles(parsed.tiles || []);
        setSelectedTileId(parsed.selectedTileId || null);
        setIsBroadcastModeState(parsed.isBroadcastMode ?? false);
        cacheRef.current = parsed;
      }
    } catch (error) {
      console.error('Failed to load broadcast tiles from storage:', error);
    }
  }, [getStorageKey]);

  // Save to localStorage whenever tiles or selection changes
  const saveToStorage = useCallback(
    (
      newTiles: BroadcastTile[],
      newSelectedId: string | null,
      newIsBroadcastMode: boolean,
    ) => {
      const key = getStorageKey();
      try {
        const state: BroadcastTilesState = {
          tiles: newTiles,
          selectedTileId: newSelectedId,
          isBroadcastMode: newIsBroadcastMode,
        };
        localStorage.setItem(key, JSON.stringify(state));
        cacheRef.current = state;
      } catch (error) {
        console.error('Failed to save broadcast tiles to storage:', error);
      }
    },
    [getStorageKey],
  );

  // Sync with server state (from room state updates)
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

  const addTile = useCallback(
    async (type: 'input' | 'layer', targetId: string, name: string) => {
      // Optimistic update — read refs so we don't capture stale state in
      // callbacks below.
      const optimisticTile: BroadcastTile = {
        id: `optimistic-${Date.now()}`,
        type,
        targetId,
        name,
      };
      setTiles((prev) => {
        const next = [...prev, optimisticTile];
        saveToStorage(
          next,
          selectedTileIdRef.current,
          isBroadcastModeRef.current,
        );
        return next;
      });

      const revert = () => {
        setTiles((prev) => {
          const next = prev.filter((t) => t.id !== optimisticTile.id);
          saveToStorage(
            next,
            selectedTileIdRef.current === optimisticTile.id
              ? null
              : selectedTileIdRef.current,
            isBroadcastModeRef.current,
          );
          return next;
        });
        setSelectedTileId((prev) => (prev === optimisticTile.id ? null : prev));
      };

      try {
        const response = await fetch(
          `${getEffectiveClientServerUrl()}/room/${encodeURIComponent(roomId)}/broadcast-tile/add`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, targetId }),
          },
        );
        if (!response.ok) {
          revert();
          console.error('Failed to add broadcast tile:', response.statusText);
          return;
        }
        // Replace the optimistic tile with the real one from the server.
        const data = (await response.json()) as {
          tile: BroadcastTile;
          selectedBroadcastTileId: string | null;
        };
        const realTile = data.tile;
        let nextTilesSnapshot: BroadcastTile[] = [];
        setTiles((prev) => {
          const next = prev.map((t) =>
            t.id === optimisticTile.id ? realTile : t,
          );
          nextTilesSnapshot = next;
          return next;
        });
        // Server provides the authoritative selection (handles auto-select of
        // the first tile).
        const next = data.selectedBroadcastTileId;
        setSelectedTileId(next);
        saveToStorage(nextTilesSnapshot, next, isBroadcastModeRef.current);
      } catch (error) {
        revert();
        console.error('Failed to add broadcast tile:', error);
      }
    },
    [roomId, saveToStorage],
  );

  const removeTile = useCallback(
    async (tileId: string) => {
      const prevTiles = tilesRef.current;
      const prevSelected = selectedTileIdRef.current;
      const updatedTiles = prevTiles.filter((t) => t.id !== tileId);
      const newSelectedId = prevSelected === tileId ? null : prevSelected;
      setTiles(updatedTiles);
      setSelectedTileId(newSelectedId);
      saveToStorage(updatedTiles, newSelectedId, isBroadcastModeRef.current);

      const revert = () => {
        setTiles((curr) => {
          if (curr.some((t) => t.id === tileId)) return curr;
          const restored = [
            ...curr,
            ...prevTiles.filter((t) => t.id === tileId),
          ];
          return restored;
        });
        setSelectedTileId((curr) => curr ?? prevSelected);
        saveToStorage(
          tilesRef.current,
          selectedTileIdRef.current,
          isBroadcastModeRef.current,
        );
      };

      try {
        const response = await fetch(
          `${getEffectiveClientServerUrl()}/room/${encodeURIComponent(roomId)}/broadcast-tile/remove`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tileId }),
          },
        );
        if (!response.ok) {
          revert();
          console.error(
            'Failed to remove broadcast tile:',
            response.statusText,
          );
        }
      } catch (error) {
        revert();
        console.error('Failed to remove broadcast tile:', error);
      }
    },
    [roomId, saveToStorage],
  );

  const selectTile = useCallback(
    async (tileId: string | null) => {
      const prevSelected = selectedTileIdRef.current;
      setSelectedTileId(tileId);
      saveToStorage(tilesRef.current, tileId, isBroadcastModeRef.current);

      try {
        const response = await fetch(
          `${getEffectiveClientServerUrl()}/room/${encodeURIComponent(roomId)}/broadcast-tile/select`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tileId }),
          },
        );
        if (!response.ok) {
          setSelectedTileId(prevSelected);
          saveToStorage(
            tilesRef.current,
            prevSelected,
            isBroadcastModeRef.current,
          );
          console.error(
            'Failed to select broadcast tile:',
            response.statusText,
          );
        }
      } catch (error) {
        setSelectedTileId(prevSelected);
        saveToStorage(
          tilesRef.current,
          prevSelected,
          isBroadcastModeRef.current,
        );
        console.error('Failed to select broadcast tile:', error);
      }
    },
    [roomId, saveToStorage],
  );

  const updateTileName = useCallback(
    (tileId: string, newName: string) => {
      setTiles((prev) => {
        const next = prev.map((t) =>
          t.id === tileId ? { ...t, name: newName } : t,
        );
        saveToStorage(
          next,
          selectedTileIdRef.current,
          isBroadcastModeRef.current,
        );
        return next;
      });
    },
    [saveToStorage],
  );

  const toggleEditMode = useCallback(() => {
    setIsEditMode((prev) => !prev);
  }, []);

  const clearAll = useCallback(() => {
    setTiles([]);
    setSelectedTileId(null);
    setIsBroadcastModeState(false);
    setIsEditMode(false);
    saveToStorage([], null, false);
  }, [saveToStorage]);

  const setBroadcastMode = useCallback(
    async (enabled: boolean) => {
      const previous = isBroadcastModeRef.current;
      setIsBroadcastModeState(enabled);
      saveToStorage(tilesRef.current, selectedTileIdRef.current, enabled);
      try {
        const response = await fetch(
          `${getEffectiveClientServerUrl()}/room/${encodeURIComponent(roomId)}/broadcast-mode/set`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled }),
          },
        );
        if (!response.ok) {
          setIsBroadcastModeState(previous);
          saveToStorage(tilesRef.current, selectedTileIdRef.current, previous);
          console.error('Failed to set broadcast mode:', response.statusText);
        }
      } catch (error) {
        setIsBroadcastModeState(previous);
        saveToStorage(tilesRef.current, selectedTileIdRef.current, previous);
        console.error('Failed to set broadcast mode:', error);
      }
    },
    [roomId, saveToStorage],
  );

  return {
    tiles,
    selectedTileId,
    isBroadcastMode,
    isEditMode,
    addTile,
    removeTile,
    selectTile,
    updateTileName,
    toggleEditMode,
    setBroadcastMode,
    clearAll,
    syncWithServerState,
  };
}
