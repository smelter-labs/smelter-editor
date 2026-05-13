'use client';

import { useCallback, useEffect, useMemo } from 'react';
import type { TimelineState, Track, TrackGroup, Clip, Keyframe } from '../../hooks/use-timeline-state';
import { OUTPUT_TRACK_ID, OUTPUT_CLIP_ID } from '../../hooks/use-timeline-state';
import {
  SNAP_THRESHOLD_PX,
  TRACK_HEIGHT,
  AUTOMATION_LANE_HEIGHT,
  RESIZE_HANDLE_PX,
  hasOverlapOnTrack,
  computeKeyframeSnapTargets,
  snapToNearest,
  clampKeyframeTimeMs,
  resolveKeyframeCollision,
} from './timeline-utils';

// ── Visible rows: rootOrder expanded with group children (collapse-aware) ─
export type VisibleRow =
  | {
      kind: 'track';
      track: Track;
      groupId?: string;
      /** Drop target for inserting BEFORE this row. */
      dropTarget:
        | { kind: 'root'; index: number }
        | { kind: 'group'; groupId: string; index: number };
      indent: boolean;
    }
  | {
      kind: 'group';
      group: TrackGroup;
      rootIndex: number;
      dropTarget: { kind: 'root'; index: number };
    };

type DragRef = React.MutableRefObject<{
  type:
    | 'move'
    | 'resize-left'
    | 'resize-right'
    | 'resize-transition-in'
    | 'resize-transition-out';
  trackId: string;
  clipId: string;
  originX: number;
  originY: number;
  originStartMs: number;
  originEndMs: number;
  originTransitionMs?: number;
  multiClips?: {
    trackId: string;
    clipId: string;
    originStartMs: number;
    originEndMs: number;
  }[];
} | null>;

type KeyframeDragRef = React.MutableRefObject<{
  trackId: string;
  clipId: string;
  keyframeId: string;
  originX: number;
  originTimeMs: number;
} | null>;

type TrackDragRef = React.MutableRefObject<{
  trackId: string;
  originY: number;
  currentIndex: number;
} | null>;

type GroupDragRef = React.MutableRefObject<{
  groupId: string;
  originY: number;
  currentIndex: number;
} | null>;

type Params = {
  state: TimelineState;
  selectedClipIds: { trackId: string; clipId: string }[];
  selectedClipIdSet: Set<string>;
  selectClip: (trackId: string, clipId: string, mode: 'replace' | 'toggle' | 'range') => void;
  setSelectedClipIds: (
    updater:
      | { trackId: string; clipId: string }[]
      | ((
          prev: { trackId: string; clipId: string }[],
        ) => { trackId: string; clipId: string }[]),
  ) => void;
  setSelectedKeyframeId: (id: string | null) => void;
  lastClickedClipRef: React.MutableRefObject<{ trackId: string; clipId: string } | null>;
  automationVisibleTracks: Set<string>;
  setInvalidDropTrackId: (id: string | null) => void;
  setTrackDropIndex: (idx: number | null) => void;
  dragRef: DragRef;
  keyframeDragRef: KeyframeDragRef;
  trackDragRef: TrackDragRef;
  groupDragRef: GroupDragRef;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  splitClip: (trackId: string, clipId: string, atMs: number) => void;
  moveClip: (trackId: string, clipId: string, newStartMs: number) => void;
  moveClips: (moves: { trackId: string; clipId: string; newStartMs: number }[]) => void;
  resizeClip: (trackId: string, clipId: string, edge: 'left' | 'right', newMs: number) => void;
  moveClipToTrack: (fromTrackId: string, clipId: string, toTrackId: string, newStartMs: number) => void;
  updateClipSettings: (trackId: string, clipId: string, patch: Record<string, unknown>) => void;
  moveKeyframe: (trackId: string, clipId: string, keyframeId: string, timeMs: number) => void;
  moveTrackTo: (trackId: string, dropTarget: { kind: 'root'; index: number } | { kind: 'group'; groupId: string; index: number }) => void;
  moveGroup: (groupId: string, rootIndex: number) => void;
};

