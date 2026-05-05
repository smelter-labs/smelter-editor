'use client';

import {
  useReducer,
  useEffect,
  useCallback,
  useRef,
  useState,
  useMemo,
} from 'react';
import type { Input } from '@/lib/types';
import { parseTransitionConfig } from '@/lib/types';
import type {
  TimelineBlockSettings,
  TimelineKeyframe as SharedTimelineKeyframe,
  TimelineKeyframeInterpolationMode,
} from '@smelter-editor/types';
import {
  OUTPUT_TRACK_INPUT_ID,
  OUTPUT_TRACK_ID,
  OUTPUT_CLIP_ID,
} from '@smelter-editor/types';
import {
  loadTimeline,
  saveTimeline,
  type StoredTrack,
} from '@/lib/timeline-storage';
import { v4 as uuidv4 } from 'uuid';

// ── Types ────────────────────────────────────────────────

export type Clip = {
  id: string;
  inputId: string;
  startMs: number;
  endMs: number;
  blockSettings: BlockSettings;
  keyframes: Keyframe[];
};

export type Track = {
  id: string;
  label: string;
  clips: Clip[];
  icon?: string;
};

export type TrackGroup = {
  id: string;
  label: string;
  icon?: string;
  collapsed: boolean;
  trackIds: string[];
};

export type TimelineRowRef =
  | { kind: 'track'; id: string }
  | { kind: 'group'; id: string };

export type BlockSettings = TimelineBlockSettings & {
  mp4DurationMs?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  swapLabelSuffix?: string;
};

export type Keyframe = SharedTimelineKeyframe & {
  blockSettings: BlockSettings;
};

/** @deprecated Use `Clip` instead. Kept for backwards compat with room-config. */
type Segment = Clip;

/** @deprecated Kept for backwards compat with room-config imports. Will be removed. */
type OrderKeyframe = {
  id: string;
  timeMs: number;
  inputOrder: string[];
};

/** @deprecated Use `Track` instead. */
type TrackTimeline = {
  inputId: string;
  segments: Segment[];
};

export type TimelineState = {
  tracks: Track[];
  groups: TrackGroup[];
  rootOrder: TimelineRowRef[];
  totalDurationMs: number;
  keyframeInterpolationMode: TimelineKeyframeInterpolationMode;
  snapToBlocks: boolean;
  snapToKeyframes: boolean;
  playheadMs: number;
  isPlaying: boolean;
  pixelsPerSecond: number;
  /** Runtime-only: inputIds that have appeared on clips. Prevents SYNC_TRACKS
   *  from auto-creating tracks for inputs that were deliberately swapped out. */
  knownInputIds: Set<string>;
};

// ── Actions ──────────────────────────────────────────────

type TimelineAction =
  | { type: 'SYNC_TRACKS'; inputs: Input[] }
  | { type: 'SET_PLAYHEAD'; ms: number }
  | { type: 'SET_PLAYING'; playing: boolean }
  | { type: 'SET_ZOOM'; pixelsPerSecond: number }
  | { type: 'SET_TOTAL_DURATION'; durationMs: number }
  | {
      type: 'SET_KEYFRAME_INTERPOLATION_MODE';
      mode: TimelineKeyframeInterpolationMode;
    }
  | { type: 'SET_SNAP_TO_BLOCKS'; enabled: boolean }
  | { type: 'SET_SNAP_TO_KEYFRAMES'; enabled: boolean }
  | { type: 'RESET'; inputs: Input[] }
  | { type: 'LOAD'; state: TimelineState }
  | {
      type: 'MOVE_CLIP';
      trackId: string;
      clipId: string;
      newStartMs: number;
    }
  | {
      type: 'RESIZE_CLIP';
      trackId: string;
      clipId: string;
      edge: 'left' | 'right';
      newMs: number;
    }
  | { type: 'SPLIT_CLIP'; trackId: string; clipId: string; atMs: number }
  | { type: 'DELETE_CLIP'; trackId: string; clipId: string }
  | { type: 'DUPLICATE_CLIP'; trackId: string; clipId: string }
  | {
      type: 'MOVE_CLIP_TO_TRACK';
      sourceTrackId: string;
      clipId: string;
      targetTrackId: string;
      newStartMs: number;
    }
  | { type: 'RENAME_TRACK'; trackId: string; newLabel: string }
  | { type: 'ADD_TRACK'; label: string }
  | { type: 'DELETE_TRACK'; trackId: string }
  | { type: 'REPLACE_INPUT_ID'; oldInputId: string; newInputId: string }
  | {
      type: 'UPDATE_CLIP_SETTINGS';
      trackId: string;
      clipId: string;
      patch: Partial<BlockSettings>;
    }
  | {
      type: 'ADD_KEYFRAME';
      trackId: string;
      clipId: string;
      timeMs: number;
      blockSettings?: BlockSettings;
    }
  | {
      type: 'UPDATE_KEYFRAME';
      trackId: string;
      clipId: string;
      keyframeId: string;
      patch: Partial<BlockSettings>;
    }
  | {
      type: 'DELETE_KEYFRAME';
      trackId: string;
      clipId: string;
      keyframeId: string;
    }
  | {
      type: 'MOVE_KEYFRAME';
      trackId: string;
      clipId: string;
      keyframeId: string;
      timeMs: number;
    }
  | { type: 'PURGE_INPUT_ID'; inputId: string }
  | { type: 'REORDER_TRACK'; trackId: string; newIndex: number }
  | {
      type: 'SWAP_CLIP_INPUT';
      trackId: string;
      clipId: string;
      newInputId: string;
      sourceUpdates?: Partial<BlockSettings>;
    }
  | {
      type: 'MOVE_CLIPS';
      moves: { trackId: string; clipId: string; newStartMs: number }[];
    }
  | {
      type: 'DELETE_CLIPS';
      clips: { trackId: string; clipId: string }[];
    }
  | { type: 'CLEANUP_SPURIOUS_WHIP_TRACK'; inputId: string }
  | { type: 'SET_TRACK_ICON'; trackId: string; icon: string | undefined }
  | { type: 'ADD_GROUP'; label?: string; insertAtIndex?: number }
  | { type: 'DELETE_GROUP'; groupId: string }
  | { type: 'RENAME_GROUP'; groupId: string; newLabel: string }
  | { type: 'SET_GROUP_COLLAPSED'; groupId: string; collapsed: boolean }
  | { type: 'SET_GROUP_ICON'; groupId: string; icon: string | undefined }
  | { type: 'MOVE_GROUP'; groupId: string; newIndex: number }
  | {
      type: 'MOVE_TRACK_TO';
      trackId: string;
      target:
        | { kind: 'root'; index: number }
        | { kind: 'group'; groupId: string; index: number };
    };

// ── Constants ────────────────────────────────────────────

const DEFAULT_DURATION_MS = 60_000; // 1 minute
const DEFAULT_PPS = 15; // pixels per second (60s × 15 = 900px at default)
const MIN_PPS = 2;
const MAX_PPS = 100;
const MIN_CLIP_MS = 1000;
/** @deprecated Use MIN_CLIP_MS instead */
const MIN_SEGMENT_MS = MIN_CLIP_MS;

export { DEFAULT_PPS };
export { OUTPUT_TRACK_INPUT_ID, OUTPUT_TRACK_ID, OUTPUT_CLIP_ID };

// ── Helpers ──────────────────────────────────────────────

function genId(): string {
  return uuidv4();
}

function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneBlockSettings(settings: BlockSettings): BlockSettings {
  return deepClone(settings);
}

function cloneKeyframe(keyframe: Keyframe): Keyframe {
  return {
    ...keyframe,
    blockSettings: cloneBlockSettings(keyframe.blockSettings),
  };
}

function createInitialKeyframes(blockSettings: BlockSettings): Keyframe[] {
  return [
    {
      id: genId(),
      timeMs: 0,
      blockSettings: cloneBlockSettings(blockSettings),
    },
  ];
}

function getClipDuration(clip: Pick<Clip, 'startMs' | 'endMs'>): number {
  return Math.max(MIN_CLIP_MS, clip.endMs - clip.startMs);
}

function normalizeKeyframesForClip(
  clip: Pick<Clip, 'startMs' | 'endMs' | 'blockSettings' | 'keyframes'>,
): Keyframe[] {
  const durationMs = getClipDuration(clip);
  const rawKeyframes =
    clip.keyframes.length > 0
      ? clip.keyframes
      : createInitialKeyframes(clip.blockSettings);

  const normalized = rawKeyframes
    .map((keyframe) => ({
      id: keyframe.id || genId(),
      timeMs: Math.max(0, Math.min(Math.round(keyframe.timeMs), durationMs)),
      blockSettings: cloneBlockSettings(keyframe.blockSettings),
    }))
    .sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id));

  const deduped: Keyframe[] = [];
  for (const keyframe of normalized) {
    const previous = deduped[deduped.length - 1];
    if (previous && previous.timeMs === keyframe.timeMs) {
      deduped[deduped.length - 1] = keyframe;
      continue;
    }
    deduped.push(keyframe);
  }

  if (deduped.length === 0 || deduped[0].timeMs !== 0) {
    deduped.unshift({
      id: genId(),
      timeMs: 0,
      blockSettings: cloneBlockSettings(clip.blockSettings),
    });
  }

  return deduped.map(cloneKeyframe);
}

function syncClipKeyframes(clip: Clip): Clip {
  const keyframes = normalizeKeyframesForClip(clip);
  return {
    ...clip,
    blockSettings: cloneBlockSettings(keyframes[0].blockSettings),
    keyframes,
  };
}

export function resolveClipBlockSettingsAtOffset(
  clip: Pick<Clip, 'blockSettings' | 'keyframes'>,
  offsetMs: number,
): BlockSettings {
  const keyframes = normalizeKeyframesForClip({
    startMs: 0,
    endMs: Math.max(MIN_CLIP_MS, offsetMs + MIN_CLIP_MS),
    blockSettings: clip.blockSettings,
    keyframes: clip.keyframes,
  });
  let resolved = keyframes[0];
  for (const keyframe of keyframes) {
    if (keyframe.timeMs > offsetMs) {
      break;
    }
    resolved = keyframe;
  }
  return cloneBlockSettings(resolved.blockSettings);
}

