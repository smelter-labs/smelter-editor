'use client';

import { useReducer, useEffect, useCallback, useRef, useState } from 'react';
import type { Input } from '@/app/actions/actions';
import { loadTimeline, saveTimeline } from '@/lib/timeline-storage';

// ── Types ────────────────────────────────────────────────

export type Segment = {
  id: string;
  startMs: number;
  endMs: number;
};

export type TrackTimeline = {
  inputId: string;
  segments: Segment[];
};

export type OrderKeyframe = {
  id: string;
  timeMs: number;
  inputOrder: string[];
};

export type TimelineState = {
  tracks: Record<string, TrackTimeline>;
  orderKeyframes: OrderKeyframe[];
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
      type: 'MOVE_SEGMENT';
      inputId: string;
      segmentId: string;
      newStartMs: number;
    }
  | {
      type: 'RESIZE_SEGMENT';
      inputId: string;
      segmentId: string;
      edge: 'left' | 'right';
      newMs: number;
    }
  | { type: 'SPLIT_SEGMENT'; inputId: string; segmentId: string; atMs: number }
  | { type: 'DELETE_SEGMENT'; inputId: string; segmentId: string }
  | { type: 'ADD_ORDER_KEYFRAME'; timeMs: number; inputOrder: string[] }
  | { type: 'UPDATE_ORDER_KEYFRAME'; id: string; inputOrder: string[] }
  | { type: 'REMOVE_ORDER_KEYFRAME'; id: string }
  | { type: 'DUPLICATE_SEGMENT'; inputId: string; segmentId: string };

// ── Constants ────────────────────────────────────────────

const DEFAULT_DURATION_MS = 60_000; // 1 minute
const DEFAULT_PPS = 15; // pixels per second (60s × 15 = 900px at default)
const MIN_PPS = 2;
const MAX_PPS = 100;
export const MIN_SEGMENT_MS = 1000;

export { DEFAULT_DURATION_MS, DEFAULT_PPS, MIN_PPS, MAX_PPS };

// ── Helpers ──────────────────────────────────────────────

function genId(): string {
  return crypto.randomUUID();
}

function makeFullSegment(totalDurationMs: number): Segment {
  return { id: genId(), startMs: 0, endMs: totalDurationMs };
}

function createInitialState(): TimelineState {
  return {
    tracks: {},
    orderKeyframes: [],
    totalDurationMs: DEFAULT_DURATION_MS,
    playheadMs: 0,
    isPlaying: false,
    pixelsPerSecond: DEFAULT_PPS,
  };
}

function clampZoom(pps: number): number {
  return Math.min(MAX_PPS, Math.max(MIN_PPS, pps));
}

/** Sort segments by startMs and clamp to [0, totalDurationMs]. Does NOT merge overlaps — segments should not overlap. */
function clampSegments(
  segments: Segment[],
  totalDurationMs: number,
): Segment[] {
  return segments
    .map((s) => ({
      ...s,
      startMs: Math.max(
        0,
        Math.min(s.startMs, totalDurationMs - MIN_SEGMENT_MS),
      ),
      endMs: Math.max(MIN_SEGMENT_MS, Math.min(s.endMs, totalDurationMs)),
    }))
    .filter((s) => s.endMs - s.startMs >= MIN_SEGMENT_MS)
    .sort((a, b) => a.startMs - b.startMs);
}

// ── Reducer ──────────────────────────────────────────────

