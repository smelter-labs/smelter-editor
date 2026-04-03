'use client';

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
};

type StoredTimelineStateV3 = {
  schemaVersion: 3;
  tracks: StoredTrack[];
  totalDurationMs: number;
  keyframeInterpolationMode: 'step' | 'smooth';
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
      id: crypto.randomUUID(),
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
                id: crypto.randomUUID(),
                timeMs: 0,
                blockSettings: clip.blockSettings,
              },
            ]
          : [],
      })),
    })),
    totalDurationMs: v2.totalDurationMs,
    keyframeInterpolationMode: 'step',
    playheadMs: v2.playheadMs,
    pixelsPerSecond: v2.pixelsPerSecond,
  };
}

// ─── Public API ───────────────────────────────────────────────────────

export function loadTimeline(roomId: string): StoredTimelineStateV3 | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${roomId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);

    // V2 — return directly
    if (
      parsed &&
      parsed.schemaVersion === 3 &&
      typeof parsed.totalDurationMs === 'number' &&
      Array.isArray(parsed.tracks)
    ) {
      return parsed as StoredTimelineStateV3;
    }

    if (
      parsed &&
      parsed.schemaVersion === 2 &&
      typeof parsed.totalDurationMs === 'number' &&
      Array.isArray(parsed.tracks)
    ) {
      return migrateV2toV3(parsed as StoredTimelineStateV2);
    }

    // V1 with explicit schemaVersion — migrate
    if (
      parsed &&
      parsed.schemaVersion === 1 &&
      typeof parsed.totalDurationMs === 'number' &&
      typeof parsed.tracks === 'object'
    ) {
      return migrateV2toV3(migrateV1toV2(parsed as StoredTimelineStateV1));
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
      return migrateV2toV3(migrateV1toV2(asV1));
    }
  } catch {
    // corrupt data
  }
  return null;
}

export function saveTimeline(
  roomId: string,
  state: Omit<StoredTimelineStateV3, 'schemaVersion'>,
): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: StoredTimelineStateV3 = {
      schemaVersion: 3,
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
      const payload: StoredTimelineStateV3 = {
        schemaVersion: 3,
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
