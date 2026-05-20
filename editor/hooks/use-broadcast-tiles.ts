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
      // Optimistic update
      const optimisticTile: BroadcastTile = {
        id: `optimistic-${Date.now()}`,
        type,
        targetId,
        name,
      };
      const optimisticTiles = [...tiles, optimisticTile];
      setTiles(optimisticTiles);
      saveToStorage(optimisticTiles, selectedTileId, isBroadcastMode);

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
          // Revert on failure
          setTiles(tiles);
          saveToStorage(tiles, selectedTileId, isBroadcastMode);
          console.error('Failed to add broadcast tile:', response.statusText);
          return;
        }
        // Replace the optimistic tile with the real one from the server
        const data = (await response.json()) as {
          tile: BroadcastTile;
          selectedBroadcastTileId: string | null;
        };
        const realTile = data.tile;
        const finalTiles = optimisticTiles.map((t) =>
          t.id === optimisticTile.id ? realTile : t,
        );
        // Use server's authoritative selectedId (handles auto-select of first tile)
        const newSelectedId =
          data.selectedBroadcastTileId !== undefined
            ? data.selectedBroadcastTileId
            : selectedTileId === optimisticTile.id
              ? realTile.id
              : selectedTileId;
        setTiles(finalTiles);
        setSelectedTileId(newSelectedId);
        saveToStorage(finalTiles, newSelectedId, isBroadcastMode);
      } catch (error) {
        setTiles(tiles);
        saveToStorage(tiles, selectedTileId, isBroadcastMode);
        console.error('Failed to add broadcast tile:', error);
      }
    },
    [roomId, tiles, selectedTileId, saveToStorage],
  );

  const removeTile = useCallback(
    async (tileId: string) => {
      const updatedTiles = tiles.filter((t) => t.id !== tileId);
      const newSelectedId = selectedTileId === tileId ? null : selectedTileId;
      setTiles(updatedTiles);
      setSelectedTileId(newSelectedId);
      saveToStorage(updatedTiles, newSelectedId, isBroadcastMode);

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
          setTiles(tiles);
          setSelectedTileId(selectedTileId);
          saveToStorage(tiles, selectedTileId, isBroadcastMode);
          console.error(
            'Failed to remove broadcast tile:',
            response.statusText,
          );
        }
      } catch (error) {
        setTiles(tiles);
        setSelectedTileId(selectedTileId);
        saveToStorage(tiles, selectedTileId, isBroadcastMode);
        console.error('Failed to remove broadcast tile:', error);
      }
    },
    [roomId, tiles, selectedTileId, saveToStorage],
  );

  const selectTile = useCallback(
    async (tileId: string | null) => {
      setSelectedTileId(tileId);
      saveToStorage(tiles, tileId, isBroadcastMode);

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
          setSelectedTileId(selectedTileId);
          saveToStorage(tiles, selectedTileId, isBroadcastMode);
          console.error(
            'Failed to select broadcast tile:',
            response.statusText,
          );
        }
      } catch (error) {
        setSelectedTileId(selectedTileId);
        saveToStorage(tiles, selectedTileId, isBroadcastMode);
        console.error('Failed to select broadcast tile:', error);
      }
    },
    [roomId, tiles, selectedTileId, saveToStorage],
  );

  const updateTileName = useCallback(
    (tileId: string, newName: string) => {
      const updatedTiles = tiles.map((t) =>
        t.id === tileId ? { ...t, name: newName } : t,
      );
      setTiles(updatedTiles);
      saveToStorage(updatedTiles, selectedTileId, isBroadcastMode);
    },
    [tiles, selectedTileId, saveToStorage],
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
      const previous = isBroadcastMode;
      setIsBroadcastModeState(enabled);
      saveToStorage(tiles, selectedTileId, enabled);
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
          saveToStorage(tiles, selectedTileId, previous);
          console.error('Failed to set broadcast mode:', response.statusText);
        }
      } catch (error) {
        setIsBroadcastModeState(previous);
        saveToStorage(tiles, selectedTileId, previous);
        console.error('Failed to set broadcast mode:', error);
      }
    },
    [roomId, tiles, selectedTileId, isBroadcastMode, saveToStorage],
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
