'use client';

import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { Input } from '@/app/actions/actions';
import type { InputWrapper } from '../hooks/use-control-panel-state';
import { SortableItem } from '@/components/control-panel/sortable-list/sortable-item';
import { SortableList } from '@/components/control-panel/sortable-list/sortable-list';
import LoadingSpinner from '@/components/ui/spinner';
import { useControlPanelContext } from '../contexts/control-panel-context';
import { useTimelineState, DEFAULT_PPS } from '../hooks/use-timeline-state';
import { useTimelinePlayback } from '../hooks/use-timeline-playback';
import {
  Play,
  Square,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Crosshair,
  HelpCircle,
  X,
  Undo2,
  Redo2,
} from 'lucide-react';

// ── Props ────────────────────────────────────────────────

type TimelinePanelProps = {
  inputWrappers: InputWrapper[];
  listVersion: number;
  showStreamsSpinner: boolean;
  updateOrder: (wrappers: InputWrapper[]) => Promise<void>;
  openFxInputId: string | null;
  onToggleFx: (inputId: string) => void;
  isSwapping?: boolean;
  selectedInputId: string | null;
  isGuest?: boolean;
  guestInputId?: string | null;
};

// ── Color maps ───────────────────────────────────────────

const TYPE_COLORS: Record<Input['type'], string> = {
  'twitch-channel': 'bg-purple-500',
  'kick-channel': 'bg-green-500',
  whip: 'bg-blue-500',
  'local-mp4': 'bg-orange-500',
  image: 'bg-yellow-500',
  'text-input': 'bg-pink-500',
};

const SEGMENT_COLORS: Record<Input['type'], string> = {
  'twitch-channel': 'bg-purple-500/40 border-purple-500/60',
  'kick-channel': 'bg-green-500/40 border-green-500/60',
  whip: 'bg-blue-500/40 border-blue-500/60',
  'local-mp4': 'bg-orange-500/40 border-orange-500/60',
  image: 'bg-yellow-500/40 border-yellow-500/60',
  'text-input': 'bg-pink-500/40 border-pink-500/60',
};

const SEGMENT_SELECTED: Record<Input['type'], string> = {
  'twitch-channel': 'ring-1 ring-purple-400/70',
  'kick-channel': 'ring-1 ring-green-400/70',
  whip: 'ring-1 ring-blue-400/70',
  'local-mp4': 'ring-1 ring-orange-400/70',
  image: 'ring-1 ring-yellow-400/70',
  'text-input': 'ring-1 ring-pink-400/70',
};

// ── Constants ────────────────────────────────────────────

const MIN_HEIGHT = 120;
const MAX_HEIGHT_VH = 0.6;
const DEFAULT_HEIGHT = 350;
const TRACK_HEIGHT = 40;
const SOURCES_WIDTH = 180;
const SNAP_THRESHOLD_PX = 8;
const RESIZE_HANDLE_PX = 5;

// ── Time formatting ──────────────────────────────────────

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// ── Ruler tick computation ───────────────────────────────

function computeRulerTicks(
  totalDurationMs: number,
  pixelsPerSecond: number,
): { timeMs: number; label: string }[] {
  // Choose a nice interval based on zoom
  const totalWidthPx = (totalDurationMs / 1000) * pixelsPerSecond;
  const desiredTickCount = Math.max(4, Math.min(20, totalWidthPx / 80));
  const roughIntervalMs = totalDurationMs / desiredTickCount;

  // Snap to nice intervals: 5s, 10s, 15s, 30s, 60s, 120s, 300s
  const niceIntervals = [
    5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000,
  ];
  const intervalMs =
    niceIntervals.find((n) => n >= roughIntervalMs) ??
    niceIntervals[niceIntervals.length - 1];

  const ticks: { timeMs: number; label: string }[] = [];
  for (let t = 0; t <= totalDurationMs; t += intervalMs) {
    ticks.push({ timeMs: t, label: formatMs(t) });
  }
  return ticks;
}

// ── Snap helpers ─────────────────────────────────────────

function computeSnapTargets(
  tracks: Record<string, import('../hooks/use-timeline-state').TrackTimeline>,
  excludeSegmentId: string,
  playheadMs: number,
): number[] {
  const targets: number[] = [0, playheadMs];
  for (const track of Object.values(tracks)) {
    for (const seg of track.segments) {
      if (seg.id === excludeSegmentId) continue;
      targets.push(seg.startMs, seg.endMs);
    }
  }
  return targets;
}

function snapToNearest(
  ms: number,
  targets: number[],
  thresholdMs: number,
): number {
  let best = ms;
  let bestDist = Infinity;
  for (const t of targets) {
    const dist = Math.abs(ms - t);
    if (dist < bestDist && dist <= thresholdMs) {
      bestDist = dist;
      best = t;
    }
  }
  return best;
}

// ── Component ────────────────────────────────────────────