function timelineReducer(
  state: TimelineState,
  action: TimelineAction,
): TimelineState {
  switch (action.type) {
    case 'SYNC_TRACKS': {
      const newTracks: Record<string, TrackTimeline> = {};
      const currentInputIds = new Set(action.inputs.map((i) => i.inputId));

      // Keep existing tracks for inputs that still exist
      for (const inputId of currentInputIds) {
        if (state.tracks[inputId]) {
          newTracks[inputId] = state.tracks[inputId];
        } else {
          // New input → full-width segment
          newTracks[inputId] = {
            inputId,
            segments: [makeFullSegment(state.totalDurationMs)],
          };
        }
      }
      // Removed inputs are dropped (not in newTracks)

      // Ensure t=0 order keyframe exists
      const orderKeyframes = [...state.orderKeyframes];
      if (orderKeyframes.length === 0 || orderKeyframes[0].timeMs !== 0) {
        orderKeyframes.unshift({
          id: genId(),
          timeMs: 0,
          inputOrder: action.inputs.map((i) => i.inputId),
        });
      }

      return { ...state, tracks: newTracks, orderKeyframes };
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
      const tracks: Record<string, TrackTimeline> = {};
      for (const input of action.inputs) {
        tracks[input.inputId] = {
          inputId: input.inputId,
          segments: [makeFullSegment(state.totalDurationMs)],
        };
      }
      return {
        ...state,
        tracks,
        orderKeyframes: [
          {
            id: genId(),
            timeMs: 0,
            inputOrder: action.inputs.map((i) => i.inputId),
          },
        ],
        playheadMs: 0,
        isPlaying: false,
      };
    }

    case 'MOVE_SEGMENT': {
      const track = state.tracks[action.inputId];
      if (!track) return state;
      const segIdx = track.segments.findIndex((s) => s.id === action.segmentId);
      if (segIdx < 0) return state;
      const seg = track.segments[segIdx];
      const duration = seg.endMs - seg.startMs;
      let newStart = Math.max(
        0,
        Math.min(action.newStartMs, state.totalDurationMs - duration),
      );

      // Prevent overlap with previous segment
      const prev = track.segments[segIdx - 1];
      if (prev && newStart < prev.endMs) {
        newStart = prev.endMs;
      }
      // Prevent overlap with next segment
      const next = track.segments[segIdx + 1];
      if (next && newStart + duration > next.startMs) {
        newStart = next.startMs - duration;
      }

      if (newStart < 0) newStart = 0;

      const newSegments = [...track.segments];
      newSegments[segIdx] = {
        ...seg,
        startMs: newStart,
        endMs: newStart + duration,
      };
      return {
        ...state,
        tracks: {
          ...state.tracks,
          [action.inputId]: {
            ...track,
            segments: clampSegments(newSegments, state.totalDurationMs),
          },
        },
      };
    }

    case 'RESIZE_SEGMENT': {
      const track = state.tracks[action.inputId];
      if (!track) return state;
      const segIdx = track.segments.findIndex((s) => s.id === action.segmentId);
      if (segIdx < 0) return state;
      const seg = track.segments[segIdx];
      const newSegments = [...track.segments];

      if (action.edge === 'left') {
        let newStart = Math.max(0, action.newMs);
        // Don't overlap previous segment
        const prev = track.segments[segIdx - 1];
        if (prev && newStart < prev.endMs) newStart = prev.endMs;
        // Enforce min duration
        if (seg.endMs - newStart < MIN_SEGMENT_MS)
          newStart = seg.endMs - MIN_SEGMENT_MS;
        newSegments[segIdx] = { ...seg, startMs: newStart };
      } else {
        let newEnd = Math.min(state.totalDurationMs, action.newMs);
        // Don't overlap next segment
        const next = track.segments[segIdx + 1];
        if (next && newEnd > next.startMs) newEnd = next.startMs;
        // Enforce min duration
        if (newEnd - seg.startMs < MIN_SEGMENT_MS)
          newEnd = seg.startMs + MIN_SEGMENT_MS;
        newSegments[segIdx] = { ...seg, endMs: newEnd };
      }

      return {
        ...state,
        tracks: {
          ...state.tracks,
          [action.inputId]: {
            ...track,
            segments: clampSegments(newSegments, state.totalDurationMs),
          },
        },
      };
    }

    case 'SPLIT_SEGMENT': {
      const track = state.tracks[action.inputId];
      if (!track) return state;
      const segIdx = track.segments.findIndex((s) => s.id === action.segmentId);
      if (segIdx < 0) return state;
      const seg = track.segments[segIdx];

      // Must have enough room for two MIN_SEGMENT_MS segments
      if (action.atMs - seg.startMs < MIN_SEGMENT_MS) return state;
      if (seg.endMs - action.atMs < MIN_SEGMENT_MS) return state;

      const left: Segment = {
        id: seg.id,
        startMs: seg.startMs,
        endMs: action.atMs,
      };
      const right: Segment = {
        id: genId(),
        startMs: action.atMs,
        endMs: seg.endMs,
      };

      const newSegments = [...track.segments];
      newSegments.splice(segIdx, 1, left, right);

      return {
        ...state,
        tracks: {
          ...state.tracks,
          [action.inputId]: { ...track, segments: newSegments },
        },
      };
    }

    case 'DELETE_SEGMENT': {
      const track = state.tracks[action.inputId];
      if (!track) return state;
      const newSegments = track.segments.filter(
        (s) => s.id !== action.segmentId,
      );
      return {
        ...state,
        tracks: {
          ...state.tracks,
          [action.inputId]: { ...track, segments: newSegments },
        },
      };
    }

    case 'DUPLICATE_SEGMENT': {
      const track = state.tracks[action.inputId];
      if (!track) return state;
      const seg = track.segments.find((s) => s.id === action.segmentId);
      if (!seg) return state;
      const duration = seg.endMs - seg.startMs;
      const newStart = seg.endMs;
      const newEnd = newStart + duration;
      if (newEnd > state.totalDurationMs) return state;
      // Check for overlap with next segment
      const segIdx = track.segments.indexOf(seg);
      const next = track.segments[segIdx + 1];
      if (next && newEnd > next.startMs) return state;
      const duplicate: Segment = {
        id: genId(),
        startMs: newStart,
        endMs: newEnd,
      };
      const newSegments = [...track.segments];
      newSegments.splice(segIdx + 1, 0, duplicate);
      return {
        ...state,
        tracks: {
          ...state.tracks,
          [action.inputId]: { ...track, segments: newSegments },
        },
      };
    }

    case 'ADD_ORDER_KEYFRAME': {
      const EPSILON_MS = 50;
      const existing = state.orderKeyframes.find(
        (kf) => Math.abs(kf.timeMs - action.timeMs) <= EPSILON_MS,
      );
      if (existing) {
        return {
          ...state,
          orderKeyframes: state.orderKeyframes
            .map((kf) =>
              kf.id === existing.id
                ? { ...kf, inputOrder: action.inputOrder }
                : kf,
            )
            .sort((a, b) => a.timeMs - b.timeMs),
        };
      }
      return {
        ...state,
        orderKeyframes: [
          ...state.orderKeyframes,
          {
            id: genId(),
            timeMs: action.timeMs,
            inputOrder: action.inputOrder,
          },
        ].sort((a, b) => a.timeMs - b.timeMs),
      };
    }

    case 'UPDATE_ORDER_KEYFRAME': {
      return {
        ...state,
        orderKeyframes: state.orderKeyframes.map((kf) =>
          kf.id === action.id ? { ...kf, inputOrder: action.inputOrder } : kf,
        ),
      };
    }

    case 'REMOVE_ORDER_KEYFRAME': {
      const kf = state.orderKeyframes.find((k) => k.id === action.id);
      if (!kf || kf.timeMs === 0) return state;
      return {
        ...state,
        orderKeyframes: state.orderKeyframes.filter((k) => k.id !== action.id),
      };
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
  'MOVE_SEGMENT',
  'RESIZE_SEGMENT',
  'SPLIT_SEGMENT',
  'DELETE_SEGMENT',
  'DUPLICATE_SEGMENT',
  'ADD_ORDER_KEYFRAME',
  'UPDATE_ORDER_KEYFRAME',
  'REMOVE_ORDER_KEYFRAME',
  'RESET',
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
    const initial: TimelineState =
      stored != null
        ? {
            tracks: stored.tracks,
            orderKeyframes: stored.orderKeyframes,
            totalDurationMs: stored.totalDurationMs,
            playheadMs: 0,
            isPlaying: false,
            pixelsPerSecond: stored.pixelsPerSecond,
          }
        : createInitialState();
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
      const { tracks, orderKeyframes, totalDurationMs, playheadMs, pixelsPerSecond } =
        state;
      saveTimeline(roomId, {
        tracks,
        orderKeyframes,
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

  const reset = useCallback(
    () => {
      dispatch({ type: 'RESET', inputs });
      setStructureRevision((rev) => rev + 1);
    },
    [inputs],
  );

  const moveSegment = useCallback(
    (inputId: string, segmentId: string, newStartMs: number) => {
      dispatch({ type: 'MOVE_SEGMENT', inputId, segmentId, newStartMs });
      setStructureRevision((rev) => rev + 1);
    },
    [],
  );

  const resizeSegment = useCallback(
    (
      inputId: string,
      segmentId: string,
      edge: 'left' | 'right',
      newMs: number,
    ) => {
      dispatch({ type: 'RESIZE_SEGMENT', inputId, segmentId, edge, newMs });
      setStructureRevision((rev) => rev + 1);
    },
    [],
  );

  const splitSegment = useCallback(
    (inputId: string, segmentId: string, atMs: number) => {
      dispatch({ type: 'SPLIT_SEGMENT', inputId, segmentId, atMs });
      setStructureRevision((rev) => rev + 1);
    },
    [],
  );

  const deleteSegment = useCallback(
    (inputId: string, segmentId: string) => {
      dispatch({ type: 'DELETE_SEGMENT', inputId, segmentId });
      setStructureRevision((rev) => rev + 1);
    },
    [],
  );

  const duplicateSegment = useCallback(
    (inputId: string, segmentId: string) => {
      dispatch({ type: 'DUPLICATE_SEGMENT', inputId, segmentId });
      setStructureRevision((rev) => rev + 1);
    },
    [],
  );

  const addOrderKeyframe = useCallback(
    (timeMs: number, inputOrder: string[]) => {
      dispatch({ type: 'ADD_ORDER_KEYFRAME', timeMs, inputOrder });
      setStructureRevision((rev) => rev + 1);
    },
    [],
  );

  const updateOrderKeyframe = useCallback(
    (id: string, inputOrder: string[]) => {
      dispatch({ type: 'UPDATE_ORDER_KEYFRAME', id, inputOrder });
      setStructureRevision((rev) => rev + 1);
    },
    [],
  );

  const removeOrderKeyframe = useCallback(
    (id: string) => {
      dispatch({ type: 'REMOVE_ORDER_KEYFRAME', id });
      setStructureRevision((rev) => rev + 1);
    },
    [],
  );

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
    moveSegment,
    resizeSegment,
    splitSegment,
    deleteSegment,
    duplicateSegment,
    addOrderKeyframe,
    updateOrderKeyframe,
    removeOrderKeyframe,
    undo,
    redo,
    canUndo,
    canRedo,
    structureRevision,
  };
}
