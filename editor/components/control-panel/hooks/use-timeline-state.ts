'use client';

import { useReducer, useEffect, useCallback, useRef, useState } from 'react';
import type { Input } from '@/app/actions/actions';
import { loadTimeline, saveTimeline } from '@/lib/timeline-storage';

// ── Types ────────────────────────────────────────────────

export type Clip = {
  id: string;
  inputId: string;
  startMs: number;
  endMs: number;
  blockSettings: BlockSettings;
};

export type Track = {
  id: string;
  label: string;
  clips: Clip[];
};

export type BlockSettings = {
  volume: number;
  showTitle: boolean;
  shaders: Input['shaders'];
  orientation: Input['orientation'];
  text?: string;
  textAlign?: Input['textAlign'];
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
};

/** @deprecated Use `Clip` instead. Kept for backwards compat with room-config. */
export type Segment = Clip;

/** @deprecated Kept for backwards compat with room-config imports. Will be removed. */
export type OrderKeyframe = {
  id: string;
  timeMs: number;
  inputOrder: string[];
};

/** @deprecated Use `Track` instead. */
export type TrackTimeline = {
  inputId: string;
  segments: Segment[];
};

export type TimelineState = {
  tracks: Track[];
  totalDurationMs: number;
  playheadMs: number;
  isPlaying: boolean;
  pixelsPerSecond: number;
};

// ── Actions ──────────────────────────────────────────────

type TimelineAction =
  | { type: 'SYNC_TRACKS'; inputs: Input[] }
  | { type: 'SET_PLAYHEAD'; ms: number }
  | { type: 'SET_PLAYING'; playing: boolean }
  | { type: 'SET_ZOOM'; pixelsPerSecond: number }
  | { type: 'SET_TOTAL_DURATION'; durationMs: number }
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
  | { type: 'PURGE_INPUT_ID'; inputId: string };

// ── Constants ────────────────────────────────────────────

const DEFAULT_DURATION_MS = 60_000; // 1 minute
const DEFAULT_PPS = 15; // pixels per second (60s × 15 = 900px at default)
const MIN_PPS = 2;
const MAX_PPS = 100;
export const MIN_CLIP_MS = 1000;
/** @deprecated Use MIN_CLIP_MS instead */
export const MIN_SEGMENT_MS = MIN_CLIP_MS;

export { DEFAULT_DURATION_MS, DEFAULT_PPS, MIN_PPS, MAX_PPS };

// ── Helpers ──────────────────────────────────────────────

function genId(): string {
  return crypto.randomUUID();
}

function cloneBlockSettings(settings: BlockSettings): BlockSettings {
  return {
    ...settings,
    shaders: (settings.shaders || []).map((shader) => ({
      ...shader,
      params: (shader.params || []).map((param) => ({ ...param })),
    })),
    attachedInputIds: settings.attachedInputIds
      ? [...settings.attachedInputIds]
      : undefined,
  };
}

export function createBlockSettingsFromInput(input?: Input): BlockSettings {
  return {
    volume: input?.volume ?? 1,
    showTitle: input?.showTitle !== false,
    shaders: (input?.shaders || []).map((shader) => ({
      ...shader,
      params: (shader.params || []).map((param) => ({ ...param })),
    })),
    orientation: input?.orientation ?? 'horizontal',
    text: input?.text,
    textAlign: input?.textAlign,
    textColor: input?.textColor,
    textMaxLines: input?.textMaxLines,
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
  };
}

function ensureClipBlockSettings(
  clip: Omit<Clip, 'blockSettings'> & Partial<Pick<Clip, 'blockSettings'>>,
  input?: Input,
): Clip {
  if (clip.blockSettings) {
    return { ...clip, blockSettings: cloneBlockSettings(clip.blockSettings) };
  }
  return {
    ...clip,
    blockSettings: createBlockSettingsFromInput(input),
  };
}

function inferTypeFromInputId(inputId: string): string | null {
  if (inputId.includes('::twitch::')) return 'twitch-channel';
  if (inputId.includes('::kick::')) return 'kick-channel';
  if (inputId.includes('::whip::')) return 'whip';
  if (inputId.includes('::local::')) return 'local-mp4';
  if (inputId.includes('::image::')) return 'image';
  if (inputId.includes('::text::')) return 'text-input';
  return null;
}

