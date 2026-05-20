'use client';

import { v4 as uuidv4 } from 'uuid';

// ─── V3 types (current) ───────────────────────────────────────────────

export type StoredTransitionConfig = {
  type: string;
  durationMs: number;
};

export type StoredBlockSettings = {
  timelineColor?: string;
  volume: number;
  showTitle: boolean;
  shaders: {
    shaderName: string;
    shaderId: string;
    enabled: boolean;
    params: { paramName: string; paramValue: number | string }[];
  }[];
  text?: string;
  textAlign?: 'left' | 'center' | 'right';
  textColor?: string;
  textMaxLines?: number;
  textScrollEnabled?: boolean;
  textScrollSpeed?: number;
  textScrollLoop?: boolean;
  textFontSize?: number;
  borderColor?: string;
  borderWidth?: number;
  attachedInputIds?: string[];
  gameBackgroundColor?: string;
  gameCellGap?: number;
  gameBoardBorderColor?: string;
  gameBoardBorderWidth?: number;
  gameGridLineColor?: string;
  gameGridLineAlpha?: number;
  snakeEventShaders?: Record<string, unknown>;
  snake1Shaders?: {
    shaderName: string;
    shaderId: string;
    enabled: boolean;
    params: { paramName: string; paramValue: number | string }[];
  }[];
  snake2Shaders?: {
    shaderName: string;
    shaderId: string;
    enabled: boolean;
    params: { paramName: string; paramValue: number | string }[];
  }[];
  absolutePosition?: boolean;
  absoluteTop?: number;
  absoluteLeft?: number;
  absoluteWidth?: number;
  absoluteHeight?: number;
  absoluteTransitionDurationMs?: number;
  absoluteTransitionEasing?: string;
  cropTop?: number;
  cropLeft?: number;
  cropRight?: number;
  cropBottom?: number;
  mp4PlayFromMs?: number;
  mp4Loop?: boolean;
  mp4DurationMs?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  introTransition?: StoredTransitionConfig;
  outroTransition?: StoredTransitionConfig;
  forceInterpolation?: 'step' | 'smooth';
};

export type StoredKeyframe = {
  id: string;
  timeMs: number;
  blockSettings: StoredBlockSettings;
};

export type StoredClip = {
  id: string;
  inputId: string;
  startMs: number;
  endMs: number;
  blockSettings?: StoredBlockSettings;
  keyframes?: StoredKeyframe[];
};

type StoredSegment = StoredClip;

export type StoredTrack = {
  id: string;
  label: string;
  clips: StoredClip[];
  icon?: string;
};

export type StoredTrackGroup = {
  id: string;
  label: string;
  icon?: string;
  collapsed: boolean;
  trackIds: string[];
};

export type StoredTimelineRowRef =
  | { kind: 'track'; id: string }
  | { kind: 'group'; id: string };

type StoredTimelineStateV3 = {
  schemaVersion: 3;
  tracks: StoredTrack[];
  totalDurationMs: number;
  keyframeInterpolationMode: 'step' | 'smooth';
  snapToBlocks: boolean;
  snapToKeyframes: boolean;
  playheadMs: number;
  pixelsPerSecond: number;
};

export type StoredTimelineStateV4 = {
  schemaVersion: 4;
  tracks: StoredTrack[];
  groups: StoredTrackGroup[];
  rootOrder: StoredTimelineRowRef[];
  totalDurationMs: number;
  keyframeInterpolationMode: 'step' | 'smooth';
  snapToBlocks: boolean;
  snapToKeyframes: boolean;
  playheadMs: number;
  pixelsPerSecond: number;
};

// ─── V1 types (kept for migration) ───────────────────────────────────

type StoredSegmentV1 = {
  id: string;
  startMs: number;
  endMs: number;
};

type StoredTrackTimeline = {
  inputId: string;
  segments: StoredSegmentV1[];
};

type StoredOrderKeyframe = {
  id: string;
  timeMs: number;
  inputOrder: string[];
};

