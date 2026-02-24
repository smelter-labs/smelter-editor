'use client';

// ─── V2 types (current) ───────────────────────────────────────────────

export type StoredClip = {
  id: string;
  inputId: string;
  startMs: number;
  endMs: number;
  blockSettings?: {
    volume: number;
    showTitle: boolean;
    shaders: {
      shaderName: string;
      shaderId: string;
      enabled: boolean;
      params: { paramName: string; paramValue: number | string }[];
    }[];
    orientation: 'horizontal' | 'vertical';
    text?: string;
    textAlign?: 'left' | 'center' | 'right';
    textColor?: string;
    textMaxLines?: number;
    textScrollSpeed?: number;
    textScrollLoop?: boolean;
    textFontSize?: number;
    attachedInputIds?: string[];
  };
};

export type StoredSegment = StoredClip;

export type StoredTrack = {
  id: string;
  label: string;
  clips: StoredClip[];
};

export type StoredTimelineStateV2 = {
  schemaVersion: 2;
  tracks: StoredTrack[];
  totalDurationMs: number;
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

export type StoredOrderKeyframe = {
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

// ─── Public API ───────────────────────────────────────────────────────

export function loadTimeline(roomId: string): StoredTimelineStateV2 | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${roomId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);

    // V2 — return directly
    if (
      parsed &&
      parsed.schemaVersion === 2 &&
      typeof parsed.totalDurationMs === 'number' &&
      Array.isArray(parsed.tracks)
    ) {
      return parsed as StoredTimelineStateV2;
    }

    // V1 with explicit schemaVersion — migrate
    if (
      parsed &&
      parsed.schemaVersion === 1 &&
      typeof parsed.totalDurationMs === 'number' &&
      typeof parsed.tracks === 'object'
    ) {
      return migrateV1toV2(parsed as StoredTimelineStateV1);
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
      return migrateV1toV2(asV1);
    }
  } catch {
    // corrupt data
  }
  return null;
}

export function saveTimeline(
  roomId: string,
  state: Omit<StoredTimelineStateV2, 'schemaVersion'>,
): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: StoredTimelineStateV2 = {
      schemaVersion: 2,
      ...state,
    };
    localStorage.setItem(
      `${STORAGE_KEY_PREFIX}${roomId}`,
      JSON.stringify(payload),
    );
  } catch {
    // storage full or unavailable
  }
}