export function createBlockSettingsFromInput(input?: Input): BlockSettings {
  return {
    volume: input?.volume ?? 1,
    showTitle: input?.showTitle !== false,
    shaders: (input?.shaders || []).map((shader) => ({
      ...shader,
      params: (shader.params || []).map((param) => ({ ...param })),
    })),
    text: input?.text,
    textAlign: input?.textAlign,
    textColor: input?.textColor,
    textMaxLines: input?.textMaxLines,
    textScrollEnabled: input?.textScrollEnabled,
    textScrollSpeed: input?.textScrollSpeed,
    textScrollLoop: input?.textScrollLoop,
    textFontSize: input?.textFontSize,
    borderColor: input?.borderColor,
    borderWidth: input?.borderWidth,
    attachedInputIds: input?.attachedInputIds
      ? [...input.attachedInputIds]
      : undefined,
    gameBackgroundColor: input?.gameBackgroundColor,
    gameCellGap: input?.gameCellGap,
    gameBoardBorderColor: input?.gameBoardBorderColor,
    gameBoardBorderWidth: input?.gameBoardBorderWidth,
    gameGridLineColor: input?.gameGridLineColor,
    gameGridLineAlpha: input?.gameGridLineAlpha,
    snakeEventShaders: input?.snakeEventShaders,
    snake1Shaders: input?.snake1Shaders
      ? input.snake1Shaders.map((s) => ({
          ...s,
          params: (s.params || []).map((p) => ({ ...p })),
        }))
      : undefined,
    snake2Shaders: input?.snake2Shaders
      ? input.snake2Shaders.map((s) => ({
          ...s,
          params: (s.params || []).map((p) => ({ ...p })),
        }))
      : undefined,
    absolutePosition: input?.absolutePosition ?? true,
    absoluteTop: input?.absoluteTop,
    absoluteLeft: input?.absoluteLeft,
    absoluteWidth: input?.absoluteWidth,
    absoluteHeight: input?.absoluteHeight,
    absoluteTransitionDurationMs: input?.absoluteTransitionDurationMs,
    absoluteTransitionEasing: input?.absoluteTransitionEasing,
    cropTop: input?.cropTop,
    cropLeft: input?.cropLeft,
    cropRight: input?.cropRight,
    cropBottom: input?.cropBottom,
    sourceWidth: input?.sourceWidth,
    sourceHeight: input?.sourceHeight,
  };
}

function ensureClipBlockSettings(
  clip: Omit<Clip, 'blockSettings'> & Partial<Pick<Clip, 'blockSettings'>>,
  input?: Input,
): Clip {
  const cloned = clip.blockSettings
    ? cloneBlockSettings(clip.blockSettings)
    : createBlockSettingsFromInput(input);

  // When an existing clip already has local blockSettings, merge in the
  // server-authoritative absolute position coordinates so remote changes
  // (e.g. from mobile) are reflected in the editor position controller.
  const blockSettings =
    clip.blockSettings && input
      ? {
          ...cloned,
          absoluteLeft: input.absoluteLeft ?? cloned.absoluteLeft,
          absoluteTop: input.absoluteTop ?? cloned.absoluteTop,
          absoluteWidth: input.absoluteWidth ?? cloned.absoluteWidth,
          absoluteHeight: input.absoluteHeight ?? cloned.absoluteHeight,
        }
      : cloned;

  const keyframes = clip.keyframes ? clip.keyframes.map(cloneKeyframe) : [];

  if (clip.blockSettings) {
    return syncClipKeyframes({ ...clip, blockSettings, keyframes });
  }
  return syncClipKeyframes({ ...clip, blockSettings, keyframes });
}

function storedTracksToTracks(storedTracks: StoredTrack[]): Track[] {
  return storedTracks.map((t) => ({
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
  }));
}

function inferTypeFromInputId(inputId: string): string | null {
  if (inputId.includes('::twitch::')) return 'twitch-channel';
  if (inputId.includes('::kick::')) return 'kick-channel';
  if (inputId.includes('::hls::')) return 'hls';
  if (inputId.includes('::whip::')) return 'whip';
  if (inputId.includes('::local::')) return 'local-mp4';
  if (inputId.includes('::image::')) return 'image';
  if (inputId.includes('::text::')) return 'text-input';
  return null;
}

function claimUniqueId(id: string | undefined, usedIds: Set<string>): string {
  let nextId = id || genId();
  while (usedIds.has(nextId)) {
    nextId = genId();
  }
  usedIds.add(nextId);
  return nextId;
}

function normalizeTrackLabel(label: string): string {
  return label.trim().toLocaleLowerCase();
}

function buildSwapLabelSuffix(
  state: TimelineState,
  targetClipId: string,
  newInputId: string,
): string {
  const sameInputClipCount = state.tracks.reduce((count, track) => {
    const matches = track.clips.filter(
      (clip) => clip.id !== targetClipId && clip.inputId === newInputId,
    ).length;
    return count + matches;
  }, 0);

  return sameInputClipCount > 0
    ? ` (switched ${sameInputClipCount + 1})`
    : ' (switched)';
}

function claimUniqueTrackLabel(
  preferredLabel: string,
  usedLabels: Set<string>,
): string {
  const baseLabel = preferredLabel.trim() || 'Track';
  let candidate = baseLabel;
  let index = 2;
  while (usedLabels.has(normalizeTrackLabel(candidate))) {
    candidate = `${baseLabel} (${index})`;
    index += 1;
  }
  usedLabels.add(normalizeTrackLabel(candidate));
  return candidate;
}

function ensureUniqueTrackStructureIds(tracks: Track[]): Track[] {
  const usedTrackIds = new Set<string>();
  return tracks.map((track) => {
    const usedClipIds = new Set<string>();
    return {
      ...track,
      id: claimUniqueId(track.id, usedTrackIds),
      clips: track.clips.map((clip) => {
        const usedKeyframeIds = new Set<string>();
        return {
          ...clip,
          id: claimUniqueId(clip.id, usedClipIds),
          keyframes: (clip.keyframes ?? []).map((keyframe) => ({
            ...keyframe,
            id: claimUniqueId(keyframe.id, usedKeyframeIds),
          })),
        };
      }),
    };
  });
}

function normalizeTracks(
  tracks: Track[],
  inputs: Input[],
  totalDurationMs: number,
): Track[] {
  const tracksWithUniqueIds = ensureUniqueTrackStructureIds(tracks);
  const inputById = new Map(inputs.map((input) => [input.inputId, input]));
  return tracksWithUniqueIds.map((track) => ({
    ...track,
    clips: clampClips(
      track.clips.map((clip) =>
        ensureClipBlockSettings(clip, inputById.get(clip.inputId)),
      ),
      totalDurationMs,
    ),
  }));
}

function makeFullClip(
  inputId: string,
  totalDurationMs: number,
  input?: Input,
): Clip {
  const blockSettings = createBlockSettingsFromInput(input);
  return {
    id: genId(),
    inputId,
    startMs: 0,
    endMs: totalDurationMs,
    blockSettings,
    keyframes: createInitialKeyframes(blockSettings),
  };
}

function makeOutputTrack(totalDurationMs: number): Track {
  const blockSettings: BlockSettings = {
    volume: 1,
    showTitle: false,
    shaders: [],
  };
  return {
    id: OUTPUT_TRACK_ID,
    label: 'Main Video',
    clips: [
      {
        id: OUTPUT_CLIP_ID,
        inputId: OUTPUT_TRACK_INPUT_ID,
        startMs: 0,
        endMs: totalDurationMs,
        blockSettings,
        keyframes: createInitialKeyframes(blockSettings),
      },
    ],
  };
}

function ensureOutputTrack(tracks: Track[], totalDurationMs: number): Track[] {
  const existing = tracks.find((t) => t.id === OUTPUT_TRACK_ID);
  if (existing) {
    const clip = existing.clips.find((c) => c.id === OUTPUT_CLIP_ID);
    if (clip && clip.endMs !== totalDurationMs) {
      return tracks.map((t) =>
        t.id === OUTPUT_TRACK_ID
          ? {
              ...t,
              clips: t.clips.map((c) =>
                c.id === OUTPUT_CLIP_ID
                  ? syncClipKeyframes({
                      ...c,
                      startMs: 0,
                      endMs: totalDurationMs,
                    })
                  : c,
              ),
            }
          : t,
      );
    }
    return tracks;
  }
  return [...tracks, makeOutputTrack(totalDurationMs)];
}

function createInitialState(): TimelineState {
  return {
    tracks: [],
    groups: [],
    rootOrder: [],
    totalDurationMs: DEFAULT_DURATION_MS,
    keyframeInterpolationMode: 'step',
    snapToBlocks: true,
    snapToKeyframes: true,
    playheadMs: 0,
    isPlaying: false,
    pixelsPerSecond: DEFAULT_PPS,
    knownInputIds: new Set(),
  };
}

function clampZoom(pps: number): number {
  return Math.min(MAX_PPS, Math.max(MIN_PPS, pps));
}

/** Sort clips by startMs and clamp to [0, totalDurationMs]. Does NOT merge overlaps — clips should not overlap. */
function clampClips(clips: Clip[], totalDurationMs: number): Clip[] {
  return clips
    .map((c) => ({
      ...c,
      startMs: Math.max(0, Math.min(c.startMs, totalDurationMs - MIN_CLIP_MS)),
      endMs: Math.max(MIN_CLIP_MS, Math.min(c.endMs, totalDurationMs)),
    }))
    .filter((c) => c.endMs - c.startMs >= MIN_CLIP_MS)
    .map(syncClipKeyframes)
    .sort((a, b) => a.startMs - b.startMs);
}

/**
 * Migrate V1 stored format (tracks as Record<string, TrackTimeline>, orderKeyframes)
 * to V2 format (tracks as Track[]).
 */
