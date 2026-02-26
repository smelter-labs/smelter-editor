import type { Input, Layout, ShaderConfig } from '@/app/actions/actions';
import type {
  Clip,
  Track,
} from '@/components/control-panel/hooks/use-timeline-state';
import { createBlockSettingsFromInput } from '@/components/control-panel/hooks/use-timeline-state';
import { loadTimeline, saveTimeline } from '@/lib/timeline-storage';

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
  borderColor?: string;
  borderWidth?: number;
  gameBackgroundColor?: string;
  gameCellGap?: number;
  gameBoardBorderColor?: string;
  gameBoardBorderWidth?: number;
  gameGridLineColor?: string;
  gameGridLineAlpha?: number;
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

export type RoomConfigClip = {
  inputIndex: number;
  startMs: number;
  endMs: number;
  blockSettings?: Clip['blockSettings'];
};

export type RoomConfigTrack = {
  label: string;
  clips: RoomConfigClip[];
};

export type RoomConfigTimeline = {
  totalDurationMs: number;
  pixelsPerSecond: number;
  tracks: RoomConfigTrack[];
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
    tracks: Track[];
    totalDurationMs: number;
    pixelsPerSecond: number;
  },
): RoomConfig {
  const inputIdToIndex = new Map<string, number>();
  inputs.forEach((input, idx) => inputIdToIndex.set(input.inputId, idx));

  let timeline: RoomConfigTimeline | undefined;
  if (timelineState) {
    const tracks: RoomConfigTrack[] = timelineState.tracks.map((track) => ({
      label: track.label,
      clips: track.clips
        .map((clip) => {
          const idx = inputIdToIndex.get(clip.inputId);
          if (idx === undefined) return null;
          return {
            inputIndex: idx,
            startMs: clip.startMs,
            endMs: clip.endMs,
            blockSettings: clip.blockSettings,
          } as RoomConfigClip;
        })
        .filter((c): c is RoomConfigClip => c !== null),
    }));
    timeline = {
      totalDurationMs: timelineState.totalDurationMs,
      pixelsPerSecond: timelineState.pixelsPerSecond,
      tracks,
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
      borderColor: input.borderColor,
      borderWidth: input.borderWidth,
      gameBackgroundColor: input.gameBackgroundColor,
      gameCellGap: input.gameCellGap,
      gameBoardBorderColor: input.gameBoardBorderColor,
      gameBoardBorderWidth: input.gameBoardBorderWidth,
      gameGridLineColor: input.gameGridLineColor,
      gameGridLineAlpha: input.gameGridLineAlpha,
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

export function loadTimelineFromStorage(roomId: string): {
  tracks: Track[];
  totalDurationMs: number;
  pixelsPerSecond: number;
} | null {
  if (typeof window === 'undefined') return null;
  const stored = loadTimeline(roomId);
  if (!stored) return null;
  return {
    tracks: stored.tracks.map((t) => ({
      id: t.id,
      label: t.label,
      clips: t.clips.map((c) => ({
        id: c.id,
        inputId: c.inputId,
        startMs: c.startMs,
        endMs: c.endMs,
        blockSettings:
          c.blockSettings ?? createBlockSettingsFromInput(undefined),
      })),
    })),
    totalDurationMs: stored.totalDurationMs,
    pixelsPerSecond: stored.pixelsPerSecond,
  };
}

export function restoreTimelineToStorage(
  roomId: string,
  timeline: RoomConfigTimeline,
  indexToInputId: Map<number, string>,
): void {
  if (typeof window === 'undefined') return;

  const tracks = timeline.tracks.map((track) => ({
    id: crypto.randomUUID(),
    label: track.label,
    clips: track.clips
      .map((clip) => {
        const inputId = indexToInputId.get(clip.inputIndex);
        if (!inputId) return null;
        return {
          id: crypto.randomUUID(),
          inputId,
          startMs: clip.startMs,
          endMs: clip.endMs,
          blockSettings: clip.blockSettings,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null),
  }));

  const state = {
    tracks,
    totalDurationMs: timeline.totalDurationMs,
    playheadMs: 0,
    pixelsPerSecond: timeline.pixelsPerSecond,
  };

  try {
    saveTimeline(roomId, state);
  } catch {
    console.warn('Failed to save imported timeline to localStorage');
  }
}

export function updateTimelineInputId(
  roomId: string,
  oldInputId: string,
  newInputId: string,
): boolean {
  if (typeof window === 'undefined') return false;
  const stored = loadTimeline(roomId);
  if (!stored) return false;

  let changed = false;
  const tracks = stored.tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) => {
      if (clip.inputId === oldInputId) {
        changed = true;
        return { ...clip, inputId: newInputId };
      }
      return clip;
    }),
  }));

  if (changed) {
    saveTimeline(roomId, { ...stored, tracks });
  }
  return changed;
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
