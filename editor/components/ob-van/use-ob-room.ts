'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ObCamRole,
  ObConfigPatch,
  ObControlAction,
  ObOperatorCommand,
  ObRuleset,
  ObState,
} from '@smelter-editor/types';
import {
  adoptObInput,
  attachObMp4Cam,
  controlObShow,
  createNewRoom,
  deleteRoom,
  getRoomInfo,
  operateOb,
  setObConfig,
  setObRuleset,
  syncObFileCams,
} from '@/app/actions/actions';
import type { ObApiError, ObResult } from '@/lib/api-client';
import { uiConfigToPatch, type ObUiConfig } from '@/lib/ob-van/ui-config';

export type ObRoom = {
  roomId: string | null;
  whepUrl: string | null;
  creating: boolean;
  error: string | null;
  roomStatus: 'idle' | 'checking' | 'ok' | 'gone';
  /** Last refused command (auto-clears after a few seconds). */
  lastError: string | null;
  showError: (message: string) => void;
  /** Resolves with the new room id (null when refused or failed). */
  createRoom(cfg: ObUiConfig): Promise<string | null>;
  pushConfig(cfg: ObUiConfig): Promise<void>;
  /** Push only some sections (the live diff). */
  pushPatch(patch: ObConfigPatch): Promise<boolean>;
  attachFileCam(cam: {
    role: ObCamRole;
    fileName: string;
    name?: string;
    talent?: string;
    subtitle?: string;
  }): Promise<string | null>;
  /** Restart every file camera from 0:00 together. */
  syncFileCams(): Promise<void>;
  adoptInput(cam: {
    inputId: string;
    role: ObCamRole;
    name?: string;
    talent?: string;
  }): Promise<string | null>;
  control(action: ObControlAction, camId?: string): Promise<ObState | null>;
  /** Host desk command over REST (no seat needed). */
  operate(cmd: ObOperatorCommand): Promise<ObState | null>;
  /** Validated server-side; the caller shows warnings / errors. */
  applyRuleset(
    ruleset: ObRuleset | unknown,
  ): Promise<ObResult<{ ruleset: ObRuleset; warnings: string[] }>>;
  recheck(): Promise<void>;
  exitAndDelete(): Promise<void>;
};

const ERROR_SHOW_MS = 4500;

export function describeObError(error: ObApiError): string {
  if (error.errors?.length) return `${error.message}: ${error.errors[0]}`;
  return error.message;
}

/**
 * Room lifecycle for the /ob-van host (a clone of useFbRoom): one room per
 * event, created at NEW EVENT so phones and file cams can join during
 * SETUP. The URL is rewritten to /ob-van/<id> so a refresh rejoins.
 */