function migrateV1ToV2(stored: Record<string, unknown>): TimelineState | null {
  const tracks = stored.tracks;
  if (!tracks || Array.isArray(tracks)) return null;

  // It's V1 format — tracks is a Record<string, TrackTimeline>
  const v1Tracks = tracks as Record<string, TrackTimeline>;
  const newTracks: Track[] = [];
  for (const [inputId, trackTimeline] of Object.entries(v1Tracks)) {
    newTracks.push({
      id: genId(),
      label: inputId,
      clips: (trackTimeline.segments || []).map((s) => ({
        ...s,
        inputId: trackTimeline.inputId || inputId,
        blockSettings: createBlockSettingsFromInput(undefined),
      })),
    });
  }

  return {
    tracks: newTracks,
    groups: [],
    rootOrder: newTracks.map((t) => ({ kind: 'track' as const, id: t.id })),
    totalDurationMs: (stored.totalDurationMs as number) || DEFAULT_DURATION_MS,
    keyframeInterpolationMode: 'step',
    snapToBlocks: true,
    snapToKeyframes: true,
    playheadMs: 0,
    isPlaying: false,
    pixelsPerSecond: (stored.pixelsPerSecond as number) || DEFAULT_PPS,
    knownInputIds: new Set<string>(),
  };
}

// ── Group / order helpers ────────────────────────────────

function buildDefaultRootOrder(tracks: Track[]): TimelineRowRef[] {
  return tracks.map((t) => ({ kind: 'track' as const, id: t.id }));
}

/**
 * Reconcile groups + rootOrder against the canonical `tracks` pool.
 * - Drops references to tracks that no longer exist.
 * - Drops references to groups that no longer exist.
 * - Ensures every track in the pool appears exactly once (in rootOrder
 *   or in some group.trackIds). Missing tracks are appended to rootOrder.
 * - Ensures OUTPUT_TRACK_ID is in rootOrder (never inside a group).
 */
function reconcileOrder(
  tracks: Track[],
  groups: TrackGroup[],
  rootOrder: TimelineRowRef[],
): { groups: TrackGroup[]; rootOrder: TimelineRowRef[] } {
  const trackIdSet = new Set(tracks.map((t) => t.id));
  const groupIdSet = new Set(groups.map((g) => g.id));
  const seenTrackIds = new Set<string>();

  const cleanedGroups: TrackGroup[] = groups.map((g) => {
    const ids: string[] = [];
    for (const tid of g.trackIds) {
      if (tid === OUTPUT_TRACK_ID) continue;
      if (!trackIdSet.has(tid)) continue;
      if (seenTrackIds.has(tid)) continue;
      seenTrackIds.add(tid);
      ids.push(tid);
    }
    return { ...g, trackIds: ids };
  });

  const cleanedRoot: TimelineRowRef[] = [];
  let outputSeen = false;
  for (const ref of rootOrder) {
    if (ref.kind === 'track') {
      if (!trackIdSet.has(ref.id)) continue;
      if (seenTrackIds.has(ref.id)) continue;
      seenTrackIds.add(ref.id);
      if (ref.id === OUTPUT_TRACK_ID) outputSeen = true;
      cleanedRoot.push(ref);
    } else {
      if (!groupIdSet.has(ref.id)) continue;
      cleanedRoot.push(ref);
    }
  }

  // Add any tracks missing from order at the front (matches ADD_TRACK semantics
  // of "new track appears on top"), with output track always last.
  const missing: Track[] = [];
  for (const t of tracks) {
    if (!seenTrackIds.has(t.id)) missing.push(t);
  }
  const missingRefs: TimelineRowRef[] = missing
    .filter((t) => t.id !== OUTPUT_TRACK_ID)
    .map((t) => ({ kind: 'track' as const, id: t.id }));

  // OUTPUT_TRACK_ID handling: ensure it exists in rootOrder, append at end.
  const hasOutputInTracks = trackIdSet.has(OUTPUT_TRACK_ID);
  const finalRoot: TimelineRowRef[] = [...missingRefs, ...cleanedRoot];
  if (hasOutputInTracks && !outputSeen) {
    finalRoot.push({ kind: 'track', id: OUTPUT_TRACK_ID });
  }

  return { groups: cleanedGroups, rootOrder: finalRoot };
}

function withReconciledOrder(state: TimelineState): TimelineState {
  const { groups, rootOrder } = reconcileOrder(
    state.tracks,
    state.groups,
    state.rootOrder,
  );
  if (groups === state.groups && rootOrder === state.rootOrder) return state;
  return { ...state, groups, rootOrder };
}

function findTrackLocation(
  state: TimelineState,
  trackId: string,
):
  | { kind: 'root'; index: number }
  | { kind: 'group'; groupId: string; index: number }
  | null {
  const rootIdx = state.rootOrder.findIndex(
    (r) => r.kind === 'track' && r.id === trackId,
  );
  if (rootIdx >= 0) return { kind: 'root', index: rootIdx };
  for (const g of state.groups) {
    const idx = g.trackIds.indexOf(trackId);
    if (idx >= 0) return { kind: 'group', groupId: g.id, index: idx };
  }
  return null;
}

function normalizeGroupLabel(label: string): string {
  return label.trim().toLocaleLowerCase();
}

function claimUniqueGroupLabel(
  preferredLabel: string,
  usedLabels: Set<string>,
): string {
  const baseLabel = preferredLabel.trim() || 'Group';
  let candidate = baseLabel;
  let index = 2;
  while (usedLabels.has(normalizeGroupLabel(candidate))) {
    candidate = `${baseLabel} (${index})`;
    index += 1;
  }
  usedLabels.add(normalizeGroupLabel(candidate));
  return candidate;
}

// ── Reducer ──────────────────────────────────────────────

