import type {
  Input,
  Layout,
  ShaderConfig,
  UpdateInputOptions,
} from '@/lib/types';
import type { Layer, LayerBehaviorConfig } from '@/lib/types';
import type { ViewportProperties } from '@smelter-editor/types';
import {
  OUTPUT_TRACK_INPUT_ID,
  OUTPUT_TRACK_ID,
  OUTPUT_CLIP_ID,
} from '@smelter-editor/types';
import { v4 as uuidv4 } from 'uuid';
import { parseTransitionConfig } from '@/lib/types';
import type { SnakeEventShaderConfig } from '@/lib/snake-game-types';
import type {
  BlockSettings,
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
  url?: string;
  imageId?: string;
  imageFileName?: string;
  mp4FileName?: string;
  audioFileName?: string;
  text?: string;
  textAlign?: 'left' | 'center' | 'right';
  textColor?: string;
  needsConnection?: boolean;
  textMaxLines?: number;
  textScrollEnabled?: boolean;
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
  snakeEventShaders?: SnakeEventShaderConfig;
  snake1Shaders?: ShaderConfig[];
  snake2Shaders?: ShaderConfig[];
  attachedInputIndices?: number[];
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
};

export type RoomConfigTransitionSettings = {
  swapDurationMs?: number;
  swapOutgoingEnabled?: boolean;
  swapFadeInDurationMs?: number;
  swapFadeOutDurationMs?: number;
};

export type RoomConfigClip = {
  inputIndex: number;
  startMs: number;
  endMs: number;
  blockSettings?: Clip['blockSettings'];
  keyframes?: Clip['keyframes'];
};

export type RoomConfigTrack = {
  label: string;
  clips: RoomConfigClip[];
};

export type RoomConfigTimeline = {
  totalDurationMs: number;
  pixelsPerSecond: number;
  keyframeInterpolationMode?: 'step' | 'smooth';
  tracks: RoomConfigTrack[];
};

export type RoomConfigOutputPlayer = {
  muted: boolean;
  volume: number;
};

export type RoomConfigLayerInput = {
  inputIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  transitionDurationMs?: number;
  transitionEasing?: string;
  cropTop?: number;
  cropLeft?: number;
  cropRight?: number;
  cropBottom?: number;
};

export type RoomConfigLayer = {
  id: string;
  inputs: RoomConfigLayerInput[];
  behavior?: LayerBehaviorConfig;
};

export type RoomConfig = {
  version: 1;
  layout: Layout;
  inputs: RoomConfigInput[];
  layers?: RoomConfigLayer[];
  resolution?: { width: number; height: number };
  transitionSettings?: RoomConfigTransitionSettings;
  viewport?: Partial<ViewportProperties>;
  timeline?: RoomConfigTimeline;
  outputPlayer?: RoomConfigOutputPlayer;
  outputShaders?: ShaderConfig[];
  exportedAt: string;
};

export type PresentationConfig = {
  roomConfig: RoomConfig;
  welcomeTextBefore: string;
  welcomeTextAfter: string;
};

export type RoomConfigTimelineState = {
  tracks: Track[];
  totalDurationMs: number;
  keyframeInterpolationMode: 'step' | 'smooth';
  pixelsPerSecond: number;
};

function toNameKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function claimUniqueName(baseName: string, usedKeys: Set<string>): string {
  let candidate = baseName;
  let index = 2;
  while (usedKeys.has(toNameKey(candidate))) {
    candidate = `${baseName} (${index})`;
    index += 1;
  }
  usedKeys.add(toNameKey(candidate));
  return candidate;
}

function sanitizeImportedConfigNames(config: RoomConfig): RoomConfig {
  const usedInputNames = new Set<string>();
  const inputs = config.inputs.map((input, index) => {
    const preferred = input.title.trim() || `Input ${index + 1}`;
    return {
      ...input,
      title: claimUniqueName(preferred, usedInputNames),
    };
  });

  const usedTrackNames = new Set<string>();
  const timeline = config.timeline
    ? {
        ...config.timeline,
        tracks: config.timeline.tracks.map((track, index) => {
          const preferred = track.label.trim() || `Track ${index + 1}`;
          return {
            ...track,
            label: claimUniqueName(preferred, usedTrackNames),
          };
        }),
      }
    : undefined;

  return {
    ...config,
    inputs,
    timeline,
  };
}

