'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  FbCamRole,
  FbConfig,
  FbDirectorPatch,
  FbEventEdit,
  FbEventKind,
  FbMatchAction,
  FbMinimapSize,
  FbPerfConfig,
  FbTeamId,
} from '@smelter-editor/types';
import {
  FB_DEFAULT_CONFIG,
  FB_DIRECTOR_LIMITS,
  FB_EVENT_KINDS,
  FB_MINIMAP_SIZES,
  FB_SMOOTHING_PRESET_MS,
} from '@smelter-editor/types';
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
  /** Which team attacks the left goal of the picture in the first half (null = from the clip). */
  attacksLeft: FbTeamId | null;
  director: FbConfig['director'];
  ai: FbConfig['ai'];
  replay: boolean;
  minimap: boolean;
  minimapSize: FbMinimapSize;
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

/** `d` may be a config saved before the numeric knobs (it carries `smoothing`). */
export function sanitizeFbDirector(
  d?: FbDirectorPatch | null,
): FbConfig['director'] {
  const base = FB_DEFAULT_CONFIG.director;
  const num = (key: keyof typeof FB_DIRECTOR_LIMITS, fallback: number) => {
    const v = d?.[key];
    const lim = FB_DIRECTOR_LIMITS[key];
    return typeof v === 'number' && Number.isFinite(v)
      ? Math.round(Math.min(lim.max, Math.max(lim.min, v)))
      : fallback;
  };
  return {
    zoom: d?.zoom === 'tight' || d?.zoom === 'wide' ? d.zoom : 'normal',
    switchStyle: d?.switchStyle === 'cut' ? 'cut' : 'glide',
    lookaheadMs: num('lookaheadMs', base.lookaheadMs),
    averageMs: num('averageMs', base.averageMs),
    smoothTimeMs: num(
      'smoothTimeMs',
      d?.smoothing === 'snappy' || d?.smoothing === 'smooth'
        ? FB_SMOOTHING_PRESET_MS[d.smoothing]
        : base.smoothTimeMs,
    ),
    deadZonePx: num('deadZonePx', base.deadZonePx),
    maxSpeedPxS: num('maxSpeedPxS', base.maxSpeedPxS),
    catchUp: typeof d?.catchUp === 'boolean' ? d.catchUp : base.catchUp,
  };
}

export function sanitizeFbMinimapSize(v: unknown): FbMinimapSize {
  return (FB_MINIMAP_SIZES as readonly unknown[]).includes(v)
    ? (v as FbMinimapSize)
    : FB_DEFAULT_CONFIG.minimapSize;
}

/** Follow feel presets: one tap fills the numeric knobs. */
export const FB_FOLLOW_PRESETS: {
  id: string;
  label: string;
  values: Pick<
    FbConfig['director'],
    'smoothTimeMs' | 'deadZonePx' | 'maxSpeedPxS' | 'averageMs'
  >;
}[] = [
  {
    id: 'snappy',
    label: 'SNAPPY',
    values: {
      smoothTimeMs: 350,
      deadZonePx: 40,
      maxSpeedPxS: 1600,
      averageMs: 100,
    },
  },
  {
    id: 'smooth',
    label: 'SMOOTH',
    values: {
      smoothTimeMs: 600,
      deadZonePx: 60,
      maxSpeedPxS: 1200,
      averageMs: 200,
    },
  },
  {
    id: 'cinematic',
    label: 'CINEMATIC',
    values: {
      smoothTimeMs: 1200,
      deadZonePx: 120,
      maxSpeedPxS: 900,
      averageMs: 500,
    },
  },
];

export function fbFollowPresetOf(d: FbConfig['director']): string | null {
  return (
    FB_FOLLOW_PRESETS.find((p) =>
      (Object.keys(p.values) as (keyof typeof p.values)[]).every(
        (k) => p.values[k] === d[k],
      ),
    )?.id ?? null
  );
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

export const DEFAULT_FB_UI_CONFIG: FbUiConfig = {
  teams: {
    A: { ...FB_DEFAULT_CONFIG.teams.A },
    B: { ...FB_DEFAULT_CONFIG.teams.B },
  },
  halfMin: 45,
  clockFromClip: true,
  attacksLeft: null,
  director: { ...FB_DEFAULT_CONFIG.director },
  ai: {
    ...FB_DEFAULT_CONFIG.ai,
    kinds: [...FB_DEFAULT_CONFIG.ai.kinds],
    replayOn: [...FB_DEFAULT_CONFIG.ai.replayOn],
  },
  replay: true,
  minimap: true,
  minimapSize: FB_DEFAULT_CONFIG.minimapSize,
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
    director: sanitizeFbDirector(cfg.director),
    ai: sanitizeFbAi(cfg.ai),
    replay: cfg.replay,
    minimap: cfg.minimap,
    minimapSize: sanitizeFbMinimapSize(cfg.minimapSize),
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
    director: cfg.director,
    ai: cfg.ai,
    replay: cfg.replay,
    minimap: cfg.minimap,
    minimapSize: cfg.minimapSize,
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
