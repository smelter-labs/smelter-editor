'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  FbCamRole,
  FbConfig,
  FbEventEdit,
  FbEventKind,
  FbMatchAction,
  FbPerfConfig,
  FbTeamId,
} from '@smelter-editor/types';
import { FB_DEFAULT_CONFIG, FB_EVENT_KINDS } from '@smelter-editor/types';
import {
  controlFbMatch,
  createNewRoom,
  deleteRoom,
  editFbEvent,
  getRoomInfo,
  setFbConfig,
} from '@/app/actions/actions';
import type { ResolutionPreset } from '@/lib/resolution';

/** Host-side match config in UI units (minutes). */
export type FbUiConfig = {
  teams: Record<FbTeamId, { name: string; short: string; color: string }>;
  halfMin: number;
  /** Take the match clock from the clip's kick-off (events sidecar). */
  clockFromClip: boolean;
  /** Which team attacks the left goal in the footage (null = from the clip). */
  attacksLeft: FbTeamId | null;
  /** The clock ends the halves (HALF TIME / FULL TIME) instead of the moderator. */
  autoFlow: boolean;
  /** Banner-only time before the REPLAY window opens. */
  replayDelayMs: number;
  director: FbConfig['director'];
  ai: FbConfig['ai'];
  replay: boolean;
  minimap: boolean;
  resolution: ResolutionPreset;
  perf: FbPerfConfig;
};

export function sanitizeFbPerf(p?: Partial<FbPerfConfig> | null): FbPerfConfig {
  return {
    animTickHz:
      p?.animTickHz === 30 || p?.animTickHz === 15 ? p.animTickHz : 60,
    hudPublishHz:
      p?.hudPublishHz === 10 || p?.hudPublishHz === 2 ? p.hudPublishHz : 5,
    recordingPreset:
      p?.recordingPreset === 'superfast' ||
      p?.recordingPreset === 'veryfast' ||
      p?.recordingPreset === 'fast' ||
      p?.recordingPreset === 'medium'
        ? p.recordingPreset
        : 'ultrafast',
    recordingScale:
      p?.recordingScale === 0.75 || p?.recordingScale === 0.5
        ? p.recordingScale
        : 1,
  };
}

export function sanitizeFbDirector(
  d?: Partial<FbConfig['director']> | null,
): FbConfig['director'] {
  const base = FB_DEFAULT_CONFIG.director;
  return {
    zoom: d?.zoom === 'tight' || d?.zoom === 'wide' ? d.zoom : 'normal',
    smoothing: d?.smoothing === 'snappy' ? 'snappy' : 'smooth',
    switchStyle: d?.switchStyle === 'cut' ? 'cut' : 'glide',
    lookaheadMs:
      typeof d?.lookaheadMs === 'number' && Number.isFinite(d.lookaheadMs)
        ? Math.round(Math.min(2000, Math.max(0, d.lookaheadMs)))
        : base.lookaheadMs,
  };
}

const isKind = (v: unknown): v is FbEventKind =>
  typeof v === 'string' && (FB_EVENT_KINDS as readonly string[]).includes(v);

export function sanitizeFbAi(
  a?: Partial<FbConfig['ai']> | null,
): FbConfig['ai'] {
  const base = FB_DEFAULT_CONFIG.ai;
  return {
    events: typeof a?.events === 'boolean' ? a.events : base.events,
    kinds: Array.isArray(a?.kinds) ? a.kinds.filter(isKind) : [...base.kinds],
    replayOn: Array.isArray(a?.replayOn)
      ? a.replayOn.filter(isKind)
      : [...base.replayOn],
  };
}

export function sanitizeReplayDelay(ms: unknown): number {
  return typeof ms === 'number' && Number.isFinite(ms)
    ? Math.min(5000, Math.max(0, Math.round(ms / 500) * 500))
    : FB_DEFAULT_CONFIG.replayDelayMs;
}

export const DEFAULT_FB_UI_CONFIG: FbUiConfig = {
  teams: {
    A: { ...FB_DEFAULT_CONFIG.teams.A },
    B: { ...FB_DEFAULT_CONFIG.teams.B },
  },
  halfMin: 45,
  clockFromClip: true,
  attacksLeft: null,
  autoFlow: FB_DEFAULT_CONFIG.autoFlow,
  replayDelayMs: FB_DEFAULT_CONFIG.replayDelayMs,
  director: { ...FB_DEFAULT_CONFIG.director },
  ai: {
    ...FB_DEFAULT_CONFIG.ai,
    kinds: [...FB_DEFAULT_CONFIG.ai.kinds],
    replayOn: [...FB_DEFAULT_CONFIG.ai.replayOn],
  },
  replay: true,
  minimap: true,
  resolution: '1080p',
  perf: { ...FB_DEFAULT_CONFIG.perf },
};