export function timelineReducer(
  state: TimelineState,
  action: TimelineAction,
): TimelineState {
  switch (action.type) {
    case 'SYNC_TRACKS': {
      if (action.inputs.length === 0) {
        const hasUserContent =
          state.tracks.some((track) => track.id !== OUTPUT_TRACK_ID) ||
          state.groups.length > 0;
        // Room refreshes can momentarily report zero inputs while the server is
        // still reconnecting imported sources. Keep the current timeline
        // instead of wiping it and rebuilding every clip from 0:00. User-created
        // empty tracks/groups also count as content worth preserving.
        if (hasUserContent) {
          return state;
        }
        const wipedTracks = ensureOutputTrack([], state.totalDurationMs);
        return {
          ...state,
          tracks: wipedTracks,
          groups: [],
          rootOrder: buildDefaultRootOrder(wipedTracks),
          knownInputIds: new Set<string>(),
        };
      }

      const currentInputIds = new Set(action.inputs.map((i) => i.inputId));
      const inputById = new Map(action.inputs.map((i) => [i.inputId, i]));

      // Collect all inputIds that already have clips on some track
      const coveredInputIds = new Set<string>();
      for (const track of state.tracks) {
        for (const clip of track.clips) {
          coveredInputIds.add(clip.inputId);
        }
      }

      // Find disconnected inputIds (referenced in clips but missing from
      // the current inputs list, excluding pending-whip placeholders and the output track).
      const disconnectedInputIds = new Set<string>();
      for (const track of state.tracks) {
        for (const clip of track.clips) {
          if (
            !currentInputIds.has(clip.inputId) &&
            !clip.inputId.startsWith('__pending-whip-') &&
            clip.inputId !== OUTPUT_TRACK_INPUT_ID
          ) {
            disconnectedInputIds.add(clip.inputId);
          }
        }
      }

      // Inputs present on the server but not covered by any clip yet.
      const uncoveredInputs = action.inputs.filter(
        (input) => !coveredInputIds.has(input.inputId),
      );

      // Try to re-attach disconnected placeholder clips to new inputs of the
      // same type (e.g. a WHIP input that reconnected with a new ID).
      const replacementMap = new Map<string, string>();
      const usedDisconnected = new Set<string>();
      for (const input of uncoveredInputs) {
        for (const disconnectedId of disconnectedInputIds) {
          if (usedDisconnected.has(disconnectedId)) continue;
          if (inferTypeFromInputId(disconnectedId) === input.type) {
            replacementMap.set(disconnectedId, input.inputId);
            usedDisconnected.add(disconnectedId);
            break;
          }
        }
      }

      // Keep ALL clips on existing tracks. Disconnected clips that have a
      // replacement get their inputId swapped; the rest stay as placeholders.
      const newTracks: Track[] = state.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => {
          const replacement = replacementMap.get(clip.inputId);
          const resolvedId = replacement ?? clip.inputId;
          return ensureClipBlockSettings(
            replacement ? { ...clip, inputId: resolvedId } : clip,
            inputById.get(resolvedId),
          );
        }),
      }));

      // For each input that has no clips on any existing track, create a new track
      const nowCoveredInputIds = new Set<string>();
      for (const track of newTracks) {
        for (const clip of track.clips) {
          nowCoveredInputIds.add(clip.inputId);
        }
      }

      // Update knownInputIds: prune IDs no longer in the room, keep all covered IDs.
      const updatedKnownInputIds = new Set<string>();
      for (const id of state.knownInputIds) {
        if (currentInputIds.has(id)) {
          updatedKnownInputIds.add(id);
        }
      }
      for (const id of nowCoveredInputIds) {
        updatedKnownInputIds.add(id);
      }

      let nextTrackNumber = newTracks.length + 1;
      const brandNewTracks: Track[] = [];
      for (const input of action.inputs) {
        if (
          !nowCoveredInputIds.has(input.inputId) &&
          !updatedKnownInputIds.has(input.inputId)
        ) {
          brandNewTracks.push({
            id: genId(),
            label: `Track ${nextTrackNumber}`,
            clips: [makeFullClip(input.inputId, state.totalDurationMs, input)],
          });
          updatedKnownInputIds.add(input.inputId);
          nextTrackNumber++;
        }
      }

      const finalTracks = ensureOutputTrack(
        [...brandNewTracks, ...newTracks],
        state.totalDurationMs,
      );
      // Prepend brand-new tracks to rootOrder, then reconcile to drop any
      // refs to tracks that vanished and ensure output track stays present.
      const prependedRoot: TimelineRowRef[] = [
        ...brandNewTracks.map((t) => ({ kind: 'track' as const, id: t.id })),
        ...state.rootOrder,
      ];
      const reconciled = reconcileOrder(
        finalTracks,
        state.groups,
        prependedRoot,
      );
      return {
        ...state,
        tracks: finalTracks,
        groups: reconciled.groups,
        rootOrder: reconciled.rootOrder,
        knownInputIds: updatedKnownInputIds,
      };
    }

    case 'SET_PLAYHEAD':
      if (
        Math.max(0, Math.min(action.ms, state.totalDurationMs)) ===
        state.playheadMs
      ) {
        return state;
      }
      return {
        ...state,
        playheadMs: Math.max(0, Math.min(action.ms, state.totalDurationMs)),
      };

    case 'SET_PLAYING':
      if (state.isPlaying === action.playing) return state;
      return { ...state, isPlaying: action.playing };

    case 'SET_ZOOM':
      return { ...state, pixelsPerSecond: clampZoom(action.pixelsPerSecond) };

    case 'SET_TOTAL_DURATION': {
      const durationMs = Math.max(10_000, action.durationMs);
      return {
        ...state,
        tracks: ensureOutputTrack(
          normalizeTracks(state.tracks, [], durationMs),
          durationMs,
        ),
        totalDurationMs: durationMs,
        playheadMs: Math.min(state.playheadMs, durationMs),
      };
    }

    case 'SET_KEYFRAME_INTERPOLATION_MODE':
      return { ...state, keyframeInterpolationMode: action.mode };

    case 'SET_SNAP_TO_BLOCKS':
      if (state.snapToBlocks === action.enabled) return state;
      return { ...state, snapToBlocks: action.enabled };

    case 'SET_SNAP_TO_KEYFRAMES':
      if (state.snapToKeyframes === action.enabled) return state;
      return { ...state, snapToKeyframes: action.enabled };

    case 'RESET': {
      const tracks: Track[] = action.inputs.map((input, idx) => ({
        id: genId(),
        label: `Track ${idx + 1}`,
        clips: [makeFullClip(input.inputId, state.totalDurationMs, input)],
      }));
      const tracksWithOutput = ensureOutputTrack(tracks, state.totalDurationMs);
      return {
        ...state,
        tracks: tracksWithOutput,
        groups: [],
        rootOrder: buildDefaultRootOrder(tracksWithOutput),
        playheadMs: 0,
        isPlaying: false,
        knownInputIds: new Set(action.inputs.map((i) => i.inputId)),
      };
    }

    case 'MOVE_CLIP': {
      if (action.clipId === OUTPUT_CLIP_ID) return state;
      const track = state.tracks.find((t) => t.id === action.trackId);
      if (!track) return state;
      const clipIdx = track.clips.findIndex((c) => c.id === action.clipId);
      if (clipIdx < 0) return state;
      const clip = track.clips[clipIdx];
      const duration = clip.endMs - clip.startMs;
      let newStart = Math.max(0, action.newStartMs);

      // Prevent overlap with previous clip
      const prev = track.clips[clipIdx - 1];
      if (prev && newStart < prev.endMs) {
        newStart = prev.endMs;
      }
      // Prevent overlap with next clip
      const next = track.clips[clipIdx + 1];
      if (next && newStart + duration > next.startMs) {
        newStart = next.startMs - duration;
      }

      if (newStart < 0) newStart = 0;

      const newEnd = newStart + duration;

      // Auto-extend total duration if clip moves past current end
      let newTotalDuration = state.totalDurationMs;
      if (newEnd > newTotalDuration) {
        newTotalDuration = newEnd + 5000; // add 5s padding
      }

      const newClips = [...track.clips];
      newClips[clipIdx] = {
        ...clip,
        startMs: newStart,
        endMs: newEnd,
      };
      return {
        ...state,
        totalDurationMs: newTotalDuration,
        tracks: state.tracks.map((t) =>
          t.id === action.trackId
            ? { ...t, clips: clampClips(newClips, newTotalDuration) }
            : t,
        ),
      };
    }

    case 'RESIZE_CLIP': {
      if (action.clipId === OUTPUT_CLIP_ID) return state;
      const track = state.tracks.find((t) => t.id === action.trackId);
      if (!track) return state;
      const clipIdx = track.clips.findIndex((c) => c.id === action.clipId);
      if (clipIdx < 0) return state;
      const clip = track.clips[clipIdx];
      const newClips = [...track.clips];
      let newTotalDuration = state.totalDurationMs;

      if (action.edge === 'left') {
        let newStart = Math.max(0, action.newMs);
        // Don't overlap previous clip
        const prev = track.clips[clipIdx - 1];
        if (prev && newStart < prev.endMs) newStart = prev.endMs;
        // Enforce min duration
        if (clip.endMs - newStart < MIN_CLIP_MS)
          newStart = clip.endMs - MIN_CLIP_MS;
        newClips[clipIdx] = { ...clip, startMs: newStart };
      } else {
        let newEnd = Math.max(clip.startMs + MIN_CLIP_MS, action.newMs);
        // Don't overlap next clip
        const next = track.clips[clipIdx + 1];
        if (next && newEnd > next.startMs) newEnd = next.startMs;
        // Clamp non-looped MP4 blocks to remaining duration
        if (
          clip.blockSettings.mp4Loop === false &&
          clip.blockSettings.mp4DurationMs != null
        ) {
          const maxDuration =
            clip.blockSettings.mp4DurationMs -
            (clip.blockSettings.mp4PlayFromMs ?? 0);
          if (maxDuration > 0 && newEnd - clip.startMs > maxDuration) {
            newEnd = clip.startMs + maxDuration;
          }
        }
        // Auto-extend total duration if resizing past the end
        if (newEnd > newTotalDuration) {
          newTotalDuration = newEnd + 5000;
        }
        newClips[clipIdx] = { ...clip, endMs: newEnd };
      }

      return {
        ...state,
        totalDurationMs: newTotalDuration,
        tracks: state.tracks.map((t) =>
          t.id === action.trackId
            ? { ...t, clips: clampClips(newClips, newTotalDuration) }
            : t,
        ),
      };
    }

    case 'SPLIT_CLIP': {
      if (action.clipId === OUTPUT_CLIP_ID) return state;
      const track = state.tracks.find((t) => t.id === action.trackId);
      if (!track) return state;
      const clipIdx = track.clips.findIndex((c) => c.id === action.clipId);
      if (clipIdx < 0) return state;
      const clip = track.clips[clipIdx];

      // Must have enough room for two MIN_CLIP_MS clips
      if (action.atMs - clip.startMs < MIN_CLIP_MS) return state;
      if (clip.endMs - action.atMs < MIN_CLIP_MS) return state;

      const left: Clip = {
        id: clip.id,
        inputId: clip.inputId,
        startMs: clip.startMs,
        endMs: action.atMs,
        blockSettings: cloneBlockSettings(clip.blockSettings),
        keyframes: clip.keyframes
          .filter((keyframe) => keyframe.timeMs <= action.atMs - clip.startMs)
          .map(cloneKeyframe),
      };
      const rightStartOffsetMs = action.atMs - clip.startMs;
      const rightStartSnapshot = resolveClipBlockSettingsAtOffset(
        clip,
        rightStartOffsetMs,
      );
      const right: Clip = {
        id: genId(),
        inputId: clip.inputId,
        startMs: action.atMs,
        endMs: clip.endMs,
        blockSettings: cloneBlockSettings(rightStartSnapshot),
        keyframes: [
          {
            id: genId(),
            timeMs: 0,
            blockSettings: cloneBlockSettings(rightStartSnapshot),
          },
          ...clip.keyframes
            .filter((keyframe) => keyframe.timeMs > rightStartOffsetMs)
            .map((keyframe) => ({
              ...cloneKeyframe(keyframe),
              timeMs: keyframe.timeMs - rightStartOffsetMs,
            })),
        ],
      };

      const newClips = [...track.clips];
      newClips.splice(
        clipIdx,
        1,
        syncClipKeyframes(left),
        syncClipKeyframes(right),
      );

      return {
        ...state,
        tracks: state.tracks.map((t) =>
          t.id === action.trackId ? { ...t, clips: newClips } : t,
        ),
      };
    }

    case 'DELETE_CLIP': {
      if (action.clipId === OUTPUT_CLIP_ID) return state;
      const track = state.tracks.find((t) => t.id === action.trackId);
      if (!track) return state;
      const newClips = track.clips.filter((c) => c.id !== action.clipId);
      return {
        ...state,
        tracks: state.tracks.map((t) =>
          t.id === action.trackId ? { ...t, clips: newClips } : t,
        ),
      };
    }

    case 'DUPLICATE_CLIP': {
      if (action.clipId === OUTPUT_CLIP_ID) return state;
      const track = state.tracks.find((t) => t.id === action.trackId);
      if (!track) return state;
      const clip = track.clips.find((c) => c.id === action.clipId);
      if (!clip) return state;
      const duration = clip.endMs - clip.startMs;
      const newStart = clip.endMs;
      const newEnd = newStart + duration;
      if (newEnd > state.totalDurationMs) return state;
      // Check for overlap with next clip
      const clipIdx = track.clips.indexOf(clip);
      const next = track.clips[clipIdx + 1];
      if (next && newEnd > next.startMs) return state;
      const duplicate: Clip = {
        id: genId(),
        inputId: clip.inputId,
        startMs: newStart,
        endMs: newEnd,
        blockSettings: cloneBlockSettings(clip.blockSettings),
        keyframes: clip.keyframes.map(cloneKeyframe),
      };
      const newClips = [...track.clips];
      newClips.splice(clipIdx + 1, 0, duplicate);
      return {
        ...state,
        tracks: state.tracks.map((t) =>
          t.id === action.trackId ? { ...t, clips: newClips } : t,
        ),
      };
    }

    case 'MOVE_CLIP_TO_TRACK': {
      if (
        action.clipId === OUTPUT_CLIP_ID ||
        action.sourceTrackId === OUTPUT_TRACK_ID ||
        action.targetTrackId === OUTPUT_TRACK_ID
      )
        return state;
      const sourceTrack = state.tracks.find(
        (t) => t.id === action.sourceTrackId,
      );
      const targetTrack = state.tracks.find(
        (t) => t.id === action.targetTrackId,
      );
      if (!sourceTrack || !targetTrack) return state;
      const clip = sourceTrack.clips.find((c) => c.id === action.clipId);
      if (!clip) return state;

      const duration = clip.endMs - clip.startMs;
      let newStart = Math.max(
        0,
        Math.min(action.newStartMs, state.totalDurationMs - duration),
      );
      let newEnd = newStart + duration;

      // Clamp to not overlap existing clips on target track
      const sortedTarget = [...targetTrack.clips].sort(
        (a, b) => a.startMs - b.startMs,
      );
      for (const existing of sortedTarget) {
        if (newStart < existing.endMs && newEnd > existing.startMs) {
          // Overlap detected — try to place after this clip
          newStart = existing.endMs;
          newEnd = newStart + duration;
        }
      }
      if (newEnd > state.totalDurationMs) return state;

      const movedClip: Clip = {
        ...clip,
        startMs: newStart,
        endMs: newEnd,
      };

      return {
        ...state,
        tracks: state.tracks.map((t) => {
          if (t.id === action.sourceTrackId) {
            return {
              ...t,
              clips: t.clips.filter((c) => c.id !== action.clipId),
            };
          }
          if (t.id === action.targetTrackId) {
            return {
              ...t,
              clips: clampClips([...t.clips, movedClip], state.totalDurationMs),
            };
          }
          return t;
        }),
      };
    }

    case 'RENAME_TRACK': {
      if (action.trackId === OUTPUT_TRACK_ID) return state;
      const usedLabels = new Set(
        state.tracks
          .filter((track) => track.id !== action.trackId)
          .map((track) => normalizeTrackLabel(track.label)),
      );
      const uniqueLabel = claimUniqueTrackLabel(action.newLabel, usedLabels);
      return {
        ...state,
        tracks: state.tracks.map((t) =>
          t.id === action.trackId ? { ...t, label: uniqueLabel } : t,
        ),
      };
    }

    case 'ADD_TRACK': {
      const usedLabels = new Set(
        state.tracks
          .filter((track) => track.id !== OUTPUT_TRACK_ID)
          .map((track) => normalizeTrackLabel(track.label)),
      );
      const preferredLabel = action.label || `Track ${state.tracks.length + 1}`;
      const label = claimUniqueTrackLabel(preferredLabel, usedLabels);
      const newTrack: Track = {
        id: genId(),
        label,
        clips: [],
      };
      return {
        ...state,
        tracks: [newTrack, ...state.tracks],
        rootOrder: [
          { kind: 'track', id: newTrack.id },
          ...state.rootOrder,
        ],
      };
    }

    case 'DELETE_TRACK': {
      if (action.trackId === OUTPUT_TRACK_ID) return state;
      const tracks = state.tracks.filter((t) => t.id !== action.trackId);
      const rootOrder = state.rootOrder.filter(
        (r) => !(r.kind === 'track' && r.id === action.trackId),
      );
      const groups = state.groups.map((g) =>
        g.trackIds.includes(action.trackId)
          ? { ...g, trackIds: g.trackIds.filter((id) => id !== action.trackId) }
          : g,
      );
      return { ...state, tracks, rootOrder, groups };
    }

    case 'REORDER_TRACK': {
      // Legacy action: kept for backwards compatibility. Maps to MOVE_TRACK_TO
      // at root level. New code should dispatch MOVE_TRACK_TO directly.
      if (action.trackId === OUTPUT_TRACK_ID) return state;
      const loc = findTrackLocation(state, action.trackId);
      if (!loc) return state;
      // Build flat root-only list (excluding groups) to match prior semantics.
      const rootTrackRefs = state.rootOrder.filter(
        (r): r is { kind: 'track'; id: string } => r.kind === 'track',
      );
      const oldRootIndex = rootTrackRefs.findIndex(
        (r) => r.id === action.trackId,
      );
      if (loc.kind !== 'root' || oldRootIndex < 0) return state;
      const targetIndex = Math.max(
        0,
        Math.min(action.newIndex, rootTrackRefs.length - 1),
      );
      const targetRef = rootTrackRefs[targetIndex];
      if (targetRef && targetRef.id === OUTPUT_TRACK_ID) return state;
      if (targetIndex === oldRootIndex) return state;

      // Translate root-track-only index back into rootOrder index.
      const moveRef = state.rootOrder.find(
        (r) => r.kind === 'track' && r.id === action.trackId,
      );
      if (!moveRef) return state;
      const newRootOrder = state.rootOrder.filter((r) => r !== moveRef);
      // Find rootOrder index that corresponds to nth root track ref.
      let trackCount = 0;
      let insertAt = newRootOrder.length;
      for (let i = 0; i < newRootOrder.length; i++) {
        if (newRootOrder[i].kind === 'track') {
          if (trackCount === targetIndex) {
            insertAt = i;
            break;
          }
          trackCount++;
        }
      }
      newRootOrder.splice(insertAt, 0, moveRef);
      return { ...state, rootOrder: newRootOrder };
    }

    case 'MOVE_TRACK_TO': {
      if (action.trackId === OUTPUT_TRACK_ID) return state;
      const loc = findTrackLocation(state, action.trackId);
      if (!loc) return state;

      // Strip from current location.
      let groups = state.groups;
      let rootOrder = state.rootOrder;
      if (loc.kind === 'root') {
        rootOrder = rootOrder.filter(
          (r) => !(r.kind === 'track' && r.id === action.trackId),
        );
      } else {
        groups = groups.map((g) =>
          g.id === loc.groupId
            ? {
                ...g,
                trackIds: g.trackIds.filter((id) => id !== action.trackId),
              }
            : g,
        );
      }

      // Insert at target.
      const target = action.target;
      if (target.kind === 'root') {
        const idx = Math.max(0, Math.min(target.index, rootOrder.length));
        // Output track is sticky-last: don't allow inserting after it.
        const outputIdx = rootOrder.findIndex(
          (r) => r.kind === 'track' && r.id === OUTPUT_TRACK_ID,
        );
        const safeIdx =
          outputIdx >= 0 && idx > outputIdx ? outputIdx : idx;
        const next = [...rootOrder];
        next.splice(safeIdx, 0, { kind: 'track', id: action.trackId });
        return { ...state, rootOrder: next, groups };
      } else {
        const targetGroupId = target.groupId;
        const targetGroup = groups.find((g) => g.id === targetGroupId);
        if (!targetGroup) return state;
        const idx = Math.max(
          0,
          Math.min(target.index, targetGroup.trackIds.length),
        );
        groups = groups.map((g) =>
          g.id === targetGroupId
            ? {
                ...g,
                trackIds: [
                  ...g.trackIds.slice(0, idx),
                  action.trackId,
                  ...g.trackIds.slice(idx),
                ],
              }
            : g,
        );
        return { ...state, rootOrder, groups };
      }
    }

    case 'SET_TRACK_ICON': {
      if (action.trackId === OUTPUT_TRACK_ID) return state;
      return {
        ...state,
        tracks: state.tracks.map((t) =>
          t.id === action.trackId ? { ...t, icon: action.icon } : t,
        ),
      };
    }

    case 'ADD_GROUP': {
      const usedLabels = new Set(
        state.groups.map((g) => normalizeGroupLabel(g.label)),
      );
      const preferredLabel =
        action.label || `Group ${state.groups.length + 1}`;
      const label = claimUniqueGroupLabel(preferredLabel, usedLabels);
      const newGroup: TrackGroup = {
        id: genId(),
        label,
        collapsed: false,
        trackIds: [],
      };
      const insertAt =
        typeof action.insertAtIndex === 'number'
          ? Math.max(0, Math.min(action.insertAtIndex, state.rootOrder.length))
          : 0;
      // Don't insert after output track.
      const outputIdx = state.rootOrder.findIndex(
        (r) => r.kind === 'track' && r.id === OUTPUT_TRACK_ID,
      );
      const safeIdx =
        outputIdx >= 0 && insertAt > outputIdx ? outputIdx : insertAt;
      const next = [...state.rootOrder];
      next.splice(safeIdx, 0, { kind: 'group', id: newGroup.id });
      return {
        ...state,
        groups: [...state.groups, newGroup],
        rootOrder: next,
      };
    }

    case 'DELETE_GROUP': {
      const group = state.groups.find((g) => g.id === action.groupId);
      if (!group) return state;
      const groupRefIdx = state.rootOrder.findIndex(
        (r) => r.kind === 'group' && r.id === action.groupId,
      );
      // Re-emit the group's tracks into rootOrder where the group was.
      const restoredRefs: TimelineRowRef[] = group.trackIds.map((id) => ({
        kind: 'track' as const,
        id,
      }));
      const nextRoot = [...state.rootOrder];
      if (groupRefIdx >= 0) {
        nextRoot.splice(groupRefIdx, 1, ...restoredRefs);
      }
      return {
        ...state,
        groups: state.groups.filter((g) => g.id !== action.groupId),
        rootOrder: nextRoot,
      };
    }

    case 'RENAME_GROUP': {
      const usedLabels = new Set(
        state.groups
          .filter((g) => g.id !== action.groupId)
          .map((g) => normalizeGroupLabel(g.label)),
      );
      const uniqueLabel = claimUniqueGroupLabel(action.newLabel, usedLabels);
      return {
        ...state,
        groups: state.groups.map((g) =>
          g.id === action.groupId ? { ...g, label: uniqueLabel } : g,
        ),
      };
    }

    case 'SET_GROUP_COLLAPSED': {
      return {
        ...state,
        groups: state.groups.map((g) =>
          g.id === action.groupId ? { ...g, collapsed: action.collapsed } : g,
        ),
      };
    }

    case 'SET_GROUP_ICON': {
      return {
        ...state,
        groups: state.groups.map((g) =>
          g.id === action.groupId ? { ...g, icon: action.icon } : g,
        ),
      };
    }

    case 'MOVE_GROUP': {
      const oldIdx = state.rootOrder.findIndex(
        (r) => r.kind === 'group' && r.id === action.groupId,
      );
      if (oldIdx < 0) return state;
      const outputIdx = state.rootOrder.findIndex(
        (r) => r.kind === 'track' && r.id === OUTPUT_TRACK_ID,
      );
      const maxIdx =
        outputIdx >= 0 ? outputIdx - 1 : state.rootOrder.length - 1;
      const targetIdx = Math.max(
        0,
        Math.min(action.newIndex, Math.max(0, maxIdx)),
      );
      if (targetIdx === oldIdx) return state;
      const next = [...state.rootOrder];
      const [moved] = next.splice(oldIdx, 1);
      next.splice(targetIdx, 0, moved);
      return { ...state, rootOrder: next };
    }

    case 'REPLACE_INPUT_ID': {
      const updatedKnown = new Set(state.knownInputIds);
      updatedKnown.add(action.newInputId);
      const tracks = state.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) =>
          clip.inputId === action.oldInputId
            ? { ...clip, inputId: action.newInputId }
            : clip,
        ),
      }));
      return { ...state, tracks, knownInputIds: updatedKnown };
    }

    case 'SWAP_CLIP_INPUT': {
      const { trackId, clipId, newInputId, sourceUpdates } = action;
      // Mark both the old and new inputIds as known so SYNC_TRACKS won't
      // auto-create tracks for the swapped-out input or the incoming one.
      const updatedKnown = new Set(state.knownInputIds);
      const targetTrack = state.tracks.find((t) => t.id === trackId);
      const targetClip = targetTrack?.clips.find((c) => c.id === clipId);
      if (targetClip) updatedKnown.add(targetClip.inputId);
      updatedKnown.add(newInputId);
      const swapLabelSuffix = buildSwapLabelSuffix(state, clipId, newInputId);

      return {
        ...state,
        knownInputIds: updatedKnown,
        tracks: state.tracks.map((track) => {
          if (track.id !== trackId) return track;
          return {
            ...track,
            clips: track.clips.map((clip) => {
              if (clip.id !== clipId) return clip;
              const mergedSettings = {
                ...clip.blockSettings,
                ...sourceUpdates,
                swapLabelSuffix,
              };
              return {
                ...clip,
                inputId: newInputId,
                blockSettings: mergedSettings,
                keyframes: clip.keyframes.map((kf) => ({
                  ...kf,
                  blockSettings: {
                    ...kf.blockSettings,
                    ...sourceUpdates,
                    swapLabelSuffix,
                  },
                })),
              };
            }),
          };
        }),
      };
    }

    case 'UPDATE_CLIP_SETTINGS': {
      let targetInputId: string | undefined;
      const syncAbsFlag = action.patch.absolutePosition !== undefined;
      if (syncAbsFlag) {
        const track = state.tracks.find((t) => t.id === action.trackId);
        const clip = track?.clips.find((c) => c.id === action.clipId);
        targetInputId = clip?.inputId;
      }

      const hasCropInPatch =
        'cropTop' in action.patch ||
        'cropLeft' in action.patch ||
        'cropRight' in action.patch ||
        'cropBottom' in action.patch;

      return {
        ...state,
        tracks: state.tracks.map((track) => {
          return {
            ...track,
            clips: track.clips.map((clip) => {
              const isTarget =
                track.id === action.trackId && clip.id === action.clipId;
              const isSibling =
                !isTarget &&
                syncAbsFlag &&
                targetInputId &&
                clip.inputId === targetInputId;

              if (!isTarget && !isSibling) return clip;

              const patch = isTarget
                ? action.patch
                : { absolutePosition: action.patch.absolutePosition };
              const merged = {
                ...clip.blockSettings,
                ...patch,
                shaders:
                  patch.shaders !== undefined
                    ? patch.shaders.map((shader) => ({
                        ...shader,
                        params: (shader.params || []).map((param) => ({
                          ...param,
                        })),
                      }))
                    : clip.blockSettings.shaders,
                attachedInputIds:
                  patch.attachedInputIds !== undefined
                    ? [...patch.attachedInputIds]
                    : clip.blockSettings.attachedInputIds,
              };
              let endMs = clip.endMs;
              if (merged.mp4Loop === false && merged.mp4DurationMs != null) {
                const maxDuration =
                  merged.mp4DurationMs - (merged.mp4PlayFromMs ?? 0);
                if (maxDuration > 0 && endMs - clip.startMs > maxDuration) {
                  endMs = clip.startMs + maxDuration;
                }
              }
              const cropPatch =
                hasCropInPatch && isTarget
                  ? {
                      cropTop: merged.cropTop,
                      cropLeft: merged.cropLeft,
                      cropRight: merged.cropRight,
                      cropBottom: merged.cropBottom,
                    }
                  : null;
              const nextKeyframes = clip.keyframes.map((keyframe) => {
                if (keyframe.timeMs === 0) {
                  return {
                    ...keyframe,
                    blockSettings: cloneBlockSettings(merged),
                  };
                }
                if (cropPatch) {
                  return {
                    ...cloneKeyframe(keyframe),
                    blockSettings: {
                      ...cloneBlockSettings(keyframe.blockSettings),
                      ...cropPatch,
                    },
                  };
                }
                return cloneKeyframe(keyframe);
              });
              return syncClipKeyframes({
                ...clip,
                endMs,
                blockSettings: merged,
                keyframes: nextKeyframes,
              });
            }),
          };
        }),
      };
    }

    case 'ADD_KEYFRAME': {
      return {
        ...state,
        tracks: state.tracks.map((track) => {
          if (track.id !== action.trackId) return track;
          return {
            ...track,
            clips: track.clips.map((clip) => {
              if (clip.id !== action.clipId) return clip;
              const durationMs = getClipDuration(clip);
              const timeMs = Math.max(
                0,
                Math.min(Math.round(action.timeMs), durationMs),
              );
              const resolved =
                action.blockSettings ??
                resolveClipBlockSettingsAtOffset(clip, timeMs);
              const blockSettings = cloneBlockSettings({
                ...resolved,
                cropTop: clip.blockSettings.cropTop,
                cropLeft: clip.blockSettings.cropLeft,
                cropRight: clip.blockSettings.cropRight,
                cropBottom: clip.blockSettings.cropBottom,
              });
              return syncClipKeyframes({
                ...clip,
                keyframes: [
                  ...clip.keyframes.map(cloneKeyframe),
                  {
                    id: genId(),
                    timeMs,
                    blockSettings,
                  },
                ],
              });
            }),
          };
        }),
      };
    }

    case 'UPDATE_KEYFRAME': {
      const hasCropInKfPatch =
        'cropTop' in action.patch ||
        'cropLeft' in action.patch ||
        'cropRight' in action.patch ||
        'cropBottom' in action.patch;

      return {
        ...state,
        tracks: state.tracks.map((track) => {
          if (track.id !== action.trackId) return track;
          return {
            ...track,
            clips: track.clips.map((clip) => {
              if (clip.id !== action.clipId) return clip;

              const targetKf = clip.keyframes.find(
                (kf) => kf.id === action.keyframeId,
              );
              const mergedTarget = targetKf
                ? {
                    ...cloneBlockSettings(targetKf.blockSettings),
                    ...action.patch,
                  }
                : null;

              const cropPatch =
                hasCropInKfPatch && mergedTarget
                  ? {
                      cropTop: mergedTarget.cropTop,
                      cropLeft: mergedTarget.cropLeft,
                      cropRight: mergedTarget.cropRight,
                      cropBottom: mergedTarget.cropBottom,
                    }
                  : null;

              const keyframes = clip.keyframes.map((keyframe) => {
                if (keyframe.id === action.keyframeId) {
                  return {
                    ...cloneKeyframe(keyframe),
                    blockSettings: {
                      ...cloneBlockSettings(keyframe.blockSettings),
                      ...action.patch,
                    },
                  };
                }
                if (cropPatch) {
                  return {
                    ...cloneKeyframe(keyframe),
                    blockSettings: {
                      ...cloneBlockSettings(keyframe.blockSettings),
                      ...cropPatch,
                    },
                  };
                }
                return cloneKeyframe(keyframe);
              });

              const blockSettings = cropPatch
                ? { ...clip.blockSettings, ...cropPatch }
                : clip.blockSettings;

              return syncClipKeyframes({ ...clip, blockSettings, keyframes });
            }),
          };
        }),
      };
    }

    case 'DELETE_KEYFRAME': {
      return {
        ...state,
        tracks: state.tracks.map((track) => {
          if (track.id !== action.trackId) return track;
          return {
            ...track,
            clips: track.clips.map((clip) => {
              if (clip.id !== action.clipId) return clip;
              const target = clip.keyframes.find(
                (keyframe) => keyframe.id === action.keyframeId,
              );
              if (!target || target.timeMs === 0) {
                return clip;
              }
              return syncClipKeyframes({
                ...clip,
                keyframes: clip.keyframes
                  .filter((keyframe) => keyframe.id !== action.keyframeId)
                  .map(cloneKeyframe),
              });
            }),
          };
        }),
      };
    }

    case 'MOVE_KEYFRAME': {
      return {
        ...state,
        tracks: state.tracks.map((track) => {
          if (track.id !== action.trackId) return track;
          return {
            ...track,
            clips: track.clips.map((clip) => {
              if (clip.id !== action.clipId) return clip;
              const durationMs = getClipDuration(clip);
              const current = clip.keyframes.find(
                (keyframe) => keyframe.id === action.keyframeId,
              );
              if (!current || current.timeMs === 0) {
                return clip;
              }
              const timeMs = Math.max(
                1,
                Math.min(Math.round(action.timeMs), durationMs),
              );
              return syncClipKeyframes({
                ...clip,
                keyframes: clip.keyframes.map((keyframe) =>
                  keyframe.id === action.keyframeId
                    ? {
                        ...cloneKeyframe(keyframe),
                        timeMs,
                      }
                    : cloneKeyframe(keyframe),
                ),
              });
            }),
          };
        }),
      };
    }

    case 'MOVE_CLIPS': {
      let newTotalDuration = state.totalDurationMs;
      const moveLookup = new Map(
        action.moves
          .filter((m) => m.clipId !== OUTPUT_CLIP_ID)
          .map((m) => [`${m.trackId}:${m.clipId}`, m.newStartMs]),
      );
      const newTracks = state.tracks.map((track) => {
        const newClips = track.clips.map((clip) => {
          const key = `${track.id}:${clip.id}`;
          const newStart = moveLookup.get(key);
          if (newStart == null) return clip;
          const duration = clip.endMs - clip.startMs;
          const clampedStart = Math.max(0, newStart);
          const newEnd = clampedStart + duration;
          if (newEnd > newTotalDuration) {
            newTotalDuration = newEnd + 5000;
          }
          return { ...clip, startMs: clampedStart, endMs: newEnd };
        });
        return { ...track, clips: clampClips(newClips, newTotalDuration) };
      });
      return { ...state, totalDurationMs: newTotalDuration, tracks: newTracks };
    }

    case 'DELETE_CLIPS': {
      const deleteSet = new Set(
        action.clips
          .filter((c) => c.clipId !== OUTPUT_CLIP_ID)
          .map((c) => `${c.trackId}:${c.clipId}`),
      );
      const newTracks = state.tracks.map((track) => ({
        ...track,
        clips: track.clips.filter((c) => !deleteSet.has(`${track.id}:${c.id}`)),
      }));
      return { ...state, tracks: newTracks };
    }

    case 'PURGE_INPUT_ID': {
      if (action.inputId === OUTPUT_TRACK_INPUT_ID) return state;
      const newTracks = state.tracks.map((track) => ({
        ...track,
        clips: track.clips.filter((c) => c.inputId !== action.inputId),
      }));
      return withReconciledOrder({ ...state, tracks: newTracks });
    }

    case 'CLEANUP_SPURIOUS_WHIP_TRACK': {
      const topTrack = state.tracks.find((t) => t.id !== OUTPUT_TRACK_ID);
      if (!topTrack) return state;
      if (topTrack.clips.length !== 1) return state;
      const clip = topTrack.clips[0];
      if (clip.inputId !== action.inputId) return state;
      const isFullSpan =
        clip.startMs === 0 && clip.endMs >= state.totalDurationMs;
      if (!isFullSpan) return state;
      return withReconciledOrder({
        ...state,
        tracks: state.tracks.filter((t) => t.id !== topTrack.id),
      });
    }

    case 'LOAD': {
      const normalizedTracks = normalizeTracks(
        action.state.tracks,
        [],
        action.state.totalDurationMs,
      );
      const finalTracks = ensureOutputTrack(
        normalizedTracks,
        action.state.totalDurationMs,
      );
      const reconciled = reconcileOrder(
        finalTracks,
        action.state.groups ?? [],
        action.state.rootOrder ?? buildDefaultRootOrder(finalTracks),
      );
      return {
        ...action.state,
        tracks: finalTracks,
        groups: reconciled.groups,
        rootOrder: reconciled.rootOrder,
        keyframeInterpolationMode:
          action.state.keyframeInterpolationMode ?? 'step',
        snapToBlocks: action.state.snapToBlocks ?? true,
        snapToKeyframes: action.state.snapToKeyframes ?? true,
        knownInputIds: new Set(action.state.knownInputIds),
      };
    }

    default:
      return state;
  }
}

