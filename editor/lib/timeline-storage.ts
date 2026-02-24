'use client';

export type StoredSegment = {
  id: string;
  startMs: number;
  endMs: number;
};

export type StoredTrackTimeline = {
  inputId: string;
  segments: StoredSegment[];
};

export type StoredOrderKeyframe = {
  id: string;
  timeMs: number;
  inputOrder: string[];
};

export type StoredTimelineStateV1 = {
  schemaVersion: 1;
  tracks: Record<string, StoredTrackTimeline>;
  orderKeyframes: StoredOrderKeyframe[];
  totalDurationMs: number;
  playheadMs: number;
  pixelsPerSecond: number;
};

const STORAGE_KEY_PREFIX = 'smelter-timeline-';

export function loadTimeline(roomId: string): StoredTimelineStateV1 | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${roomId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);

    // v1 with explicit schemaVersion
    if (
      parsed &&
      parsed.schemaVersion === 1 &&
      typeof parsed.totalDurationMs === 'number' &&
      typeof parsed.tracks === 'object'
    ) {
      return parsed as StoredTimelineStateV1;
    }

    // Backwards compatibility: old shape without schemaVersion
    if (
      parsed &&
      parsed.schemaVersion === undefined &&
      typeof parsed.totalDurationMs === 'number' &&
      typeof parsed.tracks === 'object'
    ) {
      const migrated: StoredTimelineStateV1 = {
        schemaVersion: 1,
        tracks: parsed.tracks,
        orderKeyframes: parsed.orderKeyframes ?? [],
        totalDurationMs: parsed.totalDurationMs,
        playheadMs: typeof parsed.playheadMs === 'number' ? parsed.playheadMs : 0,
        pixelsPerSecond: parsed.pixelsPerSecond ?? 15,
      };
      return migrated;
    }
  } catch {
    // corrupt data
  }
  return null;
}

export function saveTimeline(
  roomId: string,
  state: Omit<StoredTimelineStateV1, 'schemaVersion'>,
): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: StoredTimelineStateV1 = {
      schemaVersion: 1,
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