export function resolveRoomConfigTimelineState(
  roomId: string,
  liveTimelineState?: RoomConfigTimelineState | null,
): RoomConfigTimelineState | null {
  if (liveTimelineState) {
    return liveTimelineState;
  }
  return loadTimelineFromStorage(roomId);
}

export function exportRoomConfig(
  inputs: Input[],
  layout: Layout = 'grid',
  resolution?: { width: number; height: number },
  transitionSettings?: RoomConfigTransitionSettings,
  timelineState?: RoomConfigTimelineState,
  outputPlayer?: RoomConfigOutputPlayer,
  viewport?: Partial<ViewportProperties>,
  outputShaders?: ShaderConfig[],
  layers?: Layer[],
): RoomConfig {
  const inputIdToIndex = new Map<string, number>();
  inputs.forEach((input, idx) => inputIdToIndex.set(input.inputId, idx));

  let timeline: RoomConfigTimeline | undefined;
  if (timelineState) {
    const tracks: RoomConfigTrack[] = timelineState.tracks.map((track) => ({
      label: track.label,
      clips: track.clips
        .map((clip) => {
          const isOutput = clip.inputId === OUTPUT_TRACK_INPUT_ID;
          const idx = isOutput ? -1 : inputIdToIndex.get(clip.inputId);
          if (idx === undefined) return null;
          return {
            inputIndex: idx,
            startMs: clip.startMs,
            endMs: clip.endMs,
            blockSettings: clip.blockSettings,
            keyframes: clip.keyframes,
          } as RoomConfigClip;
        })
        .filter((c): c is RoomConfigClip => c !== null),
    }));
    timeline = {
      totalDurationMs: timelineState.totalDurationMs,
      keyframeInterpolationMode: timelineState.keyframeInterpolationMode,
      pixelsPerSecond: timelineState.pixelsPerSecond,
      tracks,
    };
  }

  const serializedLayers: RoomConfigLayer[] | undefined = layers?.map(
    (layer) => ({
      id: layer.id,
      behavior: layer.behavior,
      inputs: layer.inputs.reduce<RoomConfigLayerInput[]>((acc, li) => {
        const idx = inputIdToIndex.get(li.inputId);
        if (idx === undefined) return acc;
        const entry: RoomConfigLayerInput = {
          inputIndex: idx,
          x: li.x,
          y: li.y,
          width: li.width,
          height: li.height,
        };
        if (li.transitionDurationMs !== undefined)
          entry.transitionDurationMs = li.transitionDurationMs;
        if (li.transitionEasing !== undefined)
          entry.transitionEasing = li.transitionEasing;
        if (li.cropTop !== undefined) entry.cropTop = li.cropTop;
        if (li.cropLeft !== undefined) entry.cropLeft = li.cropLeft;
        if (li.cropRight !== undefined) entry.cropRight = li.cropRight;
        if (li.cropBottom !== undefined) entry.cropBottom = li.cropBottom;
        acc.push(entry);
        return acc;
      }, []),
    }),
  );

  return {
    version: 1,
    layout,
    layers:
      serializedLayers && serializedLayers.length > 0
        ? serializedLayers
        : undefined,
    resolution,
    transitionSettings,
    viewport,
    timeline,
    outputPlayer,
    outputShaders:
      outputShaders && outputShaders.length > 0 ? outputShaders : undefined,
    inputs: inputs.map((input) => ({
      type: input.type,
      title: input.title,
      description: input.description,
      volume: input.volume,
      showTitle: input.showTitle,
      shaders: input.shaders,
      channelId: input.channelId,
      url: input.url,
      imageId: input.imageId,
      imageFileName: input.imageFileName,
      mp4FileName: input.mp4FileName,
      audioFileName: input.audioFileName,
      text: input.text,
      textAlign: input.textAlign,
      textColor: input.textColor,
      needsConnection: input.type === 'whip',
      textMaxLines: input.textMaxLines,
      textScrollEnabled: input.textScrollEnabled,
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
      snakeEventShaders: input.snakeEventShaders,
      snake1Shaders: input.snake1Shaders,
      snake2Shaders: input.snake2Shaders,
      absolutePosition: input.absolutePosition,
      absoluteTop: input.absoluteTop,
      absoluteLeft: input.absoluteLeft,
      absoluteWidth: input.absoluteWidth,
      absoluteHeight: input.absoluteHeight,
      absoluteTransitionDurationMs: input.absoluteTransitionDurationMs,
      absoluteTransitionEasing: input.absoluteTransitionEasing,
      cropTop: input.cropTop,
      cropLeft: input.cropLeft,
      cropRight: input.cropRight,
      cropBottom: input.cropBottom,
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
  return sanitizeImportedConfigNames(config as RoomConfig);
}

export function loadTimelineFromStorage(roomId: string): {
  tracks: Track[];
  totalDurationMs: number;
  keyframeInterpolationMode: 'step' | 'smooth';
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
        blockSettings: c.blockSettings
          ? {
              ...c.blockSettings,
              introTransition: parseTransitionConfig(
                c.blockSettings.introTransition,
              ),
              outroTransition: parseTransitionConfig(
                c.blockSettings.outroTransition,
              ),
            }
          : createBlockSettingsFromInput(undefined),
        keyframes: (c.keyframes ?? []).map((keyframe) => ({
          id: keyframe.id,
          timeMs: keyframe.timeMs,
          blockSettings: {
            ...keyframe.blockSettings,
            introTransition: parseTransitionConfig(
              keyframe.blockSettings.introTransition,
            ),
            outroTransition: parseTransitionConfig(
              keyframe.blockSettings.outroTransition,
            ),
          },
        })),
      })),
    })),
    totalDurationMs: stored.totalDurationMs,
    keyframeInterpolationMode: stored.keyframeInterpolationMode,
    pixelsPerSecond: stored.pixelsPerSecond,
  };
}