// ── Undo / Redo wrapper ──────────────────────────────────

const MAX_UNDO = 50;

type UndoableState = {
  current: TimelineState;
  past: TimelineState[];
  future: TimelineState[];
};

const UNDOABLE_ACTIONS = new Set<TimelineAction['type']>([
  'MOVE_CLIP',
  'RESIZE_CLIP',
  'SPLIT_CLIP',
  'DELETE_CLIP',
  'DUPLICATE_CLIP',
  'MOVE_CLIP_TO_TRACK',
  'RENAME_TRACK',
  'ADD_TRACK',
  'DELETE_TRACK',
  'REORDER_TRACK',
  'RESET',
  'UPDATE_CLIP_SETTINGS',
  'SET_KEYFRAME_INTERPOLATION_MODE',
  'ADD_KEYFRAME',
  'UPDATE_KEYFRAME',
  'DELETE_KEYFRAME',
  'MOVE_KEYFRAME',
  'PURGE_INPUT_ID',
  'SWAP_CLIP_INPUT',
  'MOVE_CLIPS',
  'DELETE_CLIPS',
  'SET_TRACK_ICON',
  'ADD_GROUP',
  'DELETE_GROUP',
  'RENAME_GROUP',
  'SET_GROUP_COLLAPSED',
  'SET_GROUP_ICON',
  'MOVE_GROUP',
  'MOVE_TRACK_TO',
]);

