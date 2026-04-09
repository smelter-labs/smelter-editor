import type { RoomState } from '@/lib/types';
import {
  exportRoomConfig,
  loadTimelineFromStorage,
  loadOutputPlayerSettings,
  type RoomConfig,
} from '@/lib/room-config';

const STORAGE_KEY = 'smelter:crash-recovery';
const MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

export type CrashRecoveryData = {
  roomId: string;
  config: RoomConfig;
  savedAt: string;
};

export function saveCrashRecoverySnapshot(
  roomId: string,
  roomState: RoomState,
): void {
  if (typeof window === 'undefined') return;
  if (roomState.inputs.length === 0) return;

  try {
    const timelineState = loadTimelineFromStorage(roomId) ?? undefined;
    const outputPlayer = loadOutputPlayerSettings(roomId) ?? undefined;

    const config = exportRoomConfig(
      roomState.inputs,
      undefined,
      roomState.resolution,
      {
        swapDurationMs: roomState.swapDurationMs,
        swapOutgoingEnabled: roomState.swapOutgoingEnabled,
        swapFadeInDurationMs: roomState.swapFadeInDurationMs,
        swapFadeOutDurationMs: roomState.swapFadeOutDurationMs,
        newsStripFadeDuringSwap: roomState.newsStripFadeDuringSwap,
        newsStripEnabled: roomState.newsStripEnabled,
      },
      timelineState,
      outputPlayer,
      {
        viewportTop: roomState.viewportTop,
        viewportLeft: roomState.viewportLeft,
        viewportWidth: roomState.viewportWidth,
        viewportHeight: roomState.viewportHeight,
        viewportTransitionDurationMs: roomState.viewportTransitionDurationMs,
        viewportTransitionEasing: roomState.viewportTransitionEasing,
      },
      roomState.outputShaders,
      roomState.layers,
    );

    const data: CrashRecoveryData = {
      roomId,
      config,
      savedAt: new Date().toISOString(),
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Failed to save crash recovery snapshot:', e);
  }
}

export function loadCrashRecoveryConfig(): CrashRecoveryData | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const data: CrashRecoveryData = JSON.parse(raw);
    if (!data.config || !data.savedAt) return null;

    const age = Date.now() - new Date(data.savedAt).getTime();
    if (age > MAX_AGE_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    if (!data.config.inputs || data.config.inputs.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return data;
  } catch (e) {
    console.warn('Failed to load crash recovery config:', e);
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function clearCrashRecoveryConfig(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
