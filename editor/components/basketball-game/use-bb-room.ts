'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BbCamRole,
  BbConfig,
  BbDetectorConfig,
  BbMatchAction,
  BbPerfConfig,
  BbShotEdit,
  BbTeamId,
} from '@smelter-editor/types';
import { BB_DEFAULT_CONFIG, BB_YOLO_WEIGHTS } from '@smelter-editor/types';
import {
  controlBbMatch,
  createNewRoom,
  deleteRoom,
  editBbShot,
  getRoomInfo,
  setBbConfig,
} from '@/app/actions/actions';
import type { ResolutionPreset } from '@/lib/resolution';

/** Host-side match config in UI units (seconds). */
export type BbUiConfig = {
  teams: Record<BbTeamId, { name: string; color: string }>;
  teamSize: 1 | 2 | 3;
  targetPoints: number;
  durationSec: number;
  otWinPoints: number;
  arcPoints: 1 | 2;
  autoAssignMinConf: number;
  shotFrames: boolean;
  detector: BbDetectorConfig;
  /** Broadcast output size — applied at room creation, fixed afterwards. */
  resolution: ResolutionPreset;
  perf: BbPerfConfig;
};

export function sanitizeBbPerf(p?: Partial<BbPerfConfig> | null): BbPerfConfig {
  return {
    animTickHz:
      p?.animTickHz === 30 || p?.animTickHz === 15 ? p.animTickHz : 60,
    hudPublishHz:
      p?.hudPublishHz === 5 || p?.hudPublishHz === 2 ? p.hudPublishHz : 10,
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

export function sanitizeBbDetector(
  d?: Partial<BbDetectorConfig> | null,
): BbDetectorConfig {
  const base = BB_DEFAULT_CONFIG.detector;
  return {
    ballDetector:
      d?.ballDetector === 'yolo' || d?.ballDetector === 'hsv'
        ? d.ballDetector
        : 'auto',
    yoloWeights:
      d?.yoloWeights != null &&
      (BB_YOLO_WEIGHTS as readonly string[]).includes(d.yoloWeights)
        ? d.yoloWeights
        : 'auto',
    imgsz:
      typeof d?.imgsz === 'number' && Number.isFinite(d.imgsz)
        ? Math.round(Math.min(1280, Math.max(320, d.imgsz)) / 32) * 32
        : base.imgsz,
    ballConf:
      typeof d?.ballConf === 'number' && Number.isFinite(d.ballConf)
        ? Math.min(0.9, Math.max(0.05, d.ballConf))
        : base.ballConf,
    analysisFps:
      typeof d?.analysisFps === 'number' && Number.isFinite(d.analysisFps)
        ? Math.round(Math.min(30, Math.max(8, d.analysisFps)))
        : base.analysisFps,
  };
}

export const DEFAULT_BB_UI_CONFIG: BbUiConfig = {
  teams: {
    A: { ...BB_DEFAULT_CONFIG.teams.A },
    B: { ...BB_DEFAULT_CONFIG.teams.B },
  },
  teamSize: 3,
  targetPoints: 21,
  durationSec: 600,
  otWinPoints: 2,
  arcPoints: 2,
  autoAssignMinConf: 0.6,
  shotFrames: true,
  detector: { ...BB_DEFAULT_CONFIG.detector },
  resolution: '1080p',
  perf: { ...BB_DEFAULT_CONFIG.perf },
};

/** Server config (ms) → UI config (seconds). */
export function serverConfigToUi(
  cfg: BbConfig,
  resolution: ResolutionPreset,
): BbUiConfig {
  return {
    teams: { A: { ...cfg.teams.A }, B: { ...cfg.teams.B } },
    teamSize: cfg.teamSize,
    targetPoints: cfg.targetPoints,
    durationSec: Math.round(cfg.durationMs / 1000),
    otWinPoints: cfg.otWinPoints,
    arcPoints: cfg.arcPoints,
    autoAssignMinConf: cfg.autoAssignMinConf,
    shotFrames: cfg.shotFrames,
    detector: sanitizeBbDetector(cfg.detector),
    resolution,
    perf: sanitizeBbPerf(cfg.perf),
  };
}

export function uiConfigToPatch(cfg: BbUiConfig) {
  return {
    teams: cfg.teams,
    teamSize: cfg.teamSize,
    targetPoints: cfg.targetPoints,
    durationMs: Math.round(cfg.durationSec * 1000),
    otWinPoints: cfg.otWinPoints,
    arcPoints: cfg.arcPoints,
    autoAssignMinConf: cfg.autoAssignMinConf,
    shotFrames: cfg.shotFrames,
    detector: cfg.detector,
    perf: cfg.perf,
  };
}

export type BbRoom = {
  roomId: string | null;
  whepUrl: string | null;
  creating: boolean;
  error: string | null;
  roomStatus: 'idle' | 'checking' | 'ok' | 'gone';
  /** The server's reason for the last refused control action (auto-clears). */
  lastError: string | null;
  /** Create the room and open the lobby (cameras may join). */
  createRoom(cfg: BbUiConfig): Promise<void>;
  pushConfig(cfg: BbUiConfig): Promise<void>;
  control(action: BbMatchAction, role?: BbCamRole): Promise<void>;
  editShot(cmd: BbShotEdit): Promise<void>;
  recheck(): Promise<void>;
  exitAndDelete(): Promise<void>;
};

/**
 * Room lifecycle for the /basketball-game page. One room per production; the
 * output shows the phone-camera tiles the server lays out (court main + hoop
 * PiP), the server arms the scorer on the hoop cam as soon as it publishes.
 */
export function useBbRoom(initialRoomId?: string): BbRoom {
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
    async (cfg: BbUiConfig, room?: string) => {
      const target = room ?? roomId;
      if (!target) return;
      await setBbConfig(target, uiConfigToPatch(cfg));
    },
    [roomId],
  );

  const createRoom = useCallback(
    async (cfg: BbUiConfig) => {
      if (creatingRef.current || roomId) return;
      creatingRef.current = true;
      setCreating(true);
      setError(null);
      try {
        const created = await createNewRoom([], true, cfg.resolution);
        await pushConfig(cfg, created.roomId);
        await controlBbMatch(created.roomId, { action: 'lobby' });
        setWhepUrl(created.whepUrl);
        setRoomId(created.roomId);
        setRoomStatus('ok');
        window.history.replaceState(
          null,
          '',
          `/basketball-game/${encodeURIComponent(created.roomId)}`,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Court setup failed');
      } finally {
        creatingRef.current = false;
        setCreating(false);
      }
    },
    [roomId, pushConfig],
  );

  const control = useCallback(
    async (action: BbMatchAction, role?: BbCamRole) => {
      if (!roomId) return;
      const { error: refusal } = await controlBbMatch(roomId, {
        action,
        ...(role ? { role } : {}),
      });
      if (refusal) showError(refusal.message);
    },
    [roomId, showError],
  );

  const editShot = useCallback(
    async (cmd: BbShotEdit) => {
      if (!roomId) return;
      const res = await editBbShot(roomId, cmd);
      if (!res.shot) showError('That edit was refused (unknown shot?).');
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
    window.history.replaceState(null, '', '/basketball-game');
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
    editShot,
    recheck,
    exitAndDelete,
  };
}
