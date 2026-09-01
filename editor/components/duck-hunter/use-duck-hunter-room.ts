'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

// Refresh recovery: the live room's identity, stashed per-tab so an
// accidental F5 on the arcade page re-attaches to the running game instead
// of orphaning it (phones stay connected; only the host UI reloads).
const ROOM_STASH_KEY = 'duck-hunter-room';

type RoomStash = {
  roomId: string;
  whepUrl: string | null;
  stageInputId: string | null;
};

function readStash(): RoomStash | null {
  try {
    const raw = window.sessionStorage.getItem(ROOM_STASH_KEY);
    const p = raw ? (JSON.parse(raw) as unknown) : null;
    return p &&
      typeof p === 'object' &&
      typeof (p as RoomStash).roomId === 'string'
      ? (p as RoomStash)
      : null;
  } catch {
    return null;
  }
}

function writeStash(stash: RoomStash | null): void {
  try {
    if (stash) {
      window.sessionStorage.setItem(ROOM_STASH_KEY, JSON.stringify(stash));
    } else {
      window.sessionStorage.removeItem(ROOM_STASH_KEY);
    }
  } catch {
    // Storage blocked — recovery just won't survive the next refresh.
  }
}

export type DuckHunterRoom = {
  roomId: string | null;
  whepUrl: string | null;
  stageInputId: string | null;
  creating: boolean;
  error: string | null;
  /** A page refresh re-attached to a still-running room (see the stash). */
  restored: boolean;
  /** Create the arcade room: stage mp4 input + duck sprites + config. */
  createRoom(
    stageFile: string,
    cfg: DuckHunterSliderConfig,
    setup: ShooterMatchConfig,
  ): Promise<void>;
  /** Swap the hunt-stage video in the existing room (PLAY AGAIN flow). */
  changeStage(stageFile: string): Promise<void>;
  pushConfig(cfg: DuckHunterSliderConfig): Promise<void>;
  startMatch(cfg: ShooterMatchConfig): Promise<void>;
  stopMatch(): Promise<void>;
  /**
   * Tell the server the host is on the lobby screen ('lobby' match phase), so
   * phones hold on the briefing instead of treating the attract mode as open
   * range. Cleared server-side by start/reset. The staged round rides along
   * so the broadcast opening screen can announce it before the match exists.
   */
  armLobby(setup: ShooterMatchConfig): Promise<void>;
  /** EXIT TO TITLE — tear the room down. */
  exitAndDelete(): Promise<void>;
};

/**
 * Room lifecycle for the /duck-hunter arcade page. One room per arcade
 * session, created when the lobby opens; PLAY AGAIN reuses it (phones stay
 * connected, the YOLO sidecar stays warm). No unload-time teardown — an
 * accidental refresh must not kill a live game; instead the stash above
 * re-attaches to it on the next mount, and the server's idle sweep only
 * collects rooms with no live sockets at all.
 */
export function useDuckHunterRoom(): DuckHunterRoom {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [whepUrl, setWhepUrl] = useState<string | null>(null);
  const [stageInputId, setStageInputId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  // Serialize createRoom against double-mount (React strict mode) and
  // impatient clicks.
  const creatingRef = useRef(false);
  const restoreTriedRef = useRef(false);

  // On mount, re-attach to a stashed room if it still exists (page refresh).
  // A dead/deleted room just clears the stash and the arcade boots normally.
  useEffect(() => {
    if (restoreTriedRef.current) return;
    restoreTriedRef.current = true;
    const stash = readStash();
    if (!stash) return;
    void getRoomInfo(stash.roomId)
      .then((info) => {
        if (info === 'not-found') {
          writeStash(null);
          return;
        }
        const stageStillThere = info.inputs.some(
          (i) => i.inputId === stash.stageInputId,
        );
        setStageInputId(
          stageStillThere
            ? stash.stageInputId
            : (info.inputs[0]?.inputId ?? null),
        );
        setWhepUrl(info.whepUrl ?? stash.whepUrl);
        setRoomId(stash.roomId);
        setRestored(true);
      })
      .catch(() => {
        // Server unreachable — leave the stash for the next attempt.
      });
  }, []);

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
      try {
        await setDuckHunterConfig(target, {
          maxAmmo: cfg.maxAmmo,
          reloadMs: Math.round(cfg.reloadSec * 1000),
          duckScale: cfg.duckScale,
          duckPauseMs: Math.round(cfg.fleeSec * 1000),
          duckFlySpeed: cfg.flySpeed,
        });
      } catch (err) {
        // A deleted/GC'd room 404s here — surface it instead of an unhandled
        // rejection with no user-visible trace.
        setError(err instanceof Error ? err.message : 'Config push failed');
        if (room) throw err; // createRoom's own catch owns the create flow
      }
    },
    [roomId],
  );

  const armLobby = useCallback(
    async (cfg: ShooterMatchConfig, room?: string) => {
      const target = room ?? roomId;
      if (!target) return;
      try {
        // The staged round travels with the arm so the broadcast's opening
        // screen can announce it — before 'start' the server has no match to
        // read it from.
        await controlDuckHunterMatch(target, { action: 'lobby', ...cfg });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Lobby arm failed');
        if (room) throw err;
      }
    },
    [roomId],
  );

  const createRoom = useCallback(
    async (
      stageFile: string,
      cfg: DuckHunterSliderConfig,
      setup: ShooterMatchConfig,
    ) => {
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
        // The room is born straight into the arcade lobby (roomId state hasn't
        // committed yet, so pass it explicitly).
        await armLobby(setup, created.roomId);
        setStageInputId(inputId);
        setWhepUrl(created.whepUrl);
        setRoomId(created.roomId);
        writeStash({
          roomId: created.roomId,
          whepUrl: created.whepUrl,
          stageInputId: inputId,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Room setup failed');
      } finally {
        creatingRef.current = false;
        setCreating(false);
      }
    },
    [roomId, enableDucks, pushConfig, armLobby],
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
        writeStash({ roomId, whepUrl, stageInputId: newInputId });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Stage swap failed');
      }
    },
    [roomId, whepUrl, stageInputId, enableDucks],
  );

  const startMatch = useCallback(
    async (cfg: ShooterMatchConfig) => {
      if (!roomId) return;
      try {
        await controlDuckHunterMatch(roomId, { action: 'start', ...cfg });
      } catch (err) {
        // Pressing START against a dead room was an unhandled rejection with
        // no on-screen error — the worst booth failure mode.
        setError(err instanceof Error ? err.message : 'Match start failed');
      }
    },
    [roomId],
  );

  const stopMatch = useCallback(async () => {
    if (!roomId) return;
    try {
      await controlDuckHunterMatch(roomId, { action: 'stop' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Match stop failed');
    }
  }, [roomId]);

  const exitAndDelete = useCallback(async () => {
    const target = roomId;
    setRoomId(null);
    setWhepUrl(null);
    setStageInputId(null);
    setError(null);
    setRestored(false);
    writeStash(null);
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
    restored,
    createRoom,
    changeStage,
    pushConfig,
    startMatch,
    stopMatch,
    armLobby,
    exitAndDelete,
  };
}