export function buildTimelineStateFromConfigTimeline(
  timeline: RoomConfigTimeline,
  indexToInputId: Map<number, string>,
): RoomConfigTimelineState {
  return {
    tracks: timeline.tracks.map((track) => {
      const hasOutputClip = track.clips.some((c) => c.inputIndex === -1);
      return {
        id: hasOutputClip ? OUTPUT_TRACK_ID : uuidv4(),
        label: track.label,
        clips: track.clips
          .map((clip) => {
            const isOutput = clip.inputIndex === -1;
            const inputId = isOutput
              ? OUTPUT_TRACK_INPUT_ID
              : indexToInputId.get(clip.inputIndex);
            if (!inputId) return null;
            return {
              id: isOutput ? OUTPUT_CLIP_ID : uuidv4(),
              inputId,
              startMs: clip.startMs,
              endMs: clip.endMs,
              blockSettings:
                clip.blockSettings ?? createBlockSettingsFromInput(undefined),
              keyframes: clip.keyframes ?? [],
            };
          })
          .filter((c): c is NonNullable<typeof c> => c !== null),
      };
    }),
    totalDurationMs: timeline.totalDurationMs,
    keyframeInterpolationMode: timeline.keyframeInterpolationMode ?? 'step',
    pixelsPerSecond: timeline.pixelsPerSecond,
  };
}