type UndoableAction = TimelineAction | { type: 'UNDO' } | { type: 'REDO' };

function undoableReducer(
  state: UndoableState,
  action: UndoableAction,
): UndoableState {
  if (action.type === 'UNDO') {
    if (state.past.length === 0) return state;
    const prev = state.past[state.past.length - 1];
    return {
      current: {
        ...prev,
        playheadMs: state.current.playheadMs,
        pixelsPerSecond: state.current.pixelsPerSecond,
        isPlaying: state.current.isPlaying,
        knownInputIds: state.current.knownInputIds,
      },
      past: state.past.slice(0, -1),
      future: [state.current, ...state.future],
    };
  }

  if (action.type === 'REDO') {
    if (state.future.length === 0) return state;
    const next = state.future[0];
    return {
      current: {
        ...next,
        playheadMs: state.current.playheadMs,
        pixelsPerSecond: state.current.pixelsPerSecond,
        isPlaying: state.current.isPlaying,
        knownInputIds: state.current.knownInputIds,
      },
      past: [...state.past, state.current],
      future: state.future.slice(1),
    };
  }

  const newCurrent = timelineReducer(state.current, action);
  if (newCurrent === state.current) return state;

  if (UNDOABLE_ACTIONS.has(action.type)) {
    return {
      current: newCurrent,
      past: [...state.past.slice(-MAX_UNDO + 1), state.current],
      future: [],
    };
  }

  return { ...state, current: newCurrent };
}