type StoredTimelineStateV1 = {
  schemaVersion: 1;
  tracks: Record<string, StoredTrackTimeline>;
  orderKeyframes: StoredOrderKeyframe[];
  totalDurationMs: number;
  playheadMs: number;
  pixelsPerSecond: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────

const STORAGE_KEY_PREFIX = 'smelter-timeline-';

type StoredTimelineStateV2 = {
  schemaVersion: 2;
  tracks: StoredTrack[];
  totalDurationMs: number;
  playheadMs: number;
  pixelsPerSecond: number;
};

function migrateV1toV2(v1: StoredTimelineStateV1): StoredTimelineStateV2 {
  const tracks: StoredTrack[] = Object.entries(v1.tracks).map(
    ([inputId, track]) => ({
      id: uuidv4(),
      label: inputId,
      clips: track.segments.map((s) => ({
        ...s,
        inputId,
      })),
    }),
  );

  return {
    schemaVersion: 2,
    tracks,
    totalDurationMs: v1.totalDurationMs,
    playheadMs: v1.playheadMs,
    pixelsPerSecond: v1.pixelsPerSecond,
  };
}

function migrateV3toV4(v3: StoredTimelineStateV3): StoredTimelineStateV4 {
  return {
    schemaVersion: 4,
    tracks: v3.tracks,
    groups: [],
    rootOrder: v3.tracks.map((t) => ({ kind: 'track' as const, id: t.id })),
    totalDurationMs: v3.totalDurationMs,
    keyframeInterpolationMode: v3.keyframeInterpolationMode,
    snapToBlocks: v3.snapToBlocks,
    snapToKeyframes: v3.snapToKeyframes,
    playheadMs: v3.playheadMs,
    pixelsPerSecond: v3.pixelsPerSecond,
  };
}

function migrateV2toV3(v2: StoredTimelineStateV2): StoredTimelineStateV3 {
  return {
    schemaVersion: 3,
    tracks: v2.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => ({
        ...clip,
        keyframes: clip.blockSettings
          ? [
              {
                id: uuidv4(),
                timeMs: 0,
                blockSettings: clip.blockSettings,
              },
            ]
          : [],
      })),
    })),
    totalDurationMs: v2.totalDurationMs,
    keyframeInterpolationMode: 'step',
    snapToBlocks: true,
    snapToKeyframes: true,
    playheadMs: v2.playheadMs,
    pixelsPerSecond: v2.pixelsPerSecond,
  };
}

// ─── Public API ───────────────────────────────────────────────────────

function sanitizeStoredGroups(value: unknown): StoredTrackGroup[] {
  if (!Array.isArray(value)) return [];
  const out: StoredTrackGroup[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const g = item as Partial<StoredTrackGroup>;
    if (typeof g.id !== 'string') continue;
    if (typeof g.label !== 'string') continue;
    out.push({
      id: g.id,
      label: g.label,
      icon: typeof g.icon === 'string' ? g.icon : undefined,
      collapsed: g.collapsed === true,
      trackIds: Array.isArray(g.trackIds)
        ? g.trackIds.filter((x): x is string => typeof x === 'string')
        : [],
    });
  }
  return out;
}

function sanitizeStoredRootOrder(value: unknown): StoredTimelineRowRef[] {
  if (!Array.isArray(value)) return [];
  const out: StoredTimelineRowRef[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Partial<StoredTimelineRowRef>;
    if (typeof r.id !== 'string') continue;
    if (r.kind !== 'track' && r.kind !== 'group') continue;
    out.push({ kind: r.kind, id: r.id });
  }
  return out;
}

