import type { Input, Layout, ShaderConfig } from '@/app/actions/actions';
import type {
  Segment,
  OrderKeyframe,
} from '@/components/control-panel/hooks/use-timeline-state';

export type RoomConfigInput = {
  type: Input['type'];
  title: string;
  description: string;
  volume: number;
  showTitle?: boolean;
  shaders: ShaderConfig[];
  channelId?: string;
  imageId?: string;
  mp4FileName?: string;
  text?: string;
  textAlign?: 'left' | 'center' | 'right';
  textColor?: string;
  needsConnection?: boolean;
  orientation?: 'horizontal' | 'vertical';
  textMaxLines?: number;
  textScrollSpeed?: number;
  textScrollLoop?: boolean;
  textFontSize?: number;
  attachedInputIndices?: number[];
};

function extractMp4FileName(title: string): string | undefined {
  const match = title.match(/^\[MP4\]\s*(.+)$/);
  if (match) {
    const name = match[1].trim();
    return name.toLowerCase().replace(/\s+/g, '_') + '.mp4';
  }
  return undefined;
}

export type RoomConfigTransitionSettings = {
  swapDurationMs?: number;
  swapOutgoingEnabled?: boolean;
  swapFadeInDurationMs?: number;
  swapFadeOutDurationMs?: number;
  newsStripFadeDuringSwap?: boolean;
  newsStripEnabled?: boolean;
};

export type RoomConfigTrackTimeline = {
  inputIndex: number;
  segments: { startMs: number; endMs: number }[];
};

export type RoomConfigOrderKeyframe = {
  timeMs: number;
  inputOrderIndices: number[];
};

export type RoomConfigTimeline = {
  totalDurationMs: number;
  pixelsPerSecond: number;
  tracks: RoomConfigTrackTimeline[];
  orderKeyframes: RoomConfigOrderKeyframe[];
};

export type RoomConfig = {
  version: 1;
  layout: Layout;
  inputs: RoomConfigInput[];
  resolution?: { width: number; height: number };
  transitionSettings?: RoomConfigTransitionSettings;
  timeline?: RoomConfigTimeline;
  exportedAt: string;
};

export function exportRoomConfig(
  inputs: Input[],
  layout: Layout,
  resolution?: { width: number; height: number },
  transitionSettings?: RoomConfigTransitionSettings,
  timelineState?: {
    tracks: Record<string, { inputId: string; segments: Segment[] }>;
    orderKeyframes: OrderKeyframe[];
    totalDurationMs: number;
    pixelsPerSecond: number;
  },
): RoomConfig {
  const inputIdToIndex = new Map<string, number>();
  inputs.forEach((input, idx) => inputIdToIndex.set(input.inputId, idx));

  let timeline: RoomConfigTimeline | undefined;
  if (timelineState) {
    const tracks: RoomConfigTrackTimeline[] = [];
    for (const [inputId, track] of Object.entries(timelineState.tracks)) {
      const idx = inputIdToIndex.get(inputId);
      if (idx === undefined) continue;
      tracks.push({
        inputIndex: idx,
        segments: track.segments.map((s) => ({
          startMs: s.startMs,
          endMs: s.endMs,
        })),
      });
    }
    timeline = {
      totalDurationMs: timelineState.totalDurationMs,
      pixelsPerSecond: timelineState.pixelsPerSecond,
      tracks,
      orderKeyframes: timelineState.orderKeyframes.map((kf) => ({
        timeMs: kf.timeMs,
        inputOrderIndices: kf.inputOrder
          .map((id) => inputIdToIndex.get(id))
          .filter((idx): idx is number => idx !== undefined),
      })),
    };
  }

  return {
    version: 1,
    layout,
    resolution,
    transitionSettings,
    timeline,
    inputs: inputs.map((input) => ({
      type: input.type,
      title: input.title,
      description: input.description,
      volume: input.volume,
      showTitle: input.showTitle,
      shaders: input.shaders,
      channelId: input.channelId,
      imageId: input.imageId,
      mp4FileName:
        input.type === 'local-mp4'
          ? extractMp4FileName(input.title)
          : undefined,
      text: input.text,
      textAlign: input.textAlign,
      textColor: input.textColor,
      needsConnection: input.type === 'whip',
      orientation: input.orientation,
      textMaxLines: input.textMaxLines,
      textScrollSpeed: input.textScrollSpeed,
      textScrollLoop: input.textScrollLoop,
      textFontSize: input.textFontSize,
      attachedInputIndices: input.attachedInputIds
        ?.map((id) => inputIdToIndex.get(id))
        .filter((idx): idx is number => idx !== undefined),
    })),
    exportedAt: new Date().toISOString(),
  };
}