export type TimelineInteractionResult = {
  pxToMs: (px: number) => number;
  snapThresholdMs: number;
  visibleRows: VisibleRow[];
  getRowIndexAtY: (relativeY: number) => number;
  getTrackIndexAtY: (relativeY: number) => number;
  getTrackIdAtY: (clientY: number) => string | null;
  handleClipPointerDown: (
    e: React.PointerEvent<HTMLDivElement>,
    trackId: string,
    clipId: string,
    clipStartMs: number,
    clipEndMs: number,
    introTransitionMs: number,
    outroTransitionMs: number,
  ) => void;
  handleKeyframePointerDown: (
    e: React.PointerEvent<HTMLButtonElement>,
    trackId: string,
    clip: Clip,
    keyframe: Keyframe,
  ) => void;
  handleClipHover: (
    e: React.PointerEvent<HTMLDivElement>,
    introTransitionMs: number,
    outroTransitionMs: number,
  ) => void;
};

export function useTimelineInteraction({
  state,
  selectedClipIds,
  selectedClipIdSet,
  selectClip,
  setSelectedClipIds,
  setSelectedKeyframeId,
  lastClickedClipRef,
  automationVisibleTracks,
  setInvalidDropTrackId,
  setTrackDropIndex,
  dragRef,
  keyframeDragRef,
  trackDragRef,
  groupDragRef,
  scrollContainerRef,
  splitClip,
  moveClip,
  moveClips,
  resizeClip,
  moveClipToTrack,
  updateClipSettings,
  moveKeyframe,
  moveTrackTo,
  moveGroup,
}: Params): TimelineInteractionResult {
  const pxToMs = useCallback(
    (px: number) => (px / state.pixelsPerSecond) * 1000,
    [state.pixelsPerSecond],
  );

  const snapThresholdMs = useMemo(() => pxToMs(SNAP_THRESHOLD_PX), [pxToMs]);

  const visibleRows = useMemo<VisibleRow[]>(() => {
    const trackById = new Map(state.tracks.map((t) => [t.id, t]));
    const groupById = new Map(state.groups.map((g) => [g.id, g]));
    const out: VisibleRow[] = [];
    state.rootOrder.forEach((ref, rootIndex) => {
      if (ref.kind === 'track') {
        const t = trackById.get(ref.id);
        if (!t) return;
        out.push({
          kind: 'track',
          track: t,
          dropTarget: { kind: 'root', index: rootIndex },
          indent: false,
        });
      } else {
        const g = groupById.get(ref.id);
        if (!g) return;
        out.push({
          kind: 'group',
          group: g,
          rootIndex,
          dropTarget: { kind: 'root', index: rootIndex },
        });
        if (!g.collapsed) {
          g.trackIds.forEach((tid, childIdx) => {
            const t = trackById.get(tid);
            if (!t) return;
            out.push({
              kind: 'track',
              track: t,
              groupId: g.id,
              dropTarget: { kind: 'group', groupId: g.id, index: childIdx },
              indent: true,
            });
          });
        }
      }
    });
    return out;
  }, [state.rootOrder, state.tracks, state.groups]);

  // ── Determine which row the pointer is over ────
  const getRowIndexAtY = useCallback(
    (relativeY: number): number => {
      let accumulated = 0;
      for (let i = 0; i < visibleRows.length; i++) {
        const row = visibleRows[i];
        const isTrack = row.kind === 'track';
        const h = isTrack
          ? TRACK_HEIGHT +
            (automationVisibleTracks.has(row.track.id)
              ? AUTOMATION_LANE_HEIGHT
              : 0)
          : TRACK_HEIGHT;
        if (relativeY < accumulated + h) return i;
        accumulated += h;
      }
      return Math.max(0, visibleRows.length - 1);
    },
    [visibleRows, automationVisibleTracks],
  );

  /** Legacy alias used by clip drag helpers. Returns visible-row index, but
   *  callers that needed a track-only index get translated via getTrackIdAtY. */
  const getTrackIndexAtY = getRowIndexAtY;

  const getTrackIdAtY = useCallback(
    (clientY: number): string | null => {
      const container = scrollContainerRef.current;
      if (!container) return null;
      const containerRect = container.getBoundingClientRect();
      const scrollTop = container.scrollTop;
      const relativeY = clientY - containerRect.top + scrollTop;
      const idx = getRowIndexAtY(relativeY);
      const row = visibleRows[idx];
      if (row && row.kind === 'track') return row.track.id;
      return null;
    },
    [visibleRows, getRowIndexAtY],
  );

  const handleClipPointerDown = useCallback(
    (
      e: React.PointerEvent<HTMLDivElement>,
      trackId: string,
      clipId: string,
      clipStartMs: number,
      clipEndMs: number,
      introTransitionMs: number,
      outroTransitionMs: number,
    ) => {
      const isOutputClip = clipId === OUTPUT_CLIP_ID;

      // Alt+Click = split (not for output clip)
      if (e.altKey && !isOutputClip) {
        const rect = e.currentTarget.parentElement!.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const atMs = Math.round(pxToMs(x));
        splitClip(trackId, clipId, atMs);
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;

      if (ctrl) {
        selectClip(trackId, clipId, 'toggle');
      } else if (shift) {
        selectClip(trackId, clipId, 'range');
      } else {
        // Normal click: if clip is already part of multi-selection, keep
        // the selection so that dragging moves all of them.
        const alreadySelected = selectedClipIdSet.has(clipId);
        if (!alreadySelected || selectedClipIds.length <= 1) {
          selectClip(trackId, clipId, 'replace');
        }
      }

      // Output clip: allow selection but no move/resize/split
      if (isOutputClip) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const clipWidthPx = rect.width;

      const introHandlePx = (introTransitionMs / 1000) * state.pixelsPerSecond;
      const outroHandlePx = (outroTransitionMs / 1000) * state.pixelsPerSecond;
      const TRANSITION_HANDLE_ZONE = 6;

      let type:
        | 'move'
        | 'resize-left'
        | 'resize-right'
        | 'resize-transition-in'
        | 'resize-transition-out' = 'move';
      let originTransitionMs: number | undefined;

      if (
        introTransitionMs > 0 &&
        Math.abs(localX - introHandlePx) <= TRANSITION_HANDLE_ZONE
      ) {
        type = 'resize-transition-in';
        originTransitionMs = introTransitionMs;
      } else if (
        outroTransitionMs > 0 &&
        Math.abs(localX - (clipWidthPx - outroHandlePx)) <=
          TRANSITION_HANDLE_ZONE
      ) {
        type = 'resize-transition-out';
        originTransitionMs = outroTransitionMs;
      } else if (localX <= RESIZE_HANDLE_PX) {
        type = 'resize-left';
      } else if (localX >= clipWidthPx - RESIZE_HANDLE_PX) {
        type = 'resize-right';
      }

      // Build multi-clip origins when moving a multi-selection
      let multiClips:
        | {
            trackId: string;
            clipId: string;
            originStartMs: number;
            originEndMs: number;
          }[]
        | undefined;

      if (
        type === 'move' &&
        selectedClipIdSet.has(clipId) &&
        selectedClipIds.length > 1
      ) {
        multiClips = [];
        for (const sel of selectedClipIds) {
          const t = state.tracks.find((tr) => tr.id === sel.trackId);
          const c = t?.clips.find((cl) => cl.id === sel.clipId);
          if (t && c) {
            multiClips.push({
              trackId: sel.trackId,
              clipId: sel.clipId,
              originStartMs: c.startMs,
              originEndMs: c.endMs,
            });
          }
        }
      }

      dragRef.current = {
        type,
        trackId,
        clipId,
        originX: e.clientX,
        originY: e.clientY,
        originStartMs: clipStartMs,
        originEndMs: clipEndMs,
        originTransitionMs,
        multiClips,
      };

      document.body.style.userSelect = 'none';
    },
    [
      pxToMs,
      splitClip,
      state.pixelsPerSecond,
      state.tracks,
      selectClip,
      selectedClipIdSet,
      selectedClipIds,
    ],
  );

  const handleKeyframePointerDown = useCallback(
    (
      e: React.PointerEvent<HTMLButtonElement>,
      trackId: string,
      clip: Clip,
      keyframe: Keyframe,
    ) => {
      e.preventDefault();
      e.stopPropagation();

      setSelectedClipIds([{ trackId, clipId: clip.id }]);
      setSelectedKeyframeId(keyframe.id);
      lastClickedClipRef.current = { trackId, clipId: clip.id };

      if (keyframe.timeMs === 0) {
        return;
      }

      keyframeDragRef.current = {
        trackId,
        clipId: clip.id,
        keyframeId: keyframe.id,
        originX: e.clientX,
        originTimeMs: keyframe.timeMs,
      };

      document.body.style.userSelect = 'none';
    },
    [],
  );

  // Use document-level listeners for drag so we can detect cross-track movement
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      // ── Track reorder drag ──
      const trackDrag = trackDragRef.current;
      if (trackDrag) {
        const container = scrollContainerRef.current;
        if (!container) return;
        const containerRect = container.getBoundingClientRect();
        const scrollTop = container.scrollTop;
        const relativeY = e.clientY - containerRect.top + scrollTop;
        let targetIndex = getRowIndexAtY(relativeY);
        targetIndex = Math.max(
          0,
          Math.min(targetIndex, Math.max(0, visibleRows.length - 1)),
        );
        const targetRow = visibleRows[targetIndex];
        if (
          targetRow &&
          targetRow.kind === 'track' &&
          targetRow.track.id === OUTPUT_TRACK_ID
        ) {
          return;
        }
        setTrackDropIndex(targetIndex);
        if (targetIndex !== trackDrag.currentIndex && targetRow) {
          moveTrackTo(trackDrag.trackId, targetRow.dropTarget);
          trackDrag.currentIndex = targetIndex;
        }
        return;
      }

      // ── Group reorder drag ──
      const groupDrag = groupDragRef.current;
      if (groupDrag) {
        const container = scrollContainerRef.current;
        if (!container) return;
        const containerRect = container.getBoundingClientRect();
        const scrollTop = container.scrollTop;
        const relativeY = e.clientY - containerRect.top + scrollTop;
        let targetIndex = getRowIndexAtY(relativeY);
        targetIndex = Math.max(
          0,
          Math.min(targetIndex, Math.max(0, visibleRows.length - 1)),
        );
        const targetRow = visibleRows[targetIndex];
        if (!targetRow) return;
        // Groups can only be dropped at root positions. Use the row's root
        // index (groups themselves carry rootIndex; child track rows carry
        // their parent group's rootIndex via dropTarget=group).
        let rootIndex: number;
        if (targetRow.kind === 'group') {
          rootIndex = targetRow.rootIndex;
        } else {
          const dt = targetRow.dropTarget;
          if (dt.kind === 'root') {
            rootIndex = dt.index;
          } else {
            // hovering inside a group's children — clamp to that group's root pos
            const ownerGroupId = dt.groupId;
            const ownerIdx = state.rootOrder.findIndex(
              (r) => r.kind === 'group' && r.id === ownerGroupId,
            );
            rootIndex = ownerIdx >= 0 ? ownerIdx : state.rootOrder.length - 1;
          }
        }
        setTrackDropIndex(targetIndex);
        if (targetIndex !== groupDrag.currentIndex) {
          moveGroup(groupDrag.groupId, rootIndex);
          groupDrag.currentIndex = targetIndex;
        }
        return;
      }

      const keyframeDrag = keyframeDragRef.current;
      if (keyframeDrag) {
        const deltaMs = pxToMs(e.clientX - keyframeDrag.originX);
        const track = state.tracks.find(
          (item) => item.id === keyframeDrag.trackId,
        );
        const clip = track?.clips.find(
          (item) => item.id === keyframeDrag.clipId,
        );
        if (!clip) {
          return;
        }

        const clipDurationMs = clip.endMs - clip.startMs;
        const occupiedTimes = new Set(
          clip.keyframes
            .filter((keyframe) => keyframe.id !== keyframeDrag.keyframeId)
            .map((keyframe) => keyframe.timeMs),
        );
        let nextTimeMs = Math.round(keyframeDrag.originTimeMs + deltaMs);
        nextTimeMs = clampKeyframeTimeMs(nextTimeMs, clipDurationMs);
        if (state.snapToKeyframes) {
          nextTimeMs = snapToNearest(
            nextTimeMs,
            computeKeyframeSnapTargets(clip, keyframeDrag.keyframeId),
            snapThresholdMs,
          );
        }
        nextTimeMs = clampKeyframeTimeMs(nextTimeMs, clipDurationMs);
        nextTimeMs = resolveKeyframeCollision(
          nextTimeMs,
          occupiedTimes,
          clipDurationMs,
          deltaMs,
        );

        moveKeyframe(
          keyframeDrag.trackId,
          keyframeDrag.clipId,
          keyframeDrag.keyframeId,
          nextTimeMs,
        );
        return;
      }

      const drag = dragRef.current;
      if (!drag) return;

      const deltaX = e.clientX - drag.originX;
      const deltaMs = pxToMs(deltaX);

      // Collect clip IDs being dragged to exclude from snap targets
      const draggedClipIds = new Set<string>();
      draggedClipIds.add(drag.clipId);
      if (drag.multiClips) {
        for (const mc of drag.multiClips) draggedClipIds.add(mc.clipId);
      }

      const snapTargets: number[] = [0, state.playheadMs];
      for (const track of state.tracks) {
        for (const clip of track.clips) {
          if (draggedClipIds.has(clip.id)) continue;
          snapTargets.push(clip.startMs, clip.endMs);
        }
      }

      if (drag.type === 'move') {
        const shiftLock = e.shiftKey;

        if (drag.multiClips && drag.multiClips.length > 1) {
          // Multi-clip move: compute delta via primary clip snap, apply to all
          let newStart = shiftLock
            ? drag.originStartMs
            : Math.round(drag.originStartMs + deltaMs);
          if (!shiftLock && state.snapToBlocks) {
            newStart = snapToNearest(newStart, snapTargets, snapThresholdMs);
          }
          const duration = drag.originEndMs - drag.originStartMs;
          if (!shiftLock && state.snapToBlocks) {
            const snappedEnd = snapToNearest(
              newStart + duration,
              snapTargets,
              snapThresholdMs,
            );
            if (snappedEnd !== newStart + duration) {
              newStart = snappedEnd - duration;
            }
          }
          const appliedDelta = newStart - drag.originStartMs;

          const moves = drag.multiClips.map((mc) => ({
            trackId: mc.trackId,
            clipId: mc.clipId,
            newStartMs: Math.max(
              0,
              Math.round(mc.originStartMs + appliedDelta),
            ),
          }));
          moveClips(moves);
        } else {
          // Single-clip move (with cross-track support)
          let newStart = shiftLock
            ? drag.originStartMs
            : Math.round(drag.originStartMs + deltaMs);
          if (!shiftLock && state.snapToBlocks) {
            newStart = snapToNearest(newStart, snapTargets, snapThresholdMs);
          }
          const duration = drag.originEndMs - drag.originStartMs;
          if (!shiftLock && state.snapToBlocks) {
            const snappedEnd = snapToNearest(
              newStart + duration,
              snapTargets,
              snapThresholdMs,
            );
            if (snappedEnd !== newStart + duration) {
              newStart = snappedEnd - duration;
            }
          }

          const targetTrackId = getTrackIdAtY(e.clientY);
          if (targetTrackId && targetTrackId !== drag.trackId) {
            const targetTrack = state.tracks.find(
              (t) => t.id === targetTrackId,
            );
            if (
              targetTrack &&
              hasOverlapOnTrack(
                targetTrack.clips,
                drag.clipId,
                newStart,
                newStart + duration,
              )
            ) {
              setInvalidDropTrackId(targetTrackId);
              moveClip(drag.trackId, drag.clipId, newStart);
            } else {
              setInvalidDropTrackId(null);
              moveClipToTrack(
                drag.trackId,
                drag.clipId,
                targetTrackId,
                newStart,
              );
              drag.trackId = targetTrackId;
            }
          } else {
            setInvalidDropTrackId(null);
            moveClip(drag.trackId, drag.clipId, newStart);
          }
        }
      } else if (drag.type === 'resize-left') {
        let newStart = Math.round(drag.originStartMs + deltaMs);
        if (state.snapToBlocks) {
          newStart = snapToNearest(newStart, snapTargets, snapThresholdMs);
        }
        resizeClip(drag.trackId, drag.clipId, 'left', newStart);
      } else if (
        drag.type === 'resize-transition-in' ||
        drag.type === 'resize-transition-out'
      ) {
        const track = state.tracks.find((t) => t.id === drag.trackId);
        const clip = track?.clips.find((c) => c.id === drag.clipId);
        if (clip) {
          const clipDuration = clip.endMs - clip.startMs;
          const originMs = drag.originTransitionMs ?? 0;
          if (drag.type === 'resize-transition-in') {
            const otherMs = clip.blockSettings.outroTransition?.durationMs ?? 0;
            const newDurationMs = Math.max(
              0,
              Math.min(originMs + deltaMs, clipDuration - otherMs),
            );
            const introType =
              clip.blockSettings.introTransition?.type ?? 'fade';
            updateClipSettings(drag.trackId, drag.clipId, {
              introTransition:
                newDurationMs > 0
                  ? { type: introType, durationMs: Math.round(newDurationMs) }
                  : undefined,
            });
          } else {
            const otherMs = clip.blockSettings.introTransition?.durationMs ?? 0;
            const newDurationMs = Math.max(
              0,
              Math.min(originMs - deltaMs, clipDuration - otherMs),
            );
            const outroType =
              clip.blockSettings.outroTransition?.type ?? 'fade';
            updateClipSettings(drag.trackId, drag.clipId, {
              outroTransition:
                newDurationMs > 0
                  ? { type: outroType, durationMs: Math.round(newDurationMs) }
                  : undefined,
            });
          }
        }
      } else {
        let newEnd = Math.round(drag.originEndMs + deltaMs);
        if (state.snapToBlocks) {
          newEnd = snapToNearest(newEnd, snapTargets, snapThresholdMs);
        }
        resizeClip(drag.trackId, drag.clipId, 'right', newEnd);
      }
    };

    const handlePointerUp = () => {
      const hadActiveDrag =
        keyframeDragRef.current ||
        dragRef.current ||
        trackDragRef.current ||
        groupDragRef.current;
      keyframeDragRef.current = null;
      dragRef.current = null;
      if (trackDragRef.current) {
        trackDragRef.current = null;
        setTrackDropIndex(null);
      }
      if (groupDragRef.current) {
        groupDragRef.current = null;
        setTrackDropIndex(null);
      }
      if (hadActiveDrag) {
        document.body.style.userSelect = '';
      }
      setInvalidDropTrackId(null);
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };
  }, [
    pxToMs,
    state.tracks,
    state.rootOrder,
    state.playheadMs,
    state.snapToBlocks,
    state.snapToKeyframes,
    snapThresholdMs,
    moveClip,
    moveClips,
    resizeClip,
    moveClipToTrack,
    getTrackIdAtY,
    getRowIndexAtY,
    visibleRows,
    updateClipSettings,
    moveKeyframe,
    moveTrackTo,
    moveGroup,
  ]);

  const handleClipHover = useCallback(
    (
      e: React.PointerEvent<HTMLDivElement>,
      introTransitionMs: number,
      outroTransitionMs: number,
    ) => {
      if (dragRef.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const w = rect.width;

      const introHandlePx = (introTransitionMs / 1000) * state.pixelsPerSecond;
      const outroHandlePx = (outroTransitionMs / 1000) * state.pixelsPerSecond;
      const TRANSITION_HANDLE_ZONE = 6;

      if (
        introTransitionMs > 0 &&
        Math.abs(localX - introHandlePx) <= TRANSITION_HANDLE_ZONE
      ) {
        e.currentTarget.style.cursor = 'ew-resize';
      } else if (
        outroTransitionMs > 0 &&
        Math.abs(localX - (w - outroHandlePx)) <= TRANSITION_HANDLE_ZONE
      ) {
        e.currentTarget.style.cursor = 'ew-resize';
      } else if (localX <= RESIZE_HANDLE_PX || localX >= w - RESIZE_HANDLE_PX) {
        e.currentTarget.style.cursor = 'col-resize';
      } else {
        e.currentTarget.style.cursor = 'grab';
      }
    },
    [state.pixelsPerSecond],
  );

  return {
    pxToMs,
    snapThresholdMs,
    visibleRows,
    getRowIndexAtY,
    getTrackIndexAtY,
    getTrackIdAtY,
    handleClipPointerDown,
    handleKeyframePointerDown,
    handleClipHover,
  };
}