/** Server config (ms) → UI config (minutes). */
export function serverConfigToUi(
  cfg: FbConfig,
  resolution: ResolutionPreset,
): FbUiConfig {
  return {
    teams: { A: { ...cfg.teams.A }, B: { ...cfg.teams.B } },
    halfMin: Math.round(cfg.halfMs / 60000),
    clockFromClip: cfg.clockFromClip,
    attacksLeft: cfg.attacksLeft,
    autoFlow: cfg.autoFlow === true,
    replayDelayMs: sanitizeReplayDelay(cfg.replayDelayMs),
    director: sanitizeFbDirector(cfg.director),
    ai: sanitizeFbAi(cfg.ai),
    replay: cfg.replay,
    minimap: cfg.minimap,
    resolution,
    perf: sanitizeFbPerf(cfg.perf),
  };
}

export function uiConfigToPatch(cfg: FbUiConfig) {
  return {
    teams: cfg.teams,
    halfMs: Math.round(cfg.halfMin * 60000),
    clockFromClip: cfg.clockFromClip,
    attacksLeft: cfg.attacksLeft,
    autoFlow: cfg.autoFlow,
    replayDelayMs: cfg.replayDelayMs,
    director: cfg.director,
    ai: cfg.ai,
    replay: cfg.replay,
    minimap: cfg.minimap,
    perf: cfg.perf,
  };
}

export type FbRoom = {
  roomId: string | null;
  whepUrl: string | null;
  creating: boolean;
  error: string | null;
  roomStatus: 'idle' | 'checking' | 'ok' | 'gone';
  lastError: string | null;
  createRoom(cfg: FbUiConfig): Promise<void>;
  pushConfig(cfg: FbUiConfig): Promise<void>;
  control(action: FbMatchAction, role?: FbCamRole): Promise<void>;
  editEvent(cmd: FbEventEdit): Promise<void>;
  recheck(): Promise<void>;
  exitAndDelete(): Promise<void>;
};

/**
 * Room lifecycle for the /football-game page. One room per production; the
 * output shows the dataset file cameras the server lays out (the panorama
 * through the virtual director, or the camera the cut rule picked).
 */
export function useFbRoom(initialRoomId?: string): FbRoom {
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
    if (lastErrorTimerRef.current != null)
      window.clearTimeout(lastErrorTimerRef.current);
    lastErrorTimerRef.current = window.setTimeout(
      () => setLastError(null),
      4000,
    );
  }, []);

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
    async (cfg: FbUiConfig, room?: string) => {
      const target = room ?? roomId;
      if (!target) return;
      await setFbConfig(target, uiConfigToPatch(cfg));
    },
    [roomId],
  );

  const createRoom = useCallback(
    async (cfg: FbUiConfig) => {
      if (creatingRef.current || roomId) return;
      creatingRef.current = true;
      setCreating(true);
      setError(null);
      try {
        const created = await createNewRoom([], true, cfg.resolution);
        await pushConfig(cfg, created.roomId);
        await controlFbMatch(created.roomId, { action: 'lobby' });
        setWhepUrl(created.whepUrl);
        setRoomId(created.roomId);
        setRoomStatus('ok');
        window.history.replaceState(
          null,
          '',
          `/football-game/${encodeURIComponent(created.roomId)}`,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Match setup failed');
      } finally {
        creatingRef.current = false;
        setCreating(false);
      }
    },
    [roomId, pushConfig],
  );

  const control = useCallback(
    async (action: FbMatchAction, role?: FbCamRole) => {
      if (!roomId) return;
      const { error: refusal } = await controlFbMatch(roomId, {
        action,
        ...(role ? { role } : {}),
      });
      if (refusal) showError(refusal.message);
    },
    [roomId, showError],
  );

  const editEvent = useCallback(
    async (cmd: FbEventEdit) => {
      if (!roomId) return;
      const res = await editFbEvent(roomId, cmd);
      if (!res.event) showError('That edit was refused (unknown event?).');
    },
    [roomId, showError],
  );

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
    window.history.replaceState(null, '', '/football-game');
    if (target) {
      try {
        await deleteRoom(target);
      } catch {
        /* the idle sweep will collect it */
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
    editEvent,
    recheck,
    exitAndDelete,
  };
}