export function useObRoom(
  initialRoomId?: string,
  onState?: (state: ObState) => void,
): ObRoom {
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
  const roomIdRef = useRef(roomId);
  roomIdRef.current = roomId;
  const onStateRef = useRef(onState);
  onStateRef.current = onState;

  const showError = useCallback((message: string) => {
    setLastError(message);
    if (lastErrorTimerRef.current != null)
      window.clearTimeout(lastErrorTimerRef.current);
    lastErrorTimerRef.current = window.setTimeout(
      () => setLastError(null),
      ERROR_SHOW_MS,
    );
  }, []);

  useEffect(() => {
    return () => {
      if (lastErrorTimerRef.current != null)
        window.clearTimeout(lastErrorTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!initialRoomId) return;
    let cancelled = false;
    void getRoomInfo(initialRoomId)
      .then((info) => {
        if (cancelled) return;
        if (info && info !== 'not-found') {
          setWhepUrl(info.whepUrl ?? null);
          setRoomStatus('ok');
        } else {
          setRoomId(null);
          setRoomStatus('gone');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setRoomId(null);
        setRoomStatus('gone');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Unwrap an ObResult: state → onState, error → the toast. */
  const settle = useCallback(
    <T>(res: ObResult<T>): T | null => {
      if (res.ok) return res.value;
      showError(describeObError(res.error));
      return null;
    },
    [showError],
  );

  const pushPatch = useCallback(
    async (patch: ObConfigPatch, room?: string) => {
      const target = room ?? roomIdRef.current;
      if (!target || Object.keys(patch).length === 0) return false;
      try {
        return settle(await setObConfig(target, patch)) != null;
      } catch (err) {
        showError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [settle, showError],
  );

  const pushConfig = useCallback(
    async (cfg: ObUiConfig, room?: string) => {
      await pushPatch(uiConfigToPatch(cfg), room);
    },
    [pushPatch],
  );

  const createRoom = useCallback(
    async (cfg: ObUiConfig): Promise<string | null> => {
      if (creatingRef.current || roomIdRef.current) return null;
      creatingRef.current = true;
      setCreating(true);
      setError(null);
      try {
        const created = await createNewRoom([], true, cfg.resolution);
        await pushConfig(cfg, created.roomId);
        const setup = await controlObShow(created.roomId, 'setup');
        if (!setup.ok) throw new Error(describeObError(setup.error));
        onStateRef.current?.(setup.value);
        setWhepUrl(created.whepUrl);
        setRoomId(created.roomId);
        setRoomStatus('ok');
        window.history.replaceState(
          null,
          '',
          `/ob-van/${encodeURIComponent(created.roomId)}`,
        );
        return created.roomId;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Event setup failed');
        return null;
      } finally {
        creatingRef.current = false;
        setCreating(false);
      }
    },
    [pushConfig],
  );

  const attachFileCam = useCallback(
    async (cam: {
      role: ObCamRole;
      fileName: string;
      name?: string;
      talent?: string;
      subtitle?: string;
    }) => {
      const target = roomIdRef.current;
      if (!target) return null;
      try {
        return settle(await attachObMp4Cam(target, cam))?.camId ?? null;
      } catch (err) {
        showError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [settle, showError],
  );

  const syncFileCams = useCallback(async () => {
    const target = roomIdRef.current;
    if (!target) return;
    settle(await syncObFileCams(target, 0));
  }, [settle]);

  const adoptInput = useCallback(
    async (cam: {
      inputId: string;
      role: ObCamRole;
      name?: string;
      talent?: string;
    }) => {
      const target = roomIdRef.current;
      if (!target) return null;
      return settle(await adoptObInput(target, cam))?.camId ?? null;
    },
    [settle],
  );

  const control = useCallback(
    async (action: ObControlAction, camId?: string) => {
      const target = roomIdRef.current;
      if (!target) return null;
      try {
        const state = settle(await controlObShow(target, action, camId));
        if (state) onStateRef.current?.(state);
        return state;
      } catch (err) {
        showError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [settle, showError],
  );

  const operate = useCallback(
    async (cmd: ObOperatorCommand) => {
      const target = roomIdRef.current;
      if (!target) return null;
      try {
        const state = settle(await operateOb(target, cmd));
        if (state) onStateRef.current?.(state);
        return state;
      } catch (err) {
        showError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [settle, showError],
  );

  const applyRuleset = useCallback(async (ruleset: ObRuleset | unknown) => {
    const target = roomIdRef.current;
    if (!target)
      return {
        ok: false as const,
        error: { code: 'no_room', message: 'No event yet' },
      };
    return setObRuleset(target, ruleset);
  }, []);

  const recheck = useCallback(async () => {
    const target = roomIdRef.current;
    if (!target) return;
    const info = await getRoomInfo(target).catch(() => null);
    if (info === 'not-found') {
      setRoomId(null);
      setRoomStatus('gone');
    }
  }, []);

  const exitAndDelete = useCallback(async () => {
    const target = roomIdRef.current;
    setRoomId(null);
    setWhepUrl(null);
    setError(null);
    setRoomStatus('idle');
    window.history.replaceState(null, '', '/ob-van');
    if (target) {
      try {
        await deleteRoom(target);
      } catch {
        /* the idle sweep will collect it */
      }
    }
  }, []);

  return {
    roomId,
    whepUrl,
    creating,
    error,
    roomStatus,
    lastError,
    showError,
    createRoom,
    pushConfig,
    pushPatch,
    attachFileCam,
    syncFileCams,
    adoptInput,
    control,
    operate,
    applyRuleset,
    recheck,
    exitAndDelete,
  };
}