export function downloadRoomConfig(config: RoomConfig, filename?: string) {
  const json = JSON.stringify(config, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `room-config-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function parseRoomConfig(json: string): RoomConfig {
  const config = JSON.parse(json);
  if (config.version !== 1) {
    throw new Error(`Unsupported config version: ${config.version}`);
  }
  if (!config.layout || !Array.isArray(config.inputs)) {
    throw new Error('Invalid config format');
  }
  return config as RoomConfig;
}

const TIMELINE_STORAGE_KEY_PREFIX = 'smelter-timeline-';

export function loadTimelineFromStorage(roomId: string): {
  tracks: Record<string, { inputId: string; segments: Segment[] }>;
  orderKeyframes: OrderKeyframe[];
  totalDurationMs: number;
  pixelsPerSecond: number;
} | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${TIMELINE_STORAGE_KEY_PREFIX}${roomId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.totalDurationMs === 'number' &&
      typeof parsed.tracks === 'object'
    ) {
      return parsed;
    }
  } catch {
    // corrupt data
  }
  return null;
}

export function restoreTimelineToStorage(
  roomId: string,
  timeline: RoomConfigTimeline,
  indexToInputId: Map<number, string>,
): void {
  if (typeof window === 'undefined') return;

  const tracks: Record<string, { inputId: string; segments: Segment[] }> = {};
  for (const track of timeline.tracks) {
    const inputId = indexToInputId.get(track.inputIndex);
    if (!inputId) continue;
    tracks[inputId] = {
      inputId,
      segments: track.segments.map((s) => ({
        id: crypto.randomUUID(),
        startMs: s.startMs,
        endMs: s.endMs,
      })),
    };
  }

  const orderKeyframes: OrderKeyframe[] = timeline.orderKeyframes.map((kf) => ({
    id: crypto.randomUUID(),
    timeMs: kf.timeMs,
    inputOrder: kf.inputOrderIndices
      .map((idx) => indexToInputId.get(idx))
      .filter((id): id is string => !!id),
  }));

  const state = {
    tracks,
    orderKeyframes,
    totalDurationMs: timeline.totalDurationMs,
    playheadMs: 0,
    pixelsPerSecond: timeline.pixelsPerSecond,
  };

  try {
    localStorage.setItem(
      `${TIMELINE_STORAGE_KEY_PREFIX}${roomId}`,
      JSON.stringify(state),
    );
  } catch {
    console.warn('Failed to save imported timeline to localStorage');
  }
}

const PENDING_WHIP_STORAGE_KEY = 'smelter-pending-whip-inputs';

export type StoredPendingWhipInput = {
  id: string;
  title: string;
  config: RoomConfigInput;
  position: number;
};

export function savePendingWhipInputs(
  roomId: string,
  inputs: StoredPendingWhipInput[],
) {
  if (typeof window === 'undefined') return;
  const key = `${PENDING_WHIP_STORAGE_KEY}-${roomId}`;
  try {
    if (inputs.length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(inputs));
    }
  } catch (e) {
    console.warn('Failed to save pending WHIP inputs:', e);
  }
}

export function loadPendingWhipInputs(
  roomId: string,
): StoredPendingWhipInput[] {
  if (typeof window === 'undefined') return [];
  const key = `${PENDING_WHIP_STORAGE_KEY}-${roomId}`;
  try {
    const data = localStorage.getItem(key);
    if (data) {
      return JSON.parse(data);
    }
  } catch (e) {
    console.warn('Failed to load pending WHIP inputs:', e);
  }
  return [];
}
