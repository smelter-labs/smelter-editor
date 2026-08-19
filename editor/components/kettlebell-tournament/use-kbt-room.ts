'use client';

import { useCallback, useRef, useState } from 'react';
import type { KbtExerciseKey, KbtMatchAction } from '@smelter-editor/types';
import {
  controlKbtMatch,
  createNewRoom,
  deleteRoom,
  setKbtConfig,
} from '@/app/actions/actions';

/** Host-side tournament config in UI units (seconds). */
export type KbtUiConfig = {
  scoring: Record<KbtExerciseKey, { enabled: boolean; points: number }>;
  strictTechnique: boolean;
  heatDurationSec: number;
  heatSize: number;
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
};

export type KbtRoom = {
  roomId: string | null;
  whepUrl: string | null;
  creating: boolean;
  error: string | null;
  /** Create the arena room and arm the roster (registration open). */
  createRoom(cfg: KbtUiConfig): Promise<void>;
  pushConfig(cfg: KbtUiConfig): Promise<void>;
  /** Tournament flow commands (draw heats, stage/begin/stop a heat, final…). */
  control(action: KbtMatchAction, heatIndex?: number): Promise<void>;
  /** EXIT TO TITLE — tear the room down. */
  exitAndDelete(): Promise<void>;
};

/**
 * Room lifecycle for the /kettlebell-tournament page. One room per arcade
 * session; unlike Duck Hunter there is no stage mp4 and no up-front AI — the
 * output shows the players' phone-camera tiles and the server arms the
 * kettlebell-coach per heat. No unload-time teardown (30-min idle GC).
 */
export function useKbtRoom(): KbtRoom {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [whepUrl, setWhepUrl] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const creatingRef = useRef(false);

  const pushConfig = useCallback(
    async (cfg: KbtUiConfig, room?: string) => {
      const target = room ?? roomId;
      if (!target) return;
      await setKbtConfig(target, {
        scoring: cfg.scoring,
        strictTechnique: cfg.strictTechnique,
        heatDurationMs: Math.round(cfg.heatDurationSec * 1000),
        heatSize: cfg.heatSize,
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
        const created = await createNewRoom([], true, {
          width: 1920,
          height: 1080,
        });
        await pushConfig(cfg, created.roomId);
        // Born straight into the roster (registration screen).
        await controlKbtMatch(created.roomId, { action: 'roster' });
        setWhepUrl(created.whepUrl);
        setRoomId(created.roomId);
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
    async (action: KbtMatchAction, heatIndex?: number) => {
      if (!roomId) return;
      await controlKbtMatch(roomId, { action, heatIndex });
    },
    [roomId],
  );

  const exitAndDelete = useCallback(async () => {
    const target = roomId;
    setRoomId(null);
    setWhepUrl(null);
    setError(null);
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
    createRoom,
    pushConfig,
    control,
    exitAndDelete,
  };
}
