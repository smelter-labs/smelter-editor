'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShooterMatchConfig } from '@smelter-editor/types';
import {
  addHlsInput,
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

/** A hunting-grounds pick: a server-library mp4 or a (saved) HLS stream. */
export type StageRef =
  { kind: 'mp4'; file: string } | { kind: 'hls'; url: string; name: string };

/** Stable identity for pinning/highlight/dirty checks across stage kinds. */
export function stageKey(s: StageRef): string {
  return s.kind === 'mp4' ? `mp4:${s.file}` : `hls:${s.url}`;
}

/** Row label in the stage list. */
export function stageLabel(s: StageRef): string {
  return s.kind === 'mp4' ? s.file : s.name;
}

/** Register the stage as a room input; both endpoints answer {inputId}. */
async function addStageInput(roomId: string, stage: StageRef) {
  return stage.kind === 'mp4'
    ? await addMP4Input(roomId, stage.file)
    : await addHlsInput(roomId, stage.url);
}

/** Slider values in UI units (seconds), converted to ms on push. */
export type DuckHunterSliderConfig = {
  maxAmmo: number;
  reloadSec: number;
  duckScale: number;
  /** Spawn telegraph: how long the aura marks a bird before its duck appears. */
  auraLeadSec: number;
  fleeSec: number;
  flySpeed: number;
  /** Name badges above crosshairs on the broadcast (off = thicker reticle). */
  crosshairBadges: boolean;
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
  /**
   * 'idle' = no room yet (title/config), 'checking' = validating a
   * URL-provided roomId, 'ok' = room confirmed live, 'gone' = the
   * URL-provided room no longer exists.
   */
  roomStatus: 'idle' | 'checking' | 'ok' | 'gone';
  /** Create the arcade room: stage input (mp4/HLS) + duck sprites + config. */
  createRoom(
    stage: StageRef,
    cfg: DuckHunterSliderConfig,
    setup: ShooterMatchConfig,
  ): Promise<void>;
  /** Swap the hunt-stage video in the existing room (PLAY AGAIN flow). */
  changeStage(stage: StageRef): Promise<void>;
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
  /**
   * Remove one hunter from the roster, freeing their slot and their character.
   * The server notifies the phone, which drops back to its wizard — it may
   * rejoin, but only on a deliberate tap.
   */
  kickPlayer(clientId: string): Promise<void>;
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
export function useDuckHunterRoom(initialRoomId?: string): DuckHunterRoom {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [whepUrl, setWhepUrl] = useState<string | null>(null);
  const [stageInputId, setStageInputId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [roomStatus, setRoomStatus] = useState<
    'idle' | 'checking' | 'ok' | 'gone'
  >(initialRoomId ? 'checking' : 'idle');
  // Serialize createRoom against double-mount (React strict mode) and
  // impatient clicks.
  const creatingRef = useRef(false);
  const restoreTriedRef = useRef(false);

  // On mount, re-attach to a still-running room. A roomId from the URL
  // (/duck-hunter/[roomId]) wins over the per-tab stash — a stale stash from
  // an earlier session must not hijack the room the link points at. Without
  // one, fall back to the stash (page refresh on plain /duck-hunter); a
  // dead/deleted room just clears the stash and the arcade boots normally.
  useEffect(() => {
    if (restoreTriedRef.current) return;
    restoreTriedRef.current = true;
    const stash = readStash();
    if (initialRoomId) {
      void getRoomInfo(initialRoomId)
        .then((info) => {
          if (info === 'not-found') {
            if (stash?.roomId === initialRoomId) writeStash(null);
            setRoomStatus('gone');
            return;
          }
          const stashedInput =
            stash?.roomId === initialRoomId ? stash.stageInputId : null;
          const stageStillThere = info.inputs.some(
            (i) => i.inputId === stashedInput,
          );
          const inputId = stageStillThere
            ? stashedInput
            : (info.inputs[0]?.inputId ?? null);
          const whep = info.whepUrl ?? null;
          setStageInputId(inputId);
          setWhepUrl(whep);
          setRoomId(initialRoomId);
          setRestored(true);
          setRoomStatus('ok');
          writeStash({
            roomId: initialRoomId,
            whepUrl: whep,
            stageInputId: inputId,
          });
        })
        .catch(() => {
          // Server unreachable — a refresh retries; don't declare it gone.
        });
      return;
    }
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
        setRoomStatus('ok');
      })
      .catch(() => {
        // Server unreachable — leave the stash for the next attempt.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          duckAuraLeadMs: Math.round(cfg.auraLeadSec * 1000),
          duckPauseMs: Math.round(cfg.fleeSec * 1000),
          duckFlySpeed: cfg.flySpeed,
          crosshairBadges: cfg.crosshairBadges,
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
      stage: StageRef,
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
        const added = (await addStageInput(created.roomId, stage)) as {
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
        setRoomStatus('ok');
        writeStash({
          roomId: created.roomId,
          whepUrl: created.whepUrl,
          stageInputId: inputId,
        });
        // Put the room in the URL so the landing page (or a refresh in a
        // fresh tab) can rejoin — replaceState (not router.replace) so the
        // arcade doesn't remount mid-session.
        window.history.replaceState(
          null,
          '',
          `/duck-hunter/${encodeURIComponent(created.roomId)}`,
        );
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
    async (stage: StageRef) => {
      if (!roomId) return;
      setError(null);
      try {
        const added = (await addStageInput(roomId, stage)) as {
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

  const kickPlayer = useCallback(
    async (clientId: string) => {
      if (!roomId) return;
      try {
        await controlDuckHunterMatch(roomId, { action: 'kick', clientId });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Kick failed');
      }
    },
    [roomId],
  );

  const exitAndDelete = useCallback(async () => {
    const target = roomId;
    setRoomId(null);
    setWhepUrl(null);
    setStageInputId(null);
    setError(null);
    setRestored(false);
    setRoomStatus('idle');
    writeStash(null);
    window.history.replaceState(null, '', '/duck-hunter');
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
    roomStatus,
    createRoom,
    changeStage,
    pushConfig,
    startMatch,
    stopMatch,
    armLobby,
    kickPlayer,
    exitAndDelete,
  };
}
