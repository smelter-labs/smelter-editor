'use client';

import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { TimelineState } from '../../hooks/use-timeline-state';
import {
  DEFAULT_HEIGHT,
  MIN_HEIGHT,
  MAX_HEIGHT_VH,
  SOURCES_WIDTH,
  MIN_SOURCES_WIDTH,
  MAX_SOURCES_WIDTH,
  SNAP_THRESHOLD_PX,
  computeRulerTicks,
  snapToNearest,
  getContentExtentMs,
} from './timeline-utils';

type Params = {
  state: TimelineState;
  setPlayhead: (ms: number) => void;
  setZoom: (pps: number) => void;
  pause: () => Promise<void>;
  applyAtPlayhead: () => Promise<void>;
  sortMode: 'timeline' | 'layers';
};

export type ContextMenuState = {
  x: number;
  y: number;
  trackId: string;
  inputId: string;
  isMuted: boolean;
  clipId?: string;
  splitAtMs?: number;
} | null;

export type RulerTick = { timeMs: number; label: string };

export type TimelineLayoutResult = {
  panelHeight: number;
  setPanelHeight: (h: number) => void;
  sourcesWidth: number;
  setSourcesWidth: (w: number) => void;
  handleResizeStart: (e: ReactMouseEvent) => void;
  handleSourcesResizeStart: (e: ReactMouseEvent) => void;
  contextMenu: ContextMenuState;
  setContextMenu: (menu: ContextMenuState) => void;
  showHelp: boolean;
  setShowHelp: (v: boolean | ((prev: boolean) => boolean)) => void;
  editingTrackId: string | null;
  setEditingTrackId: (id: string | null) => void;
  editingTrackLabel: string;
  setEditingTrackLabel: (label: string) => void;
  invalidDropTrackId: string | null;
  setInvalidDropTrackId: (id: string | null) => void;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  rulerRef: React.RefObject<HTMLDivElement | null>;
  contextMenuRef: React.RefObject<HTMLDivElement | null>;
  colorSubmenuOpen: boolean;
  setColorSubmenuOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  longPressColor: string | null;
  setLongPressColor: (c: string | null) => void;
  colorSubmenuCloseTimer: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null>;
  timelineWidthPx: number;
  playheadPx: number;
  rulerTicks: RulerTick[];
  zoomAnimating: boolean;
  ZOOM_TRANSITION_MS: number;
  zoomTransitionStyle: string;
  handleRulerPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  handleRulerPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  handleRulerPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  animateZoom: (pps: number) => void;
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  scrollToPlayhead: () => void;
  findClipAtPlayhead: (trackId: string) => string | null;
  jumpToEdge: (direction: 'prev' | 'next') => void;
  trackDropIndex: number | null;
  setTrackDropIndex: (idx: number | null) => void;
  trackDragRef: React.MutableRefObject<{
    trackId: string;
    originY: number;
    currentIndex: number;
  } | null>;
  groupDragRef: React.MutableRefObject<{
    groupId: string;
    originY: number;
    currentIndex: number;
  } | null>;
  dragRef: React.MutableRefObject<{
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
  keyframeDragRef: React.MutableRefObject<{
    trackId: string;
    clipId: string;
    keyframeId: string;
    originX: number;
    originTimeMs: number;
  } | null>;
};

export function useTimelineLayout({
  state,
  setPlayhead,
  setZoom,
  pause,
  applyAtPlayhead,
  sortMode,
}: Params): TimelineLayoutResult {
  const [panelHeight, setPanelHeight] = useState(DEFAULT_HEIGHT);
  const resizingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const [sourcesWidth, setSourcesWidth] = useState(SOURCES_WIDTH);
  const sourcesResizingRef = useRef(false);
  const sourcesStartXRef = useRef(0);
  const sourcesStartWidthRef = useRef(0);

  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [colorSubmenuOpen, setColorSubmenuOpen] = useState(false);
  const [longPressColor, setLongPressColor] = useState<string | null>(null);
  const colorSubmenuCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const [showHelp, setShowHelp] = useState(false);
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [editingTrackLabel, setEditingTrackLabel] = useState('');
  const [invalidDropTrackId, setInvalidDropTrackId] = useState<string | null>(
    null,
  );
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // ── Clip interaction refs ─────────────────────────
  const dragRef = useRef<{
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
  } | null>(null);
  const keyframeDragRef = useRef<{
    trackId: string;
    clipId: string;
    keyframeId: string;
    originX: number;
    originTimeMs: number;
  } | null>(null);
  const trackDragRef = useRef<{
    trackId: string;
    originY: number;
    currentIndex: number;
  } | null>(null);
  const groupDragRef = useRef<{
    groupId: string;
    originY: number;
    currentIndex: number;
  } | null>(null);
  const [trackDropIndex, setTrackDropIndex] = useState<number | null>(null);

  // ── Sync ruler scroll with tracks scroll ──────────────
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      if (rulerRef.current) {
        rulerRef.current.scrollLeft = el.scrollLeft;
      }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // ── Auto-fit zoom so all clips are visible at max zoom ──
  const autoFitRef = useRef(false);
  useEffect(() => {
    if (autoFitRef.current) return;
    if (state.tracks.length === 0) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    const rafId = requestAnimationFrame(() => {
      if (autoFitRef.current) return;
      const availableWidth = el.clientWidth - sourcesWidth;
      if (availableWidth <= 0) return;
      const extentMs = getContentExtentMs(state.tracks);
      const extentSec =
        (extentMs > 0 ? extentMs : state.totalDurationMs) / 1000;
      if (extentSec <= 0) return;
      const padding = 40;
      const idealPps = Math.max(1, availableWidth - padding) / extentSec;
      setZoom(idealPps);
      autoFitRef.current = true;
    });
    return () => cancelAnimationFrame(rafId);
  }, [state.tracks, state.totalDurationMs, setZoom, sourcesWidth]);

  // ── Timeline dimensions ──────────────────────────────

  const timelineWidthPx = useMemo(
    () => (state.totalDurationMs / 1000) * state.pixelsPerSecond,
    [state.totalDurationMs, state.pixelsPerSecond],
  );

  const playheadPx = useMemo(
    () => (state.playheadMs / 1000) * state.pixelsPerSecond,
    [state.playheadMs, state.pixelsPerSecond],
  );

  const rulerTicks = useMemo(
    () => computeRulerTicks(state.totalDurationMs, state.pixelsPerSecond),
    [state.totalDurationMs, state.pixelsPerSecond],
  );

  // ── Panel resize ─────────────────────────────────────

  const handleResizeStart = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      resizingRef.current = true;
      startYRef.current = e.clientY;
      startHeightRef.current = panelHeight;

      const handleMouseMove = (e: globalThis.MouseEvent) => {
        if (!resizingRef.current) return;
        const delta = startYRef.current - e.clientY;
        const maxHeight = window.innerHeight * MAX_HEIGHT_VH;
        const newHeight = Math.min(
          maxHeight,
          Math.max(MIN_HEIGHT, startHeightRef.current + delta),
        );
        setPanelHeight(newHeight);
      };

      const handleMouseUp = () => {
        resizingRef.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [panelHeight],
  );

  // ── Sources column resize ────────────────────────────

  const handleSourcesResizeStart = useCallback(
    (e: ReactMouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      sourcesResizingRef.current = true;
      sourcesStartXRef.current = e.clientX;
      sourcesStartWidthRef.current = sourcesWidth;

      const handleMouseMove = (ev: globalThis.MouseEvent) => {
        if (!sourcesResizingRef.current) return;
        const delta = ev.clientX - sourcesStartXRef.current;
        const newWidth = Math.min(
          MAX_SOURCES_WIDTH,
          Math.max(MIN_SOURCES_WIDTH, sourcesStartWidthRef.current + delta),
        );
        setSourcesWidth(newWidth);
      };

      const handleMouseUp = () => {
        sourcesResizingRef.current = false;
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [sourcesWidth],
  );

  // ── Ruler scrub (pointer drag to move playhead) ───────

  const rulerScrubRef = useRef(false);

  const rulerPxToMs = useCallback(
    (clientX: number, target: HTMLElement) => {
      const rect = target.getBoundingClientRect();
      const x = clientX - rect.left + target.scrollLeft;
      return Math.round((x / state.pixelsPerSecond) * 1000);
    },
    [state.pixelsPerSecond],
  );

  const getPlayheadSnapTargets = useCallback((): number[] => {
    const targets = new Set<number>([0, state.totalDurationMs]);
    for (const track of state.tracks) {
      for (const clip of track.clips) {
        if (state.snapToBlocks) {
          targets.add(clip.startMs);
          targets.add(clip.endMs);
        }
        if (state.snapToKeyframes) {
          for (const keyframe of clip.keyframes) {
            targets.add(clip.startMs + keyframe.timeMs);
          }
        }
      }
    }
    return [...targets];
  }, [
    state.totalDurationMs,
    state.tracks,
    state.snapToBlocks,
    state.snapToKeyframes,
  ]);

  const resolvePlayheadMs = useCallback(
    (rawMs: number, shiftKey: boolean) => {
      const clampedMs = Math.max(0, Math.min(rawMs, state.totalDurationMs));
      if (!shiftKey) {
        return clampedMs;
      }
      const targets = getPlayheadSnapTargets();
      if (targets.length === 0) {
        return clampedMs;
      }
      const thresholdMs = Math.round(
        (SNAP_THRESHOLD_PX / state.pixelsPerSecond) * 1000,
      );
      return snapToNearest(clampedMs, targets, thresholdMs);
    },
    [state.totalDurationMs, state.pixelsPerSecond, getPlayheadSnapTargets],
  );

  const handleRulerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (sortMode === 'layers') return;
      e.preventDefault();
      rulerScrubRef.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      document.body.style.userSelect = 'none';
      const ms = resolvePlayheadMs(
        rulerPxToMs(e.clientX, e.currentTarget),
        e.shiftKey,
      );
      if (state.isPlaying) {
        pause();
      }
      setPlayhead(ms);
    },
    [
      setPlayhead,
      rulerPxToMs,
      resolvePlayheadMs,
      state.isPlaying,
      pause,
      sortMode,
    ],
  );

  const handleRulerPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!rulerScrubRef.current) return;
      const ms = resolvePlayheadMs(
        rulerPxToMs(e.clientX, e.currentTarget),
        e.shiftKey,
      );
      if (state.isPlaying) {
        pause();
      }
      setPlayhead(ms);
    },
    [setPlayhead, rulerPxToMs, resolvePlayheadMs, state.isPlaying, pause],
  );

  const handleRulerPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!rulerScrubRef.current) return;
      rulerScrubRef.current = false;
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      document.body.style.userSelect = '';
      if (!state.isPlaying) {
        void applyAtPlayhead();
      }
    },
    [applyAtPlayhead, state.isPlaying],
  );

  // ── Zoom ─────────────────────────────────────────────

  const ZOOM_TRANSITION_MS = 180;
  const zoomTransitionStyle = `left ${ZOOM_TRANSITION_MS}ms ease-out, width ${ZOOM_TRANSITION_MS}ms ease-out`;
  const [zoomAnimating, setZoomAnimating] = useState(false);
  const zoomTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const animateZoom = useCallback(
    (pps: number) => {
      setZoomAnimating(true);
      setZoom(pps);
      if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current);
      zoomTimerRef.current = setTimeout(
        () => setZoomAnimating(false),
        ZOOM_TRANSITION_MS,
      );
    },
    [setZoom],
  );

  const handleZoomIn = useCallback(() => {
    animateZoom(state.pixelsPerSecond * 1.5);
  }, [state.pixelsPerSecond, animateZoom]);

  const handleZoomOut = useCallback(() => {
    animateZoom(state.pixelsPerSecond / 1.5);
  }, [state.pixelsPerSecond, animateZoom]);

  // ── Scroll to playhead ───────────────────────────────

  const scrollToPlayhead = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const phPx = (state.playheadMs / 1000) * state.pixelsPerSecond;
    const viewportWidth = el.clientWidth - sourcesWidth;
    el.scrollLeft = Math.max(0, phPx - viewportWidth / 2);
  }, [state.playheadMs, state.pixelsPerSecond, sourcesWidth]);

  // ── Find clip at playhead for selected track ──────

  const findClipAtPlayhead = useCallback(
    (trackId: string): string | null => {
      const track = state.tracks.find((t) => t.id === trackId);
      if (!track) return null;
      for (const clip of track.clips) {
        if (state.playheadMs >= clip.startMs && state.playheadMs < clip.endMs) {
          return clip.id;
        }
      }
      return null;
    },
    [state.tracks, state.playheadMs],
  );

  // ── Jump playhead to next/prev segment edge ──────────

  const jumpToEdge = useCallback(
    (direction: 'prev' | 'next') => {
      const edges = new Set<number>();
      edges.add(0);
      edges.add(state.totalDurationMs);
      for (const track of state.tracks) {
        for (const clip of track.clips) {
          edges.add(clip.startMs);
          edges.add(clip.endMs);
        }
      }
      const sorted = [...edges].sort((a, b) => a - b);
      if (direction === 'next') {
        const next = sorted.find((e) => e > state.playheadMs);
        if (next !== undefined) setPlayhead(next);
      } else {
        const prev = [...sorted].reverse().find((e) => e < state.playheadMs);
        if (prev !== undefined) setPlayhead(prev);
      }
    },
    [state.tracks, state.totalDurationMs, state.playheadMs, setPlayhead],
  );

  return {
    panelHeight,
    setPanelHeight,
    sourcesWidth,
    setSourcesWidth,
    handleResizeStart,
    handleSourcesResizeStart,
    contextMenu,
    setContextMenu,
    showHelp,
    setShowHelp,
    editingTrackId,
    setEditingTrackId,
    editingTrackLabel,
    setEditingTrackLabel,
    invalidDropTrackId,
    setInvalidDropTrackId,
    scrollContainerRef,
    rulerRef,
    contextMenuRef,
    colorSubmenuOpen,
    setColorSubmenuOpen,
    longPressColor,
    setLongPressColor,
    colorSubmenuCloseTimer,
    timelineWidthPx,
    playheadPx,
    rulerTicks,
    zoomAnimating,
    ZOOM_TRANSITION_MS,
    zoomTransitionStyle,
    handleRulerPointerDown,
    handleRulerPointerMove,
    handleRulerPointerUp,
    animateZoom,
    handleZoomIn,
    handleZoomOut,
    scrollToPlayhead,
    findClipAtPlayhead,
    jumpToEdge,
    trackDropIndex,
    setTrackDropIndex,
    trackDragRef,
    groupDragRef,
    dragRef,
    keyframeDragRef,
  };
}