export function restoreTimelineToStorage(
  roomId: string,
  timeline: RoomConfigTimeline,
  indexToInputId: Map<number, string>,
): void {
  if (typeof window === 'undefined') return;
  const state = buildTimelineStateFromConfigTimeline(timeline, indexToInputId);

  try {
    saveTimeline(roomId, {
      ...state,
      snapToBlocks: true,
      snapToKeyframes: true,
      playheadMs: 0,
    });
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

export function buildInputUpdateFromBlockSettings(
  blockSettings: BlockSettings,
): Partial<UpdateInputOptions> {
  return {
    volume: blockSettings.volume,
    shaders: blockSettings.shaders,
    showTitle: blockSettings.showTitle,
    text: blockSettings.text,
    textAlign: blockSettings.textAlign,
    textColor: blockSettings.textColor,
    textMaxLines: blockSettings.textMaxLines,
    textScrollEnabled: blockSettings.textScrollEnabled,
    textScrollSpeed: blockSettings.textScrollSpeed,
    textScrollLoop: blockSettings.textScrollLoop,
    textFontSize: blockSettings.textFontSize,
    borderColor: blockSettings.borderColor,
    borderWidth: blockSettings.borderWidth,
    attachedInputIds: blockSettings.attachedInputIds,
    snake1Shaders: blockSettings.snake1Shaders,
    snake2Shaders: blockSettings.snake2Shaders,
    absolutePosition: blockSettings.absolutePosition,
    absoluteTop: blockSettings.absoluteTop,
    absoluteLeft: blockSettings.absoluteLeft,
    absoluteWidth: blockSettings.absoluteWidth,
    absoluteHeight: blockSettings.absoluteHeight,
    absoluteTransitionDurationMs: blockSettings.absoluteTransitionDurationMs,
    absoluteTransitionEasing: blockSettings.absoluteTransitionEasing,
    cropTop: blockSettings.cropTop,
    cropLeft: blockSettings.cropLeft,
    cropRight: blockSettings.cropRight,
    cropBottom: blockSettings.cropBottom,
    gameBackgroundColor: blockSettings.gameBackgroundColor,
    gameCellGap: blockSettings.gameCellGap,
    gameBoardBorderColor: blockSettings.gameBoardBorderColor,
    gameBoardBorderWidth: blockSettings.gameBoardBorderWidth,
    gameGridLineColor: blockSettings.gameGridLineColor,
    gameGridLineAlpha: blockSettings.gameGridLineAlpha,
    snakeEventShaders: blockSettings.snakeEventShaders,
  };
}

/**
 * Compute the desired room state at timeline position 0.
 * Returns which inputs should be hidden, the block settings for active clips,
 * and the input order derived from track ordering.
 */
export function computeTimelineStateAtZero(
  timeline: RoomConfigTimeline,
  indexToInputId: Map<number, string>,
): {
  hiddenInputIds: string[];
  activeBlockSettings: Map<string, BlockSettings>;
  inputOrder: string[];
} {
  const allTimelineInputIds = new Set<string>();
  const activeInputIds = new Set<string>();
  const activeBlockSettings = new Map<string, BlockSettings>();
  const inputOrder: string[] = [];

  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      const isOutput = clip.inputIndex === -1;
      const inputId = isOutput
        ? OUTPUT_TRACK_INPUT_ID
        : indexToInputId.get(clip.inputIndex);
      if (!inputId) continue;

      allTimelineInputIds.add(inputId);

      if (0 >= clip.startMs && 0 < clip.endMs) {
        if (!activeInputIds.has(inputId)) {
          activeInputIds.add(inputId);
          inputOrder.push(inputId);
          const activeSettings = clip.keyframes?.find(
            (keyframe) => keyframe.timeMs === 0,
          )?.blockSettings;
          if (activeSettings ?? clip.blockSettings) {
            activeBlockSettings.set(
              inputId,
              (activeSettings ?? clip.blockSettings) as BlockSettings,
            );
          }
        }
      }
    }
  }

  const hiddenInputIds = [...allTimelineInputIds].filter(
    (id) => !activeInputIds.has(id),
  );

  return { hiddenInputIds, activeBlockSettings, inputOrder };
}

const OUTPUT_PLAYER_STORAGE_KEY = 'smelter-output-player';

export function saveOutputPlayerSettings(
  roomId: string,
  settings: RoomConfigOutputPlayer,
) {
  if (typeof window === 'undefined') return;
  const key = `${OUTPUT_PLAYER_STORAGE_KEY}-${roomId}`;
  try {
    localStorage.setItem(key, JSON.stringify(settings));
  } catch (e) {
    console.warn('Failed to save output player settings:', e);
  }
}

export function loadOutputPlayerSettings(
  roomId: string,
): RoomConfigOutputPlayer | null {
  if (typeof window === 'undefined') return null;
  const key = `${OUTPUT_PLAYER_STORAGE_KEY}-${roomId}`;
  try {
    const data = localStorage.getItem(key);
    if (data) {
      return JSON.parse(data);
    }
  } catch (e) {
    console.warn('Failed to load output player settings:', e);
  }
  return null;
}

const PENDING_WHIP_STORAGE_KEY = 'smelter-pending-whip-inputs';

type StoredPendingWhipInput = {
  id: string;
  title: string;
  config: RoomConfigInput;
  position: number;
};

function savePendingWhipInputs(
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

function loadPendingWhipInputs(roomId: string): StoredPendingWhipInput[] {
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