function normalizeTracks(
  tracks: Track[],
  inputs: Input[],
  totalDurationMs: number,
): Track[] {
  const inputById = new Map(inputs.map((input) => [input.inputId, input]));
  return tracks.map((track) => ({
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
  return {
    id: genId(),
    inputId,
    startMs: 0,
    endMs: totalDurationMs,
    blockSettings: createBlockSettingsFromInput(input),
  };
}

function createInitialState(): TimelineState {
  return {
    tracks: [],
    totalDurationMs: DEFAULT_DURATION_MS,
    playheadMs: 0,
    isPlaying: false,
    pixelsPerSecond: DEFAULT_PPS,
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
    totalDurationMs: (stored.totalDurationMs as number) || DEFAULT_DURATION_MS,
    playheadMs: 0,
    isPlaying: false,
    pixelsPerSecond: (stored.pixelsPerSecond as number) || DEFAULT_PPS,
  };
}

// ── Reducer ──────────────────────────────────────────────

function timelineReducer(
  state: TimelineState,
  action: TimelineAction,
): TimelineState {
  switch (action.type) {
    case 'SYNC_TRACKS': {
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
      // the current inputs list, excluding pending-whip placeholders).
      const disconnectedInputIds = new Set<string>();
      for (const track of state.tracks) {
        for (const clip of track.clips) {
          if (
            !currentInputIds.has(clip.inputId) &&
            !clip.inputId.startsWith('__pending-whip-')
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
      const newTracks: Track[] = state.tracks
        .map((track) => ({
          ...track,
          clips: track.clips.map((clip) => {
            const replacement = replacementMap.get(clip.inputId);
            const resolvedId = replacement ?? clip.inputId;
            return ensureClipBlockSettings(
              replacement ? { ...clip, inputId: resolvedId } : clip,
              inputById.get(resolvedId),
            );
          }),
        }))
        .filter((track) => track.clips.length > 0);

      // For each input that has no clips on any existing track, create a new track
      const nowCoveredInputIds = new Set<string>();
      for (const track of newTracks) {
        for (const clip of track.clips) {
          nowCoveredInputIds.add(clip.inputId);
        }
      }
      let nextTrackNumber = newTracks.length + 1;
      for (const input of action.inputs) {
        if (!nowCoveredInputIds.has(input.inputId)) {
          newTracks.push({
            id: genId(),
            label: `Track ${nextTrackNumber}`,
            clips: [makeFullClip(input.inputId, state.totalDurationMs, input)],
          });
          nextTrackNumber++;
        }
      }

      return { ...state, tracks: newTracks };
    }

    case 'SET_PLAYHEAD':
      return {
        ...state,
        playheadMs: Math.max(0, Math.min(action.ms, state.totalDurationMs)),
      };

    case 'SET_PLAYING':
      return { ...state, isPlaying: action.playing };

    case 'SET_ZOOM':
      return { ...state, pixelsPerSecond: clampZoom(action.pixelsPerSecond) };

    case 'SET_TOTAL_DURATION': {
      const durationMs = Math.max(10_000, action.durationMs);
      return {
        ...state,
        totalDurationMs: durationMs,
        playheadMs: Math.min(state.playheadMs, durationMs),
      };
    }

    case 'RESET': {
      const tracks: Track[] = action.inputs.map((input, idx) => ({
        id: genId(),
        label: `Track ${idx + 1}`,
        clips: [makeFullClip(input.inputId, state.totalDurationMs, input)],
      }));
      return {
        ...state,
        tracks,
        playheadMs: 0,
        isPlaying: false,
      };
    }

    case 'MOVE_CLIP': {
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
      };
      const right: Clip = {
        id: genId(),
        inputId: clip.inputId,
        startMs: action.atMs,
        endMs: clip.endMs,
        blockSettings: cloneBlockSettings(clip.blockSettings),
      };

      const newClips = [...track.clips];
      newClips.splice(clipIdx, 1, left, right);

      return {
        ...state,
        tracks: state.tracks.map((t) =>
          t.id === action.trackId ? { ...t, clips: newClips } : t,
        ),
      };
    }

    case 'DELETE_CLIP': {
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
      return {
        ...state,
        tracks: state.tracks.map((t) =>
          t.id === action.trackId ? { ...t, label: action.newLabel } : t,
        ),
      };
    }

    case 'ADD_TRACK': {
      const label = action.label || `Track ${state.tracks.length + 1}`;
      const newTrack: Track = {
        id: genId(),
        label,
        clips: [],
      };
      return {
        ...state,
        tracks: [...state.tracks, newTrack],
      };
    }

    case 'DELETE_TRACK': {
      return {
        ...state,
        tracks: state.tracks.filter((t) => t.id !== action.trackId),
      };
    }

    case 'REPLACE_INPUT_ID': {
      const tracks = state.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) =>
          clip.inputId === action.oldInputId
            ? { ...clip, inputId: action.newInputId }
            : clip,
        ),
      }));
      return { ...state, tracks };
    }

    case 'UPDATE_CLIP_SETTINGS': {
      return {
        ...state,
        tracks: state.tracks.map((track) => {
          if (track.id !== action.trackId) return track;
          return {
            ...track,
            clips: track.clips.map((clip) => {
              if (clip.id !== action.clipId) return clip;
              return {
                ...clip,
                blockSettings: {
                  ...clip.blockSettings,
                  ...action.patch,
                  shaders:
                    action.patch.shaders !== undefined
                      ? action.patch.shaders.map((shader) => ({
                          ...shader,
                          params: (shader.params || []).map((param) => ({
                            ...param,
                          })),
                        }))
                      : clip.blockSettings.shaders,
                  attachedInputIds:
                    action.patch.attachedInputIds !== undefined
                      ? [...action.patch.attachedInputIds]
                      : clip.blockSettings.attachedInputIds,
                },
              };
            }),
          };
        }),
      };
    }

    case 'PURGE_INPUT_ID': {
      const newTracks = state.tracks
        .map((track) => ({
          ...track,
          clips: track.clips.filter((c) => c.inputId !== action.inputId),
        }))
        .filter((track) => track.clips.length > 0);
      return { ...state, tracks: newTracks };
    }

    case 'LOAD':
      return action.state;

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
  'RESET',
  'UPDATE_CLIP_SETTINGS',
  'PURGE_INPUT_ID',
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
        initial = {
          tracks: normalizeTracks(
            ((stored.tracks as Track[]) || []) as Track[],
            inputs,
            totalDurationMs,
          ),
          totalDurationMs,
          playheadMs: 0,
          isPlaying: false,
          pixelsPerSecond: stored.pixelsPerSecond || DEFAULT_PPS,
        };
      }
    } else {
      initial = createInitialState();
    }
    initial.tracks = normalizeTracks(
      initial.tracks,
      inputs,
      initial.totalDurationMs,
    );
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
    if (inputs.length === 0) return;
    dispatch({ type: 'SYNC_TRACKS', inputs });
    initializedRef.current = true;
  }, [inputs]);

  // Persist to localStorage on meaningful changes (debounced)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!initializedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const { tracks, totalDurationMs, playheadMs, pixelsPerSecond } = state;
      saveTimeline(roomId, {
        tracks,
        totalDurationMs,
        playheadMs,
        pixelsPerSecond,
      });
    }, 500);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [roomId, state]);

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

  const replaceInputId = useCallback(
    (oldInputId: string, newInputId: string) => {
      dispatch({ type: 'REPLACE_INPUT_ID', oldInputId, newInputId });
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

  const purgeInputId = useCallback((inputId: string) => {
    dispatch({ type: 'PURGE_INPUT_ID', inputId });
    setStructureRevision((rev) => rev + 1);
  }, []);

  const undo = useCallback(() => dispatch({ type: 'UNDO' }), []);
  const redo = useCallback(() => dispatch({ type: 'REDO' }), []);
  const canUndo = undoable.past.length > 0;
  const canRedo = undoable.future.length > 0;

  return {
    state,
    dispatch,
    setPlayhead,
    setPlaying,
    setZoom,
    setTotalDuration,
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
    replaceInputId,
    updateClipSettings,
    purgeInputId,
    undo,
    redo,
    canUndo,
    canRedo,
    structureRevision,
  };
}
