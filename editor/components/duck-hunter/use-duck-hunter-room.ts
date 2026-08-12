'use client';

import { useCallback, useRef, useState } from 'react';
import type { ShooterMatchConfig } from '@smelter-editor/types';
import {
  addMP4Input,
  controlDuckHunterMatch,
  createNewRoom,
  deleteRoom,
  getAvailableAIModels,
  getRoomInfo,
  removeInput,
  setAIModel,
  setDuckHunterConfig,
} from '@/app/actions/actions';

// The AI model that replaces detected birds with Duck Hunt sprites — enabling
// it (in ghost mode) on an input is what makes a shootable target.
const BIRD_MODEL_ID = 'people-counter-yolo-birds';

/** Slider values in UI units (seconds), converted to ms on push. */
export type DuckHunterSliderConfig = {
  maxAmmo: number;
  reloadSec: number;
  duckScale: number;
  fleeSec: number;
  flySpeed: number;
};

export type DuckHunterRoom = {
  roomId: string | null;
  whepUrl: string | null;
  stageInputId: string | null;
  creating: boolean;
  error: string | null;
  /** Create the arcade room: stage mp4 input + duck sprites + config. */
  createRoom(stageFile: string, cfg: DuckHunterSliderConfig): Promise<void>;
  /** Swap the hunt-stage video in the existing room (PLAY AGAIN flow). */
  changeStage(stageFile: string): Promise<void>;
  pushConfig(cfg: DuckHunterSliderConfig): Promise<void>;
  startMatch(cfg: ShooterMatchConfig): Promise<void>;
  stopMatch(): Promise<void>;
  resetMatch(): Promise<void>;
  /** EXIT TO TITLE — tear the room down. */
  exitAndDelete(): Promise<void>;
};

/**
 * Room lifecycle for the /duck-hunter arcade page. One room per arcade
 * session, created when the lobby opens; PLAY AGAIN reuses it (phones stay
 * connected, the YOLO sidecar stays warm). No unload-time teardown — an
 * accidental refresh must not kill a live game; the server garbage-collects
 * idle rooms after 30 minutes anyway.
 */
export function useDuckHunterRoom(): DuckHunterRoom {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [whepUrl, setWhepUrl] = useState<string | null>(null);
  const [stageInputId, setStageInputId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Serialize createRoom against double-mount (React strict mode) and
  // impatient clicks.
  const creatingRef = useRef(false);

  const enableDucks = useCallback(async (room: string, inputId: string) => {
    const models = await getAvailableAIModels();
    const birdModel = models.find((m) => m.id === BIRD_MODEL_ID);
    if (!birdModel) {
      throw new Error(`AI model ${BIRD_MODEL_ID} is not available`);
    }
    await setAIModel(
      room,
      inputId,
      birdModel.id,
      true,
      birdModel.defaultDelayMs,
      false, // drawBoxes off — ghosts and boxes are mutually exclusive
      undefined,
      true, // ghostMode = duck sprites
    );
  }, []);

  const pushConfig = useCallback(
    async (cfg: DuckHunterSliderConfig, room?: string) => {
      const target = room ?? roomId;
      if (!target) return;
      await setDuckHunterConfig(target, {
        maxAmmo: cfg.maxAmmo,
        reloadMs: Math.round(cfg.reloadSec * 1000),
        duckScale: cfg.duckScale,
        duckPauseMs: Math.round(cfg.fleeSec * 1000),
        duckFlySpeed: cfg.flySpeed,
      });
    },
    [roomId],
  );

  const createRoom = useCallback(
    async (stageFile: string, cfg: DuckHunterSliderConfig) => {
      if (creatingRef.current || roomId) return;
      creatingRef.current = true;
      setCreating(true);
      setError(null);
      try {
        const created = await createNewRoom([], true, {
          width: 1920,
          height: 1080,
        });
        const added = (await addMP4Input(created.roomId, stageFile)) as {
          inputId?: string;
        };
        let inputId = added?.inputId ?? null;
        if (!inputId) {
          const info = await getRoomInfo(created.roomId);
          if (info !== 'not-found') {
            inputId = info.inputs[0]?.inputId ?? null;
          }
        }
        if (!inputId) throw new Error('Stage input did not register');
        await enableDucks(created.roomId, inputId);
        await pushConfig(cfg, created.roomId);
        setStageInputId(inputId);
        setWhepUrl(created.whepUrl);
        setRoomId(created.roomId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Room setup failed');
      } finally {
        creatingRef.current = false;
        setCreating(false);
      }
    },
    [roomId, enableDucks, pushConfig],
  );

  const changeStage = useCallback(
    async (stageFile: string) => {
      if (!roomId) return;
      setError(null);
      try {
        const added = (await addMP4Input(roomId, stageFile)) as {
          inputId?: string;
        };
        const newInputId = added?.inputId;
        if (!newInputId) throw new Error('Stage input did not register');
        if (stageInputId) {
          await removeInput(roomId, stageInputId);
        }
        await enableDucks(roomId, newInputId);
        setStageInputId(newInputId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Stage swap failed');
      }
    },
    [roomId, stageInputId, enableDucks],
  );

  const startMatch = useCallback(
    async (cfg: ShooterMatchConfig) => {
      if (!roomId) return;
      await controlDuckHunterMatch(roomId, { action: 'start', ...cfg });
    },
    [roomId],
  );

  const stopMatch = useCallback(async () => {
    if (!roomId) return;
    await controlDuckHunterMatch(roomId, { action: 'stop' });
  }, [roomId]);

  const resetMatch = useCallback(async () => {
    if (!roomId) return;
    await controlDuckHunterMatch(roomId, { action: 'reset' });
  }, [roomId]);

  const exitAndDelete = useCallback(async () => {
    const target = roomId;
    setRoomId(null);
    setWhepUrl(null);
    setStageInputId(null);
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
    stageInputId,
    creating,
    error,
    createRoom,
    changeStage,
    pushConfig,
    startMatch,
    stopMatch,
    resetMatch,
    exitAndDelete,
  };
}