// ── Hook ─────────────────────────────────────────────────

export function useTimelineState(roomId: string, inputs: Input[]) {
  const [undoable, dispatch] = useReducer(undoableReducer, null, () => {
    const stored = loadTimeline(roomId);
    let initial: TimelineState;
    if (stored != null) {
      // Check if stored data is V1 format (tracks as Record) or V2 (tracks as Array)
      if (stored.tracks && !Array.isArray(stored.tracks)) {
        // V1 → V2 migration
        const migrated = migrateV1ToV2(stored as Record<string, unknown>);
        initial = migrated || createInitialState();
      } else {
        const totalDurationMs =
          (stored.totalDurationMs as number) || DEFAULT_DURATION_MS;
        const parsedTracks = storedTracksToTracks(stored.tracks);
        initial = {
          tracks: normalizeTracks(parsedTracks, inputs, totalDurationMs),
          groups: stored.groups
            ? stored.groups.map((g) => ({
                id: g.id,
                label: g.label,
                icon: g.icon,
                collapsed: g.collapsed,
                trackIds: [...g.trackIds],
              }))
            : [],
          rootOrder: stored.rootOrder
            ? stored.rootOrder.map(
                (r): TimelineRowRef =>
                  r.kind === 'group'
                    ? { kind: 'group', id: r.id }
                    : { kind: 'track', id: r.id },
              )
            : [],
          totalDurationMs,
          keyframeInterpolationMode: stored.keyframeInterpolationMode ?? 'step',
          snapToBlocks: stored.snapToBlocks ?? true,
          snapToKeyframes: stored.snapToKeyframes ?? true,
          playheadMs: 0,
          isPlaying: false,
          pixelsPerSecond: stored.pixelsPerSecond || DEFAULT_PPS,
          knownInputIds: new Set(inputs.map((input) => input.inputId)),
        };
      }
    } else {
      initial = createInitialState();
    }
    initial.tracks = ensureOutputTrack(
      normalizeTracks(initial.tracks, inputs, initial.totalDurationMs),
      initial.totalDurationMs,
    );
    const reconciled = reconcileOrder(
      initial.tracks,
      initial.groups,
      initial.rootOrder.length > 0
        ? initial.rootOrder
        : buildDefaultRootOrder(initial.tracks),
    );
    initial.groups = reconciled.groups;
    initial.rootOrder = reconciled.rootOrder;
    return {
      current: initial,
      past: [],
      future: [],
    };
  });

  const state = undoable.current;

  const initializedRef = useRef(false);
  const [structureRevision, setStructureRevision] = useState(0);

  // Sync tracks when inputs change
  useEffect(() => {
    dispatch({ type: 'SYNC_TRACKS', inputs });
    initializedRef.current = true;
  }, [inputs]);

  // Persist to localStorage on meaningful timeline changes (debounced).
  // Intentionally skip playhead/isPlaying to avoid save churn during playback.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistedTimeline = useMemo(
    () => ({
      tracks: state.tracks,
      groups: state.groups,
      rootOrder: state.rootOrder,
      totalDurationMs: state.totalDurationMs,
      keyframeInterpolationMode: state.keyframeInterpolationMode,
      snapToBlocks: state.snapToBlocks,
      snapToKeyframes: state.snapToKeyframes,
      playheadMs: state.isPlaying
        ? Math.floor(state.playheadMs / 1000) * 1000
        : state.playheadMs,
      pixelsPerSecond: state.pixelsPerSecond,
    }),
    [
      state.tracks,
      state.groups,
      state.rootOrder,
      state.totalDurationMs,
      state.keyframeInterpolationMode,
      state.snapToBlocks,
      state.snapToKeyframes,
      state.isPlaying,
      state.playheadMs,
      state.pixelsPerSecond,
    ],
  );

  useEffect(() => {
    if (!initializedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimeline(roomId, {
        tracks: persistedTimeline.tracks,
        groups: persistedTimeline.groups,
        rootOrder: persistedTimeline.rootOrder,
        totalDurationMs: persistedTimeline.totalDurationMs,
        keyframeInterpolationMode: persistedTimeline.keyframeInterpolationMode,
        snapToBlocks: persistedTimeline.snapToBlocks,
        snapToKeyframes: persistedTimeline.snapToKeyframes,
        playheadMs: persistedTimeline.playheadMs,
        pixelsPerSecond: persistedTimeline.pixelsPerSecond,
      });
    }, 500);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [roomId, persistedTimeline]);

  const setPlayhead = useCallback(
    (ms: number) => dispatch({ type: 'SET_PLAYHEAD', ms }),
    [],
  );

  const setPlaying = useCallback(
    (playing: boolean) => dispatch({ type: 'SET_PLAYING', playing }),
    [],
  );

  const setZoom = useCallback(
    (pixelsPerSecond: number) =>
      dispatch({ type: 'SET_ZOOM', pixelsPerSecond }),
    [],
  );

  const setTotalDuration = useCallback(
    (durationMs: number) =>
      dispatch({ type: 'SET_TOTAL_DURATION', durationMs }),
    [],
  );

  const setKeyframeInterpolationMode = useCallback(
    (mode: TimelineKeyframeInterpolationMode) =>
      dispatch({ type: 'SET_KEYFRAME_INTERPOLATION_MODE', mode }),
    [],
  );

  const setSnapToBlocks = useCallback(
    (enabled: boolean) => dispatch({ type: 'SET_SNAP_TO_BLOCKS', enabled }),
    [],
  );

  const setSnapToKeyframes = useCallback(
    (enabled: boolean) => dispatch({ type: 'SET_SNAP_TO_KEYFRAMES', enabled }),
    [],
  );

  const reset = useCallback(() => {
    dispatch({ type: 'RESET', inputs });
    setStructureRevision((rev) => rev + 1);
  }, [inputs]);

  const moveClip = useCallback(
    (trackId: string, clipId: string, newStartMs: number) => {
      dispatch({ type: 'MOVE_CLIP', trackId, clipId, newStartMs });
      setStructureRevision((rev) => rev + 1);
    },
    [],
  );

  const resizeClip = useCallback(
    (
      trackId: string,
      clipId: string,
      edge: 'left' | 'right',
      newMs: number,
    ) => {
      dispatch({ type: 'RESIZE_CLIP', trackId, clipId, edge, newMs });
      setStructureRevision((rev) => rev + 1);
    },
    [],
  );

  const splitClip = useCallback(
    (trackId: string, clipId: string, atMs: number) => {
      dispatch({ type: 'SPLIT_CLIP', trackId, clipId, atMs });
      setStructureRevision((rev) => rev + 1);
    },
    [],
  );

  const deleteClip = useCallback((trackId: string, clipId: string) => {
    dispatch({ type: 'DELETE_CLIP', trackId, clipId });
    setStructureRevision((rev) => rev + 1);
  }, []);

  const duplicateClip = useCallback((trackId: string, clipId: string) => {
    dispatch({ type: 'DUPLICATE_CLIP', trackId, clipId });
    setStructureRevision((rev) => rev + 1);
  }, []);

  const moveClipToTrack = useCallback(
    (
      sourceTrackId: string,
      clipId: string,
      targetTrackId: string,
      newStartMs: number,
    ) => {
      dispatch({
        type: 'MOVE_CLIP_TO_TRACK',
        sourceTrackId,
        clipId,
        targetTrackId,
        newStartMs,
      });
      setStructureRevision((rev) => rev + 1);
    },
    [],
  );

  const renameTrack = useCallback((trackId: string, newLabel: string) => {
    dispatch({ type: 'RENAME_TRACK', trackId, newLabel });
    setStructureRevision((rev) => rev + 1);
  }, []);

  const addTrack = useCallback((label?: string) => {
    dispatch({ type: 'ADD_TRACK', label: label ?? '' });
    setStructureRevision((rev) => rev + 1);
  }, []);

  const deleteTrack = useCallback((trackId: string) => {
    dispatch({ type: 'DELETE_TRACK', trackId });
    setStructureRevision((rev) => rev + 1);
  }, []);

  const reorderTrack = useCallback((trackId: string, newIndex: number) => {
    dispatch({ type: 'REORDER_TRACK', trackId, newIndex });
    setStructureRevision((rev) => rev + 1);
  }, []);

  const moveTrackTo = useCallback(
    (
      trackId: string,
      target:
        | { kind: 'root'; index: number }
        | { kind: 'group'; groupId: string; index: number },
    ) => {
      dispatch({ type: 'MOVE_TRACK_TO', trackId, target });
      setStructureRevision((rev) => rev + 1);
    },
    [],
  );

  const setTrackIcon = useCallback(
    (trackId: string, icon: string | undefined) => {
      dispatch({ type: 'SET_TRACK_ICON', trackId, icon });
      setStructureRevision((rev) => rev + 1);
    },
    [],
  );

  const addGroup = useCallback((label?: string, insertAtIndex?: number) => {
    dispatch({ type: 'ADD_GROUP', label, insertAtIndex });
    setStructureRevision((rev) => rev + 1);
  }, []);

  const deleteGroup = useCallback((groupId: string) => {
    dispatch({ type: 'DELETE_GROUP', groupId });
    setStructureRevision((rev) => rev + 1);
  }, []);

  const renameGroup = useCallback((groupId: string, newLabel: string) => {
    dispatch({ type: 'RENAME_GROUP', groupId, newLabel });
    setStructureRevision((rev) => rev + 1);
  }, []);

  const setGroupCollapsed = useCallback(
    (groupId: string, collapsed: boolean) => {
      dispatch({ type: 'SET_GROUP_COLLAPSED', groupId, collapsed });
    },
    [],
  );

  const setGroupIcon = useCallback(
    (groupId: string, icon: string | undefined) => {
      dispatch({ type: 'SET_GROUP_ICON', groupId, icon });
      setStructureRevision((rev) => rev + 1);
    },
    [],
  );

  const moveGroup = useCallback((groupId: string, newIndex: number) => {
    dispatch({ type: 'MOVE_GROUP', groupId, newIndex });
    setStructureRevision((rev) => rev + 1);
  }, []);

  const replaceInputId = useCallback(
    (oldInputId: string, newInputId: string) => {
      dispatch({ type: 'REPLACE_INPUT_ID', oldInputId, newInputId });
      setStructureRevision((rev) => rev + 1);
    },
    [],
  );

  const swapClipInput = useCallback(
    (
      trackId: string,
      clipId: string,
      newInputId: string,
      sourceUpdates?: Partial<BlockSettings>,
    ) => {
      dispatch({
        type: 'SWAP_CLIP_INPUT',
        trackId,
        clipId,
        newInputId,
        sourceUpdates,
      });
      setStructureRevision((rev) => rev + 1);
    },
    [],
  );

  const updateClipSettings = useCallback(
    (trackId: string, clipId: string, patch: Partial<BlockSettings>) => {
      dispatch({ type: 'UPDATE_CLIP_SETTINGS', trackId, clipId, patch });
      setStructureRevision((rev) => rev + 1);
    },
    [],
  );

  const addKeyframe = useCallback(
    (
      trackId: string,
      clipId: string,
      timeMs: number,
      blockSettings?: BlockSettings,
    ) => {
      dispatch({
        type: 'ADD_KEYFRAME',
        trackId,
        clipId,
        timeMs,
        blockSettings,
      });
      setStructureRevision((rev) => rev + 1);
    },
    [],
  );

  const updateKeyframe = useCallback(
    (
      trackId: string,
      clipId: string,
      keyframeId: string,
      patch: Partial<BlockSettings>,
    ) => {
      dispatch({
        type: 'UPDATE_KEYFRAME',
        trackId,
        clipId,
        keyframeId,
        patch,
      });
      setStructureRevision((rev) => rev + 1);
    },
    [],
  );

  const deleteKeyframe = useCallback(
    (trackId: string, clipId: string, keyframeId: string) => {
      dispatch({ type: 'DELETE_KEYFRAME', trackId, clipId, keyframeId });
      setStructureRevision((rev) => rev + 1);
    },
    [],
  );

  const moveKeyframe = useCallback(
    (trackId: string, clipId: string, keyframeId: string, timeMs: number) => {
      dispatch({ type: 'MOVE_KEYFRAME', trackId, clipId, keyframeId, timeMs });
      setStructureRevision((rev) => rev + 1);
    },
    [],
  );

  const purgeInputId = useCallback((inputId: string) => {
    dispatch({ type: 'PURGE_INPUT_ID', inputId });
    setStructureRevision((rev) => rev + 1);
  }, []);

  const cleanupSpuriousWhipTrack = useCallback((inputId: string) => {
    dispatch({ type: 'CLEANUP_SPURIOUS_WHIP_TRACK', inputId });
    setStructureRevision((rev) => rev + 1);
  }, []);

  const moveClips = useCallback(
    (moves: { trackId: string; clipId: string; newStartMs: number }[]) => {
      dispatch({ type: 'MOVE_CLIPS', moves });
      setStructureRevision((rev) => rev + 1);
    },
    [],
  );

  const deleteClips = useCallback(
    (clips: { trackId: string; clipId: string }[]) => {
      dispatch({ type: 'DELETE_CLIPS', clips });
      setStructureRevision((rev) => rev + 1);
    },
    [],
  );

  const undo = useCallback(() => dispatch({ type: 'UNDO' }), []);
  const redo = useCallback(() => dispatch({ type: 'REDO' }), []);
  const canUndo = undoable.past.length > 0;
  const canRedo = undoable.future.length > 0;
  const loadState = useCallback((nextState: TimelineState) => {
    dispatch({ type: 'LOAD', state: nextState });
    setStructureRevision((rev) => rev + 1);
  }, []);

  return {
    state,
    dispatch,
    loadState,
    setPlayhead,
    setPlaying,
    setZoom,
    setTotalDuration,
    setKeyframeInterpolationMode,
    setSnapToBlocks,
    setSnapToKeyframes,
    reset,
    moveClip,
    resizeClip,
    splitClip,
    deleteClip,
    duplicateClip,
    moveClipToTrack,
    renameTrack,
    addTrack,
    deleteTrack,
    reorderTrack,
    moveTrackTo,
    setTrackIcon,
    addGroup,
    deleteGroup,
    renameGroup,
    setGroupCollapsed,
    setGroupIcon,
    moveGroup,
    replaceInputId,
    swapClipInput,
    updateClipSettings,
    addKeyframe,
    updateKeyframe,
    deleteKeyframe,
    moveKeyframe,
    purgeInputId,
    cleanupSpuriousWhipTrack,
    moveClips,
    deleteClips,
    undo,
    redo,
    canUndo,
    canRedo,
    structureRevision,
  };
}