export function TimelinePanel({
  inputWrappers,
  listVersion,
  showStreamsSpinner,
  updateOrder,
  openFxInputId,
  onToggleFx,
  isSwapping,
  selectedInputId,
  isGuest,
  guestInputId,
}: TimelinePanelProps) {
  const { inputs, roomId, refreshState } = useControlPanelContext();
  const {
    state,
    setPlayhead,
    setPlaying,
    setZoom,
    reset,
    moveSegment,
    resizeSegment,
    splitSegment,
    deleteSegment,
    duplicateSegment,
    addOrderKeyframe,
    removeOrderKeyframe,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useTimelineState(roomId, inputs);

  const { play, stop, applyAtPlayhead } = useTimelinePlayback(
    roomId,
    inputs,
    state,
    setPlayhead,
    setPlaying,
    refreshState,
  );

  const [panelHeight, setPanelHeight] = useState(DEFAULT_HEIGHT);
  const resizingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    inputId: string;
    isMuted: boolean;
    segmentId?: string;
    splitAtMs?: number;
  } | null>(null);

  const [keyframeMenu, setKeyframeMenu] = useState<{
    x: number;
    y: number;
    keyframeId: string;
  } | null>(null);

  const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(
    null,
  );

  const [selectedSegmentId, setSelectedSegmentId] = useState<{
    inputId: string;
    segmentId: string;
  } | null>(null);

  const [showHelp, setShowHelp] = useState(false);

  const [isWideScreen, setIsWideScreen] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);

  // ── Segment interaction refs ─────────────────────────
  const dragRef = useRef<{
    type: 'move' | 'resize-left' | 'resize-right';
    inputId: string;
    segmentId: string;
    originX: number;
    originStartMs: number;
    originEndMs: number;
  } | null>(null);

  useEffect(() => {
    const checkWidth = () => setIsWideScreen(window.innerWidth >= 1600);
    checkWidth();
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, []);

  const attachedInputIds = useMemo(() => {
    const ids = new Set<string>();
    for (const input of inputs) {
      for (const id of input.attachedInputIds || []) {
        ids.add(id);
      }
    }
    return ids;
  }, [inputs]);

  const visibleWrappers = useMemo(
    () => inputWrappers.filter((w) => !attachedInputIds.has(w.inputId)),
    [inputWrappers, attachedInputIds],
  );

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

  // ── Auto-fit zoom so total duration sits at ~90% width ──
  const autoFitRef = useRef(false);
  useEffect(() => {
    if (autoFitRef.current) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    const availableWidth = el.clientWidth - SOURCES_WIDTH;
    if (availableWidth <= 0) return;
    const durationSec = state.totalDurationMs / 1000;
    if (durationSec <= 0) return;
    const idealPps = (availableWidth * 0.9) / durationSec;
    setZoom(idealPps);
    autoFitRef.current = true;
  }, [state.totalDurationMs, setZoom]);

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

  // ── Track click ──────────────────────────────────────

  const handleTrackClick = useCallback((inputId: string) => {
    window.dispatchEvent(
      new CustomEvent('smelter:inputs:select', { detail: { inputId } }),
    );
  }, []);

  // ── Ruler scrub (pointer drag to move playhead) ───────

  const rulerScrubRef = useRef(false);

  const rulerPxToMs = useCallback(
    (clientX: number, target: HTMLElement) => {
      const rect = target.getBoundingClientRect();
      const x = clientX - rect.left;
      return Math.round((x / state.pixelsPerSecond) * 1000);
    },
    [state.pixelsPerSecond],
  );

  const handleRulerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      rulerScrubRef.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      document.body.style.userSelect = 'none';
      setPlayhead(rulerPxToMs(e.clientX, e.currentTarget));
    },
    [setPlayhead, rulerPxToMs],
  );

  const handleRulerPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!rulerScrubRef.current) return;
      setPlayhead(rulerPxToMs(e.clientX, e.currentTarget));
    },
    [setPlayhead, rulerPxToMs],
  );

  const handleRulerPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!rulerScrubRef.current) return;
      rulerScrubRef.current = false;
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      document.body.style.userSelect = '';
      void applyAtPlayhead();
    },
    [applyAtPlayhead],
  );

  // ── Zoom ─────────────────────────────────────────────

  const handleZoomIn = useCallback(() => {
    setZoom(state.pixelsPerSecond * 1.5);
  }, [state.pixelsPerSecond, setZoom]);

  const handleZoomOut = useCallback(() => {
    setZoom(state.pixelsPerSecond / 1.5);
  }, [state.pixelsPerSecond, setZoom]);

  // ── Scroll to playhead ───────────────────────────────

  const scrollToPlayhead = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const phPx = (state.playheadMs / 1000) * state.pixelsPerSecond;
    const viewportWidth = el.clientWidth - SOURCES_WIDTH;
    el.scrollLeft = Math.max(0, phPx - viewportWidth / 2);
  }, [state.playheadMs, state.pixelsPerSecond]);

  // ── Find segment at playhead for selected track ──────

  const findSegmentAtPlayhead = useCallback(
    (inputId: string): string | null => {
      const track = state.tracks[inputId];
      if (!track) return null;
      for (const seg of track.segments) {
        if (state.playheadMs >= seg.startMs && state.playheadMs < seg.endMs) {
          return seg.id;
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
      for (const track of Object.values(state.tracks)) {
        for (const seg of track.segments) {
          edges.add(seg.startMs);
          edges.add(seg.endMs);
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

  // ── Navigate tracks ─────────────────────────────────

  const navigateTrack = useCallback(
    (direction: 'up' | 'down') => {
      const ids = visibleWrappers.map((w) => w.inputId);
      if (ids.length === 0) return;
      const currentIdx = selectedInputId ? ids.indexOf(selectedInputId) : -1;
      let nextIdx: number;
      if (direction === 'down') {
        nextIdx = currentIdx < ids.length - 1 ? currentIdx + 1 : 0;
      } else {
        nextIdx = currentIdx > 0 ? currentIdx - 1 : ids.length - 1;
      }
      window.dispatchEvent(
        new CustomEvent('smelter:inputs:select', {
          detail: { inputId: ids[nextIdx] },
        }),
      );
    },
    [visibleWrappers, selectedInputId],
  );

  // ── Tab to next segment on current track ────────────

  const tabToNextSegment = useCallback(
    (reverse: boolean) => {
      if (!selectedInputId) return;
      const track = state.tracks[selectedInputId];
      if (!track || track.segments.length === 0) return;
      const segments = track.segments;
      const currentSegIdx = selectedSegmentId
        ? segments.findIndex((s) => s.id === selectedSegmentId.segmentId)
        : -1;
      let nextIdx: number;
      if (reverse) {
        nextIdx = currentSegIdx > 0 ? currentSegIdx - 1 : segments.length - 1;
      } else {
        nextIdx = currentSegIdx < segments.length - 1 ? currentSegIdx + 1 : 0;
      }
      const seg = segments[nextIdx];
      setSelectedSegmentId({
        inputId: selectedInputId,
        segmentId: seg.id,
      });
      setPlayhead(seg.startMs);
    },
    [selectedInputId, state.tracks, selectedSegmentId, setPlayhead],
  );

  // ── Keyboard shortcuts ──────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const key = e.key;
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;

      switch (key) {
        case 'z':
        case 'Z': {
          if (!ctrl) break;
          e.preventDefault();
          if (shift) redo();
          else undo();
          break;
        }
        case 'y':
        case 'Y': {
          if (!ctrl) break;
          e.preventDefault();
          redo();
          break;
        }
        case ' ': {
          e.preventDefault();
          if (state.isPlaying) stop();
          else play();
          break;
        }
        case 'Home': {
          e.preventDefault();
          setPlayhead(0);
          break;
        }
        case 'End': {
          e.preventDefault();
          setPlayhead(state.totalDurationMs);
          break;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          const step = shift ? 5000 : 1000;
          setPlayhead(Math.max(0, state.playheadMs - step));
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          const step = shift ? 5000 : 1000;
          setPlayhead(Math.min(state.totalDurationMs, state.playheadMs + step));
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          navigateTrack('up');
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          navigateTrack('down');
          break;
        }
        case 'j':
        case 'J': {
          if (ctrl) break;
          e.preventDefault();
          jumpToEdge('prev');
          break;
        }
        case 'l':
        case 'L': {
          if (ctrl) break;
          e.preventDefault();
          jumpToEdge('next');
          break;
        }
        case '+':
        case '=': {
          if (ctrl) {
            e.preventDefault();
            setZoom(state.pixelsPerSecond * 1.5);
          } else if (key === '+') {
            e.preventDefault();
            setZoom(state.pixelsPerSecond * 1.5);
          }
          break;
        }
        case '-': {
          if (ctrl) e.preventDefault();
          setZoom(state.pixelsPerSecond / 1.5);
          break;
        }
        case '0': {
          if (ctrl) break;
          e.preventDefault();
          // Auto-fit zoom
          const el = scrollContainerRef.current;
          if (el) {
            const availableWidth = el.clientWidth - SOURCES_WIDTH;
            const durationSec = state.totalDurationMs / 1000;
            if (durationSec > 0 && availableWidth > 0) {
              setZoom((availableWidth * 0.9) / durationSec);
            }
          }
          break;
        }
        case 'f':
        case 'F': {
          if (ctrl) break;
          e.preventDefault();
          scrollToPlayhead();
          break;
        }
        case 's':
        case 'S': {
          if (ctrl) break;
          e.preventDefault();
          if (selectedInputId) {
            const segId = findSegmentAtPlayhead(selectedInputId);
            if (segId) splitSegment(selectedInputId, segId, state.playheadMs);
          }
          break;
        }
        case 'd':
        case 'D': {
          if (ctrl) break;
          e.preventDefault();
          if (selectedSegmentId) {
            duplicateSegment(
              selectedSegmentId.inputId,
              selectedSegmentId.segmentId,
            );
          }
          break;
        }
        case 'm':
        case 'M': {
          if (ctrl) break;
          e.preventDefault();
          if (selectedInputId) {
            window.dispatchEvent(
              new CustomEvent('smelter:inputs:toggle-mute', {
                detail: { inputId: selectedInputId },
              }),
            );
          }
          break;
        }
        case 'Delete':
        case 'Backspace': {
          if (selectedSegmentId) {
            e.preventDefault();
            deleteSegment(
              selectedSegmentId.inputId,
              selectedSegmentId.segmentId,
            );
            setSelectedSegmentId(null);
          }
          break;
        }
        case 'Tab': {
          e.preventDefault();
          tabToNextSegment(shift);
          break;
        }
        case 'Escape': {
          setSelectedSegmentId(null);
          setShowHelp(false);
          break;
        }
        case '?': {
          e.preventDefault();
          setShowHelp((prev) => !prev);
          break;
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    state.isPlaying,
    state.playheadMs,
    state.totalDurationMs,
    state.pixelsPerSecond,
    play,
    stop,
    setPlayhead,
    setZoom,
    scrollToPlayhead,
    jumpToEdge,
    navigateTrack,
    tabToNextSegment,
    findSegmentAtPlayhead,
    splitSegment,
    deleteSegment,
    duplicateSegment,
    undo,
    redo,
    selectedInputId,
    selectedSegmentId,
  ]);

  // ── Segment pointer interactions ─────────────────────

  const pxToMs = useCallback(
    (px: number) => (px / state.pixelsPerSecond) * 1000,
    [state.pixelsPerSecond],
  );

  const snapThresholdMs = useMemo(() => pxToMs(SNAP_THRESHOLD_PX), [pxToMs]);

  const handleSegmentPointerDown = useCallback(
    (
      e: React.PointerEvent<HTMLDivElement>,
      inputId: string,
      segmentId: string,
      segStartMs: number,
      segEndMs: number,
    ) => {
      // Alt+Click = split
      if (e.altKey) {
        const rect = e.currentTarget.parentElement!.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const atMs = Math.round(pxToMs(x));
        splitSegment(inputId, segmentId, atMs);
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      // Track segment selection
      setSelectedSegmentId({ inputId, segmentId });

      const rect = e.currentTarget.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const segWidthPx = rect.width;

      let type: 'move' | 'resize-left' | 'resize-right' = 'move';
      if (localX <= RESIZE_HANDLE_PX) {
        type = 'resize-left';
      } else if (localX >= segWidthPx - RESIZE_HANDLE_PX) {
        type = 'resize-right';
      }

      dragRef.current = {
        type,
        inputId,
        segmentId,
        originX: e.clientX,
        originStartMs: segStartMs,
        originEndMs: segEndMs,
      };

      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      document.body.style.userSelect = 'none';
    },
    [pxToMs, splitSegment],
  );

  const handleSegmentPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) {
        // Update cursor based on position
        const rect = e.currentTarget.getBoundingClientRect();
        const localX = e.clientX - rect.left;
        const w = rect.width;
        if (localX <= RESIZE_HANDLE_PX || localX >= w - RESIZE_HANDLE_PX) {
          e.currentTarget.style.cursor = 'col-resize';
        } else {
          e.currentTarget.style.cursor = 'grab';
        }
        return;
      }

      const deltaX = e.clientX - drag.originX;
      const deltaMs = pxToMs(deltaX);

      const snapTargets = computeSnapTargets(
        state.tracks,
        drag.segmentId,
        state.playheadMs,
      );

      if (drag.type === 'move') {
        let newStart = Math.round(drag.originStartMs + deltaMs);
        newStart = snapToNearest(newStart, snapTargets, snapThresholdMs);
        // Also snap the end
        const duration = drag.originEndMs - drag.originStartMs;
        const snappedEnd = snapToNearest(
          newStart + duration,
          snapTargets,
          snapThresholdMs,
        );
        if (snappedEnd !== newStart + duration) {
          newStart = snappedEnd - duration;
        }
        moveSegment(drag.inputId, drag.segmentId, newStart);
      } else if (drag.type === 'resize-left') {
        let newStart = Math.round(drag.originStartMs + deltaMs);
        newStart = snapToNearest(newStart, snapTargets, snapThresholdMs);
        resizeSegment(drag.inputId, drag.segmentId, 'left', newStart);
      } else {
        let newEnd = Math.round(drag.originEndMs + deltaMs);
        newEnd = snapToNearest(newEnd, snapTargets, snapThresholdMs);
        resizeSegment(drag.inputId, drag.segmentId, 'right', newEnd);
      }
    },
    [
      pxToMs,
      state.tracks,
      state.playheadMs,
      snapThresholdMs,
      moveSegment,
      resizeSegment,
    ],
  );

  const handleSegmentPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragRef.current) {
        dragRef.current = null;
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        document.body.style.userSelect = '';
      }
    },
    [],
  );

  // ── Context menu ─────────────────────────────────────

  const handleContextMenu = useCallback(
    (e: ReactMouseEvent, inputId: string, segmentId?: string) => {
      e.preventDefault();
      const input = inputs.find((i) => i.inputId === inputId);

      let splitAtMs: number | undefined;
      if (segmentId) {
        const trackEl = (e.target as HTMLElement).closest(
          '[data-no-dnd]',
        )?.parentElement;
        if (trackEl) {
          const rect = trackEl.getBoundingClientRect();
          const x = e.clientX - rect.left;
          splitAtMs = Math.round((x / state.pixelsPerSecond) * 1000);
        }
      }

      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        inputId,
        isMuted: input ? input.volume === 0 : false,
        segmentId,
        splitAtMs,
      });
    },
    [inputs, state.pixelsPerSecond],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (!contextMenu) return;

    const handleClick = () => closeContextMenu();
    const handleScroll = () => closeContextMenu();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeContextMenu();
    };

    window.addEventListener('click', handleClick);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', handleClick);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu, closeContextMenu]);

  const handleFx = useCallback(() => {
    if (contextMenu) onToggleFx(contextMenu.inputId);
    closeContextMenu();
  }, [contextMenu, onToggleFx, closeContextMenu]);

  const handleMuteToggle = useCallback(() => {
    if (contextMenu) {
      window.dispatchEvent(
        new CustomEvent('smelter:inputs:toggle-mute', {
          detail: { inputId: contextMenu.inputId },
        }),
      );
    }
    closeContextMenu();
  }, [contextMenu, closeContextMenu]);

  const handleDelete = useCallback(() => {
    if (contextMenu) {
      window.dispatchEvent(
        new CustomEvent('smelter:inputs:remove', {
          detail: { inputId: contextMenu.inputId },
        }),
      );
    }
    closeContextMenu();
  }, [contextMenu, closeContextMenu]);

  const handleSplitHere = useCallback(() => {
    if (contextMenu?.segmentId && contextMenu.splitAtMs !== undefined) {
      splitSegment(
        contextMenu.inputId,
        contextMenu.segmentId,
        contextMenu.splitAtMs,
      );
    }
    closeContextMenu();
  }, [contextMenu, splitSegment, closeContextMenu]);

  const handleDeleteSegment = useCallback(() => {
    if (contextMenu?.segmentId) {
      deleteSegment(contextMenu.inputId, contextMenu.segmentId);
    }
    closeContextMenu();
  }, [contextMenu, deleteSegment, closeContextMenu]);

  // ── Order keyframe handlers ──────────────────────────

  const handleOrderChange = useCallback(
    async (wrappers: InputWrapper[]) => {
      addOrderKeyframe(
        state.playheadMs,
        wrappers.map((w) => w.inputId),
      );
      await updateOrder(wrappers);
    },
    [state.playheadMs, addOrderKeyframe, updateOrder],
  );

  const handleAddOrderKeyframe = useCallback(() => {
    const order = visibleWrappers.map((w) => w.inputId);
    addOrderKeyframe(state.playheadMs, order);
    closeContextMenu();
  }, [visibleWrappers, state.playheadMs, addOrderKeyframe, closeContextMenu]);

  const handleKeyframeClick = useCallback(
    (e: ReactMouseEvent, keyframeId: string) => {
      e.stopPropagation();
      setSelectedKeyframeId((prev) =>
        prev === keyframeId ? null : keyframeId,
      );
    },
    [],
  );

  const handleKeyframeContextMenu = useCallback(
    (e: ReactMouseEvent, keyframeId: string) => {
      e.preventDefault();
      e.stopPropagation();
      setKeyframeMenu({ x: e.clientX, y: e.clientY, keyframeId });
    },
    [],
  );

  const closeKeyframeMenu = useCallback(() => setKeyframeMenu(null), []);

  useEffect(() => {
    if (!keyframeMenu) return;
    const handleClick = () => closeKeyframeMenu();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeKeyframeMenu();
    };
    window.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [keyframeMenu, closeKeyframeMenu]);

  const handleRemoveKeyframe = useCallback(() => {
    if (keyframeMenu) {
      removeOrderKeyframe(keyframeMenu.keyframeId);
      if (selectedKeyframeId === keyframeMenu.keyframeId) {
        setSelectedKeyframeId(null);
      }
    }
    closeKeyframeMenu();
  }, [
    keyframeMenu,
    removeOrderKeyframe,
    selectedKeyframeId,
    closeKeyframeMenu,
  ]);

  // ── Render helpers ───────────────────────────────────

  const renderSegments = useCallback(
    (inputId: string, inputType: Input['type'], isSelected: boolean) => {
      const track = state.tracks[inputId];
      if (!track) return null;

      return track.segments.map((seg) => {
        const leftPx = (seg.startMs / 1000) * state.pixelsPerSecond;
        const widthPx =
          ((seg.endMs - seg.startMs) / 1000) * state.pixelsPerSecond;
        const isSegSelected =
          selectedSegmentId?.inputId === inputId &&
          selectedSegmentId?.segmentId === seg.id;
        const durationMs = seg.endMs - seg.startMs;

        return (
          <div
            key={seg.id}
            data-no-dnd='true'
            className={`absolute top-1 bottom-1 rounded-sm border ${SEGMENT_COLORS[inputType]} ${isSelected || isSegSelected ? SEGMENT_SELECTED[inputType] : ''} ${isSegSelected ? 'ring-2 brightness-125' : ''} flex items-center overflow-hidden touch-none`}
            style={{
              left: leftPx,
              width: Math.max(widthPx, 2),
              cursor: 'grab',
            }}
            title={`${formatMs(seg.startMs)} → ${formatMs(seg.endMs)} (${formatMs(durationMs)})`}
            onPointerDown={(e) =>
              handleSegmentPointerDown(
                e,
                inputId,
                seg.id,
                seg.startMs,
                seg.endMs,
              )
            }
            onPointerMove={handleSegmentPointerMove}
            onPointerUp={handleSegmentPointerUp}
            onPointerCancel={handleSegmentPointerUp}
            onContextMenu={(e) => {
              e.stopPropagation();
              handleContextMenu(e, inputId, seg.id);
            }}>
            {/* Left resize handle */}
            <div className='absolute left-0 top-0 bottom-0 w-[5px] cursor-col-resize z-10' />
            {/* Right resize handle */}
            <div className='absolute right-0 top-0 bottom-0 w-[5px] cursor-col-resize z-10' />
            {/* Label */}
            {widthPx > 40 && (
              <span className='text-[10px] text-neutral-300/80 truncate px-2 select-none pointer-events-none'>
                {formatMs(seg.startMs)}
              </span>
            )}
          </div>
        );
      });
    },
    [
      state.tracks,
      state.pixelsPerSecond,
      selectedSegmentId,
      handleSegmentPointerDown,
      handleSegmentPointerMove,
      handleSegmentPointerUp,
      handleContextMenu,
    ],
  );

  return (
    <div
      className='relative flex flex-col bg-neutral-950 border-t border-neutral-800'
      style={{ height: panelHeight }}>
      {/* Resize handle */}
      <div
        className='h-1 w-full cursor-ns-resize hover:bg-neutral-700 transition-colors shrink-0'
        onMouseDown={handleResizeStart}
      />

      {/* Transport bar */}
      <div className='flex items-center gap-2 px-3 h-8 bg-neutral-900 border-b border-neutral-800 shrink-0'>
        <button
          className={`p-1 rounded hover:bg-neutral-700 transition-colors cursor-pointer ${state.isPlaying ? 'text-green-400' : 'text-neutral-400 hover:text-white'}`}
          onClick={play}
          title='Play'>
          <Play className='w-3.5 h-3.5' />
        </button>
        <button
          className='p-1 rounded hover:bg-neutral-700 text-neutral-400 hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'
          onClick={stop}
          disabled={!state.isPlaying}
          title='Stop'>
          <Square className='w-3.5 h-3.5' />
        </button>
        <button
          className='p-1 rounded hover:bg-neutral-700 text-neutral-400 hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'
          onClick={applyAtPlayhead}
          disabled={state.isPlaying}
          title='Apply state at playhead'>
          <Crosshair className='w-3.5 h-3.5' />
        </button>
        <button
          className='p-1 rounded hover:bg-neutral-700 text-neutral-400 hover:text-white transition-colors cursor-pointer'
          onClick={reset}
          title='Reset timeline'>
          <RotateCcw className='w-3.5 h-3.5' />
        </button>

        <div className='w-px h-4 bg-neutral-700' />

        <button
          className='p-1 rounded hover:bg-neutral-700 text-neutral-400 hover:text-white transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed'
          onClick={undo}
          disabled={!canUndo}
          title='Undo (Ctrl+Z)'>
          <Undo2 className='w-3.5 h-3.5' />
        </button>
        <button
          className='p-1 rounded hover:bg-neutral-700 text-neutral-400 hover:text-white transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed'
          onClick={redo}
          disabled={!canRedo}
          title='Redo (Ctrl+Shift+Z)'>
          <Redo2 className='w-3.5 h-3.5' />
        </button>

        <div className='text-[11px] text-neutral-500 font-mono tabular-nums ml-1'>
          {formatMs(state.playheadMs)}
          <span className='text-neutral-600 mx-1'>/</span>
          {formatMs(state.totalDurationMs)}
        </div>

        <div className='flex-1' />

        <button
          className='p-1 rounded hover:bg-neutral-700 text-neutral-400 hover:text-white transition-colors cursor-pointer'
          onClick={handleZoomOut}
          title='Zoom out'>
          <ZoomOut className='w-3.5 h-3.5' />
        </button>
        <div className='text-[10px] text-neutral-600 font-mono w-10 text-center'>
          {Math.round((state.pixelsPerSecond / DEFAULT_PPS) * 100)}%
        </div>
        <button
          className='p-1 rounded hover:bg-neutral-700 text-neutral-400 hover:text-white transition-colors cursor-pointer'
          onClick={handleZoomIn}
          title='Zoom in'>
          <ZoomIn className='w-3.5 h-3.5' />
        </button>

        <div className='w-px h-4 bg-neutral-700 mx-1' />

        <button
          className='p-1 rounded hover:bg-neutral-700 text-neutral-400 hover:text-white transition-colors cursor-pointer'
          onClick={scrollToPlayhead}
          title='Scroll to playhead (F)'>
          <Crosshair className='w-3.5 h-3.5' />
        </button>

        <button
          className='p-1 rounded hover:bg-neutral-700 text-neutral-400 hover:text-white transition-colors cursor-pointer'
          onClick={() => setShowHelp((prev) => !prev)}
          title='Keyboard shortcuts (?)'>
          <HelpCircle className='w-3.5 h-3.5' />
        </button>
      </div>

      {/* Header: Sources label + ruler */}
      <div className='flex shrink-0'>
        <div
          className='shrink-0 bg-neutral-900 flex items-center px-3'
          style={{ width: SOURCES_WIDTH }}>
          <span className='text-[11px] text-neutral-500 uppercase tracking-wider font-medium'>
            Sources
          </span>
        </div>
        <div
          ref={rulerRef}
          className='flex-1 h-7 bg-neutral-900 border-b border-neutral-800 relative cursor-pointer overflow-x-hidden touch-none'
          onPointerDown={handleRulerPointerDown}
          onPointerMove={handleRulerPointerMove}
          onPointerUp={handleRulerPointerUp}
          onPointerCancel={handleRulerPointerUp}>
          <div
            className='relative h-full pointer-events-none'
            style={{ width: timelineWidthPx, minWidth: '100%' }}>
            {rulerTicks.map((tick) => {
              const x = (tick.timeMs / 1000) * state.pixelsPerSecond;
              return (
                <div
                  key={tick.timeMs}
                  className='absolute flex flex-col items-center top-0 bottom-0 justify-end'
                  style={{ left: x }}>
                  <span className='text-[10px] text-neutral-600 font-mono -translate-x-1/2 leading-none mb-1'>
                    {tick.label}
                  </span>
                  <div className='w-px h-1.5 bg-neutral-700 -translate-x-1/2' />
                </div>
              );
            })}
            {/* Order keyframe diamond markers */}
            {state.orderKeyframes.map((kf) => {
              const x = (kf.timeMs / 1000) * state.pixelsPerSecond;
              const isSelected = selectedKeyframeId === kf.id;
              return (
                <div
                  key={kf.id}
                  className={`absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rotate-45 border cursor-pointer pointer-events-auto z-20 ${
                    isSelected
                      ? 'bg-amber-400 border-amber-300'
                      : 'bg-amber-500/70 border-amber-400/50 hover:bg-amber-400 hover:border-amber-300'
                  }`}
                  style={{ left: x - 5 }}
                  data-no-dnd='true'
                  onClick={(e) => handleKeyframeClick(e, kf.id)}
                  onContextMenu={(e) => handleKeyframeContextMenu(e, kf.id)}
                  title={`Order keyframe at ${formatMs(kf.timeMs)}`}
                />
              );
            })}
            {/* Playhead marker on ruler */}
            <div
              className='absolute top-0 bottom-0 w-px bg-red-500 z-10 pointer-events-none'
              style={{ left: playheadPx }}
            />
          </div>
        </div>
      </div>

      {/* Tracks area */}
      <div
        ref={scrollContainerRef}
        className='flex-1 overflow-y-auto overflow-x-auto relative'>
        {isSwapping && (
          <div className='absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm'>
            <div className='flex items-center gap-2 text-neutral-300 text-sm'>
              <svg
                className='animate-spin h-5 w-5'
                viewBox='0 0 24 24'
                fill='none'>
                <circle
                  className='opacity-25'
                  cx='12'
                  cy='12'
                  r='10'
                  stroke='currentColor'
                  strokeWidth='4'
                />
                <path
                  className='opacity-75'
                  fill='currentColor'
                  d='M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z'
                />
              </svg>
              <span>Transitioning…</span>
            </div>
          </div>
        )}

        {showStreamsSpinner ? (
          <div className='flex items-center justify-center h-32'>
            <LoadingSpinner size='lg' variant='spinner' />
          </div>
        ) : (
          <SortableList
            items={visibleWrappers}
            resetVersion={listVersion}
            disableDrag={isGuest || !isWideScreen}
            renderItem={(item) => {
              const input = inputs.find((i) => i.inputId === item.inputId);
              if (!input) return null;
              const isSelected = selectedInputId === input.inputId;
              const isLive =
                input.sourceState === 'live' ||
                input.sourceState === 'always-live';

              return (
                <SortableItem
                  key={item.inputId}
                  id={item.id}
                  disableDrag={isGuest || !isWideScreen}>
                  <div
                    className='flex border-b border-neutral-800/50 cursor-pointer'
                    style={{ height: TRACK_HEIGHT }}
                    onClick={() => handleTrackClick(input.inputId)}
                    onContextMenu={(e) => handleContextMenu(e, input.inputId)}>
                    {/* Source label (sticky left) */}
                    <div
                      className='shrink-0 bg-neutral-900 flex items-center gap-2 px-3 sticky left-0 z-10'
                      style={{ width: SOURCES_WIDTH }}>
                      <div
                        className={`w-2.5 h-2.5 rounded-full shrink-0 ${TYPE_COLORS[input.type]}`}
                      />
                      <span className='text-sm text-neutral-200 truncate flex-1'>
                        {input.title}
                      </span>
                      <div
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${isLive ? 'bg-green-500' : 'bg-neutral-500'}`}
                      />
                    </div>
                    {/* Track timeline area */}
                    <div
                      className='relative'
                      style={{
                        width: timelineWidthPx,
                        minWidth: `calc(100% - ${SOURCES_WIDTH}px)`,
                      }}>
                      {renderSegments(input.inputId, input.type, isSelected)}
                      {/* Playhead line on track */}
                      <div
                        className='absolute top-0 bottom-0 w-px bg-red-500/50 z-10 pointer-events-none'
                        style={{ left: playheadPx }}
                      />
                    </div>
                  </div>
                </SortableItem>
              );
            }}
            onOrderChange={handleOrderChange}
          />
        )}
      </div>

      {/* Context menu */}
      {contextMenu &&
        createPortal(
          <div
            className='fixed z-[9999] bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl py-1 min-w-[160px]'
            style={{ left: contextMenu.x, top: contextMenu.y }}>
            <button
              className='w-full text-left py-1.5 px-3 text-sm text-neutral-200 hover:bg-neutral-700 cursor-pointer'
              onClick={handleFx}>
              FX / Shaders
            </button>
            <button
              className='w-full text-left py-1.5 px-3 text-sm text-neutral-200 hover:bg-neutral-700 cursor-pointer'
              onClick={handleMuteToggle}>
              {contextMenu.isMuted ? 'Unmute' : 'Mute'}
            </button>
            <button
              className='w-full text-left py-1.5 px-3 text-sm text-neutral-200 hover:bg-neutral-700 cursor-pointer text-red-400 hover:text-red-300'
              onClick={handleDelete}>
              Delete
            </button>
            {contextMenu.segmentId && (
              <>
                <div className='h-px bg-neutral-700 my-1' />
                <button
                  className='w-full text-left py-1.5 px-3 text-sm text-neutral-200 hover:bg-neutral-700 cursor-pointer'
                  onClick={handleSplitHere}>
                  Split Here
                </button>
                <button
                  className='w-full text-left py-1.5 px-3 text-sm text-neutral-200 hover:bg-neutral-700 cursor-pointer text-red-400 hover:text-red-300'
                  onClick={handleDeleteSegment}>
                  Delete Segment
                </button>
              </>
            )}
            <div className='h-px bg-neutral-700 my-1' />
            <button
              className='w-full text-left py-1.5 px-3 text-sm text-neutral-200 hover:bg-neutral-700 cursor-pointer'
              onClick={handleAddOrderKeyframe}>
              Add Order Keyframe
            </button>
          </div>,
          document.body,
        )}

      {/* Keyframe context menu */}
      {keyframeMenu &&
        createPortal(
          <div
            className='fixed z-[9999] bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl py-1 min-w-[160px]'
            style={{ left: keyframeMenu.x, top: keyframeMenu.y }}>
            <button
              className='w-full text-left py-1.5 px-3 text-sm text-red-400 hover:bg-neutral-700 hover:text-red-300 cursor-pointer'
              onClick={handleRemoveKeyframe}>
              Remove Keyframe
            </button>
          </div>,
          document.body,
        )}

      {/* Help dialog */}
      {showHelp &&
        createPortal(
          <div
            className='fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm'
            onClick={() => setShowHelp(false)}>
            <div
              className='bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl w-[520px] max-h-[80vh] overflow-y-auto'
              onClick={(e) => e.stopPropagation()}>
              <div className='flex items-center justify-between px-5 py-3 border-b border-neutral-800'>
                <h2 className='text-sm font-semibold text-neutral-200'>
                  Keyboard Shortcuts
                </h2>
                <button
                  className='p-1 rounded hover:bg-neutral-700 text-neutral-400 hover:text-white cursor-pointer'
                  onClick={() => setShowHelp(false)}>
                  <X className='w-4 h-4' />
                </button>
              </div>
              <div className='p-5 space-y-4 text-[13px]'>
                <ShortcutGroup
                  title='Playback & Navigation'
                  items={[
                    ['Space', 'Play / Stop'],
                    ['Home', 'Go to start'],
                    ['End', 'Go to end'],
                    ['← / →', 'Move playhead ±1s'],
                    ['Shift + ← / →', 'Move playhead ±5s'],
                    ['J / L', 'Jump to prev / next segment edge'],
                    ['F', 'Scroll view to playhead'],
                  ]}
                />
                <ShortcutGroup
                  title='Track Navigation'
                  items={[
                    ['↑ / ↓', 'Select prev / next track'],
                    ['Tab', 'Select next segment on track'],
                    ['Shift + Tab', 'Select prev segment on track'],
                  ]}
                />
                <ShortcutGroup
                  title='Segment Operations'
                  items={[
                    ['S', 'Split segment at playhead'],
                    ['D', 'Duplicate selected segment'],
                    ['M', 'Mute / Unmute selected track'],
                    ['Delete / Backspace', 'Delete selected segment'],
                    ['Alt + Click', 'Split segment at click position'],
                  ]}
                />
                <ShortcutGroup
                  title='Zoom'
                  items={[
                    ['+ / −', 'Zoom in / out'],
                    ['Ctrl + = / Ctrl + −', 'Zoom in / out'],
                    ['0', 'Auto-fit zoom to timeline'],
                  ]}
                />
                <ShortcutGroup
                  title='General'
                  items={[
                    ['Ctrl + Z', 'Undo'],
                    ['Ctrl + Shift + Z', 'Redo'],
                    ['Ctrl + Y', 'Redo'],
                    ['?', 'Toggle this help'],
                    ['Esc', 'Deselect / Close'],
                  ]}
                />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

// ── Help shortcut group ──────────────────────────────────

function ShortcutGroup({
  title,
  items,
}: {
  title: string;
  items: [string, string][];
}) {
  return (
    <div>
      <h3 className='text-[11px] text-neutral-500 uppercase tracking-wider font-medium mb-2'>
        {title}
      </h3>
      <div className='space-y-1'>
        {items.map(([key, desc]) => (
          <div key={key} className='flex items-center justify-between'>
            <span className='text-neutral-400'>{desc}</span>
            <kbd className='text-[11px] text-neutral-300 bg-neutral-800 border border-neutral-700 rounded px-1.5 py-0.5 font-mono min-w-[24px] text-center'>
              {key}
            </kbd>
          </div>
        ))}
      </div>
    </div>
  );
}
