'use client';

import { useCallback, useEffect, useState } from 'react';

import type { OutputJsxState } from '@/lib/generate-output-jsx';

export type OutputCodeSnapshot = {
  id: string;
  label: string;
  code: string;
  createdAt: number;
  lineCount: number;
  /** Room state captured at save time — required for Restore. */
  sceneState?: OutputJsxState;
};

export type OutputCodeRoomState = {
  schemaVersion: 1;
  fontSizePx: number;
  activeTabId: 'live' | string;
  snapshots: OutputCodeSnapshot[];
};

export const OUTPUT_CODE_LIVE_TAB_ID = 'live' as const;

export const DEFAULT_FONT_SIZE_PX = 10;
export const MIN_FONT_SIZE_PX = 8;
export const MAX_FONT_SIZE_PX = 18;
export const MAX_SNAPSHOTS = 25;

const STORAGE_KEY_PREFIX = 'smelter:output-code:';

function storageKey(roomId: string): string {
  return `${STORAGE_KEY_PREFIX}${roomId}`;
}

function clampFontSize(value: number): number {
  return Math.max(MIN_FONT_SIZE_PX, Math.min(MAX_FONT_SIZE_PX, Math.round(value)));
}

function createDefaultState(): OutputCodeRoomState {
  return {
    schemaVersion: 1,
    fontSizePx: DEFAULT_FONT_SIZE_PX,
    activeTabId: OUTPUT_CODE_LIVE_TAB_ID,
    snapshots: [],
  };
}

function sanitizeSceneState(raw: unknown): OutputJsxState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const parsed = raw as Partial<OutputJsxState>;
  if (
    !Array.isArray(parsed.inputs) ||
    !Array.isArray(parsed.layers) ||
    !parsed.resolution ||
    typeof parsed.resolution !== 'object'
  ) {
    return undefined;
  }
  const resolution = parsed.resolution as { width?: unknown; height?: unknown };
  if (
    typeof resolution.width !== 'number' ||
    typeof resolution.height !== 'number'
  ) {
    return undefined;
  }
  return parsed as OutputJsxState;
}

function sanitizeSnapshot(raw: unknown): OutputCodeSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<OutputCodeSnapshot>;
  if (
    typeof item.id !== 'string' ||
    typeof item.label !== 'string' ||
    typeof item.code !== 'string' ||
    typeof item.createdAt !== 'number' ||
    typeof item.lineCount !== 'number'
  ) {
    return null;
  }
  const sceneState = sanitizeSceneState(item.sceneState);
  return {
    id: item.id,
    label: item.label,
    code: item.code,
    createdAt: item.createdAt,
    lineCount: item.lineCount,
    ...(sceneState ? { sceneState } : {}),
  };
}

function sanitizeState(raw: unknown): OutputCodeRoomState {
  if (!raw || typeof raw !== 'object') return createDefaultState();
  const parsed = raw as Partial<OutputCodeRoomState>;
  const snapshots = Array.isArray(parsed.snapshots)
    ? parsed.snapshots
        .map(sanitizeSnapshot)
        .filter((s): s is OutputCodeSnapshot => s !== null)
    : [];

  let activeTabId: 'live' | string = OUTPUT_CODE_LIVE_TAB_ID;
  if (typeof parsed.activeTabId === 'string') {
    if (
      parsed.activeTabId === OUTPUT_CODE_LIVE_TAB_ID ||
      snapshots.some((s) => s.id === parsed.activeTabId)
    ) {
      activeTabId = parsed.activeTabId;
    }
  }

  return {
    schemaVersion: 1,
    fontSizePx: clampFontSize(
      typeof parsed.fontSizePx === 'number'
        ? parsed.fontSizePx
        : DEFAULT_FONT_SIZE_PX,
    ),
    activeTabId,
    snapshots,
  };
}

