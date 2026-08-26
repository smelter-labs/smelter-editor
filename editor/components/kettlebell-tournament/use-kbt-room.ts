'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  KbtCameraView,
  KbtExerciseKey,
  KbtMatchAction,
} from '@smelter-editor/types';
import {
  controlKbtMatch,
  createNewRoom,
  deleteRoom,
  getRoomInfo,
  setKbtConfig,
} from '@/app/actions/actions';
import type { ResolutionPreset } from '@/lib/resolution';

/** Host-side tournament config in UI units (seconds). */
export type KbtUiConfig = {
  scoring: Record<KbtExerciseKey, { enabled: boolean; points: number }>;
  strictTechnique: boolean;
  heatDurationSec: number;
  heatSize: number;
  cameraView: KbtCameraView;
  /** Save an apex still of every counted rep (AI referee screenshot). */
  repScreenshots: boolean;
  /** Every 5th rep of an exercise fires an on-air aura + tile shake. */
  milestoneFx: boolean;
  /** Every scored rep floats game text up the tile ("SNATCH +3" / "NO REP"). */
  repFloatText: boolean;
  /** Broadcast output size — applied at room creation, fixed afterwards. */
  resolution: ResolutionPreset;
};

export const DEFAULT_KBT_UI_CONFIG: KbtUiConfig = {
  scoring: {
    swing: { enabled: true, points: 1 },
    clean: { enabled: true, points: 2 },
    snatch: { enabled: true, points: 3 },
  },
  strictTechnique: false,
  heatDurationSec: 60,
  heatSize: 2,
  cameraView: 'front',
  repScreenshots: false,
  milestoneFx: true,
  repFloatText: true,
  resolution: '1080p',
};

export type KbtRoom = {
  roomId: string | null;
  whepUrl: string | null;
  creating: boolean;
  error: string | null;
  /**
   * 'idle' = no room yet (title/setup), 'checking' = validating a
   * URL-provided roomId, 'ok' = room confirmed live, 'gone' = the
   * URL-provided room no longer exists.
   */
  roomStatus: 'idle' | 'checking' | 'ok' | 'gone';
  /** The server's reason for the last refused control action (auto-clears). */
  lastError: string | null;
  /** Create the arena room and arm the roster (registration open). */
  createRoom(cfg: KbtUiConfig): Promise<void>;
  pushConfig(cfg: KbtUiConfig): Promise<void>;
  /** Tournament flow commands (draw heats, stage/begin/stop a heat, final…). */
  control(
    action: KbtMatchAction,
    heatIndex?: number,
    clientId?: string,
  ): Promise<void>;
  /** Re-verify the room still exists (feed lost, suspected server restart). */
  recheck(): Promise<void>;
  /** EXIT TO TITLE — tear the room down. */
  exitAndDelete(): Promise<void>;
};

/**
 * Room lifecycle for the /kettlebell-tournament page. One room per arcade
 * session; unlike Duck Hunter there is no stage mp4 and no up-front AI — the
 * output shows the players' phone-camera tiles and the server arms the
 * kettlebell-coach per heat. No unload-time teardown (30-min idle GC).
 */
export function useKbtRoom(initialRoomId?: string): KbtRoom {
  const [roomId, setRoomId] = useState<string | null>(initialRoomId ?? null);
  const [whepUrl, setWhepUrl] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roomStatus, setRoomStatus] = useState<
    'idle' | 'checking' | 'ok' | 'gone'
  >(initialRoomId ? 'checking' : 'idle');
  const [lastError, setLastError] = useState<string | null>(null);
  const creatingRef = useRef(false);
  const lastErrorTimerRef = useRef<number | null>(null);

  const showError = useCallback((message: string) => {
    setLastError(message);
    if (lastErrorTimerRef.current != null) {
      window.clearTimeout(lastErrorTimerRef.current);
    }
    lastErrorTimerRef.current = window.setTimeout(
      () => setLastError(null),
      4000,
    );
  }, []);

  // Rehydrate after a refresh on /kettlebell-tournament/[roomId]: confirm the
  // room still exists and recover the whepUrl the heat screen needs.
  useEffect(() => {
    if (!initialRoomId) return;
    let cancelled = false;
    void getRoomInfo(initialRoomId).then((info) => {
      if (cancelled) return;
      if (info && info !== 'not-found') {
        setWhepUrl(info.whepUrl ?? null);
        setRoomStatus('ok');
      } else {
        setRoomId(null);
        setRoomStatus('gone');
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pushConfig = useCallback(
    async (cfg: KbtUiConfig, room?: string) => {
      const target = room ?? roomId;
      if (!target) return;
      await setKbtConfig(target, {
        scoring: cfg.scoring,
        strictTechnique: cfg.strictTechnique,
        heatDurationMs: Math.round(cfg.heatDurationSec * 1000),
        heatSize: cfg.heatSize,
        cameraView: cfg.cameraView,
        repScreenshots: cfg.repScreenshots,
        milestoneFx: cfg.milestoneFx,
        repFloatText: cfg.repFloatText,
      });
    },
    [roomId],
  );

  const createRoom = useCallback(
    async (cfg: KbtUiConfig) => {
      if (creatingRef.current || roomId) return;
      creatingRef.current = true;
      setCreating(true);
      setError(null);
      try {
        const created = await createNewRoom([], true, cfg.resolution);
        await pushConfig(cfg, created.roomId);
        // Born straight into the roster (registration screen).
        await controlKbtMatch(created.roomId, { action: 'roster' });
        setWhepUrl(created.whepUrl);
        setRoomId(created.roomId);
        setRoomStatus('ok');
        // Put the room in the URL so a refresh can rehydrate — replaceState
        // (not router.replace) so the arcade doesn't remount mid-session.
        window.history.replaceState(
          null,
          '',
          `/kettlebell-tournament/${encodeURIComponent(created.roomId)}`,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Arena setup failed');
      } finally {
        creatingRef.current = false;
        setCreating(false);
      }
    },
    [roomId, pushConfig],
  );

  const control = useCallback(
    async (action: KbtMatchAction, heatIndex?: number, clientId?: string) => {
      if (!roomId) return;
      const { error: refusal } = await controlKbtMatch(roomId, {
        action,
        heatIndex,
        clientId,
      });
      if (refusal) showError(refusal.message);
    },
    [roomId, showError],
  );

  // Re-check room existence on demand (the arcade calls this when the live
  // feed stays down — a vanished room should say ARENA CLOSED, not spin).
  const recheck = useCallback(async () => {
    const target = roomId;
    if (!target) return;
    const info = await getRoomInfo(target).catch(() => null);
    if (info === 'not-found') {
      setRoomId(null);
      setRoomStatus('gone');
    }
  }, [roomId]);

  const exitAndDelete = useCallback(async () => {
    const target = roomId;
    setRoomId(null);
    setWhepUrl(null);
    setError(null);
    setRoomStatus('idle');
    window.history.replaceState(null, '', '/kettlebell-tournament');
    if (target) {
      try {
        await deleteRoom(target);
      } catch {
        /* the 30-min idle sweep will collect it */
      }
    }
  }, [roomId]);

  return {
    roomId,
    whepUrl,
    creating,
    error,
    roomStatus,
    lastError,
    createRoom,
    pushConfig,
    control,
    recheck,
    exitAndDelete,
  };
}