export function loadTimeline(roomId: string): StoredTimelineStateV4 | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${roomId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);

    // V4 — current
    if (
      parsed &&
      parsed.schemaVersion === 4 &&
      typeof parsed.totalDurationMs === 'number' &&
      Array.isArray(parsed.tracks)
    ) {
      const v4 = parsed as Partial<StoredTimelineStateV4>;
      const tracks = Array.isArray(v4.tracks) ? v4.tracks : [];
      const groups = sanitizeStoredGroups(v4.groups);
      const rootOrder = sanitizeStoredRootOrder(v4.rootOrder);
      return {
        schemaVersion: 4,
        tracks,
        groups,
        rootOrder,
        totalDurationMs: v4.totalDurationMs ?? 0,
        keyframeInterpolationMode:
          v4.keyframeInterpolationMode === 'smooth' ? 'smooth' : 'step',
        snapToBlocks: v4.snapToBlocks ?? true,
        snapToKeyframes: v4.snapToKeyframes ?? true,
        playheadMs: v4.playheadMs ?? 0,
        pixelsPerSecond: v4.pixelsPerSecond ?? 15,
      };
    }

    if (
      parsed &&
      parsed.schemaVersion === 3 &&
      typeof parsed.totalDurationMs === 'number' &&
      Array.isArray(parsed.tracks)
    ) {
      const v3 = parsed as Partial<StoredTimelineStateV3>;
      const v3Full: StoredTimelineStateV3 = {
        schemaVersion: 3,
        tracks: Array.isArray(v3.tracks) ? v3.tracks : [],
        totalDurationMs: v3.totalDurationMs ?? 0,
        keyframeInterpolationMode:
          v3.keyframeInterpolationMode === 'smooth' ? 'smooth' : 'step',
        snapToBlocks: v3.snapToBlocks ?? true,
        snapToKeyframes: v3.snapToKeyframes ?? true,
        playheadMs: v3.playheadMs ?? 0,
        pixelsPerSecond: v3.pixelsPerSecond ?? 15,
      };
      return migrateV3toV4(v3Full);
    }

    if (
      parsed &&
      parsed.schemaVersion === 2 &&
      typeof parsed.totalDurationMs === 'number' &&
      Array.isArray(parsed.tracks)
    ) {
      return migrateV3toV4(migrateV2toV3(parsed as StoredTimelineStateV2));
    }

    // V1 with explicit schemaVersion — migrate
    if (
      parsed &&
      parsed.schemaVersion === 1 &&
      typeof parsed.totalDurationMs === 'number' &&
      typeof parsed.tracks === 'object'
    ) {
      return migrateV3toV4(
        migrateV2toV3(migrateV1toV2(parsed as StoredTimelineStateV1)),
      );
    }

    // Old shape without schemaVersion — build V1, then migrate
    if (
      parsed &&
      parsed.schemaVersion === undefined &&
      typeof parsed.totalDurationMs === 'number' &&
      typeof parsed.tracks === 'object'
    ) {
      const asV1: StoredTimelineStateV1 = {
        schemaVersion: 1,
        tracks: parsed.tracks,
        orderKeyframes: parsed.orderKeyframes ?? [],
        totalDurationMs: parsed.totalDurationMs,
        playheadMs:
          typeof parsed.playheadMs === 'number' ? parsed.playheadMs : 0,
        pixelsPerSecond: parsed.pixelsPerSecond ?? 15,
      };
      return migrateV3toV4(migrateV2toV3(migrateV1toV2(asV1)));
    }
  } catch {
    // corrupt data
  }
  return null;
}

export function saveTimeline(
  roomId: string,
  state: Omit<StoredTimelineStateV4, 'schemaVersion'>,
): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: StoredTimelineStateV4 = {
      schemaVersion: 4,
      ...state,
    };
    const json = JSON.stringify(payload);
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${roomId}`, json);
  } catch (err) {
    console.error(
      '[timeline-storage] saveTimeline FAILED — localStorage likely full',
      err,
    );
    pruneOldTimelineEntries(roomId);
    try {
      const payload: StoredTimelineStateV4 = {
        schemaVersion: 4,
        ...state,
      };
      localStorage.setItem(
        `${STORAGE_KEY_PREFIX}${roomId}`,
        JSON.stringify(payload),
      );
    } catch (retryErr) {
      console.error(
        '[timeline-storage] saveTimeline RETRY also failed',
        retryErr,
      );
    }
  }
}

function pruneOldTimelineEntries(keepRoomId: string): void {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (
      key &&
      key.startsWith(STORAGE_KEY_PREFIX) &&
      key !== `${STORAGE_KEY_PREFIX}${keepRoomId}`
    ) {
      keysToRemove.push(key);
    }
  }
  const toRemove = keysToRemove.slice(0, 3);
  for (const key of toRemove) {
    localStorage.removeItem(key);
  }
  if (toRemove.length > 0) {
    console.log(
      `[timeline-storage] pruned ${toRemove.length} old timeline entries`,
    );
  }
}