export function formatSnapshotLabel(date = new Date()): string {
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function loadOutputCodeRoomState(roomId: string): OutputCodeRoomState {
  if (typeof window === 'undefined' || !roomId) return createDefaultState();
  try {
    const raw = localStorage.getItem(storageKey(roomId));
    if (!raw) return createDefaultState();
    return sanitizeState(JSON.parse(raw));
  } catch (error) {
    console.warn('[output-code-storage] load failed', error);
    return createDefaultState();
  }
}

export function saveOutputCodeRoomState(
  roomId: string,
  state: OutputCodeRoomState,
): void {
  if (typeof window === 'undefined' || !roomId) return;
  try {
    localStorage.setItem(storageKey(roomId), JSON.stringify(sanitizeState(state)));
  } catch (error) {
    console.warn('[output-code-storage] save failed — localStorage likely full', error);
  }
}

function generateSnapshotId(): string {
  return `snap-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export type CreateSnapshotResult = {
  state: OutputCodeRoomState;
  snapshotId: string;
  deduped: boolean;
};

export function createSnapshot(
  state: OutputCodeRoomState,
  liveCode: string,
  sceneState: OutputJsxState,
): CreateSnapshotResult {
  const existing = state.snapshots.find((s) => s.code === liveCode);
  if (existing) {
    const snapshots = state.snapshots.map((s) =>
      s.id === existing.id
        ? { ...s, sceneState: structuredClone(sceneState) }
        : s,
    );
    return {
      state: {
        ...state,
        activeTabId: existing.id,
        snapshots,
      },
      snapshotId: existing.id,
      deduped: true,
    };
  }

  const now = Date.now();
  const snapshot: OutputCodeSnapshot = {
    id: generateSnapshotId(),
    label: formatSnapshotLabel(new Date(now)),
    code: liveCode,
    createdAt: now,
    lineCount: liveCode.split('\n').length,
    sceneState: structuredClone(sceneState),
  };

  let snapshots = [...state.snapshots, snapshot];
  if (snapshots.length > MAX_SNAPSHOTS) {
    snapshots = snapshots.slice(snapshots.length - MAX_SNAPSHOTS);
  }

  return {
    state: {
      ...state,
      activeTabId: snapshot.id,
      snapshots,
    },
    snapshotId: snapshot.id,
    deduped: false,
  };
}

export function deleteSnapshot(
  state: OutputCodeRoomState,
  snapshotId: string,
): OutputCodeRoomState {
  const snapshots = state.snapshots.filter((s) => s.id !== snapshotId);
  const activeTabId =
    state.activeTabId === snapshotId ? OUTPUT_CODE_LIVE_TAB_ID : state.activeTabId;

  return {
    ...state,
    activeTabId,
    snapshots,
  };
}

export function renameSnapshot(
  state: OutputCodeRoomState,
  snapshotId: string,
  label: string,
): OutputCodeRoomState {
  const trimmed = label.trim();
  if (!trimmed) return state;

  return {
    ...state,
    snapshots: state.snapshots.map((s) =>
      s.id === snapshotId ? { ...s, label: trimmed } : s,
    ),
  };
}

export function setActiveTabId(
  state: OutputCodeRoomState,
  tabId: 'live' | string,
): OutputCodeRoomState {
  if (
    tabId !== OUTPUT_CODE_LIVE_TAB_ID &&
    !state.snapshots.some((s) => s.id === tabId)
  ) {
    return state;
  }
  return { ...state, activeTabId: tabId };
}

export function setFontSizePx(
  state: OutputCodeRoomState,
  fontSizePx: number,
): OutputCodeRoomState {
  return { ...state, fontSizePx: clampFontSize(fontSizePx) };
}

export function useOutputCodeRoomState(roomId: string | undefined) {
  const [state, setState] = useState<OutputCodeRoomState>(() =>
    roomId ? loadOutputCodeRoomState(roomId) : createDefaultState(),
  );

  useEffect(() => {
    if (!roomId) {
      setState(createDefaultState());
      return;
    }
    setState(loadOutputCodeRoomState(roomId));
  }, [roomId]);

  const persist = useCallback(
    (next: OutputCodeRoomState) => {
      const sanitized = sanitizeState(next);
      setState(sanitized);
      if (roomId) {
        saveOutputCodeRoomState(roomId, sanitized);
      }
    },
    [roomId],
  );

  return { state, setState: persist };
}
