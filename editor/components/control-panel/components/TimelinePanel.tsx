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
import { removeInput, type Input } from '@/app/actions/actions';
import type { InputWrapper } from '../hooks/use-control-panel-state';
import LoadingSpinner from '@/components/ui/spinner';
import { useControlPanelContext } from '../contexts/control-panel-context';
import { useTimelineState, DEFAULT_PPS } from '../hooks/use-timeline-state';
import { useTimelinePlayback } from '../hooks/use-timeline-playback';
import {
  Play,
  Square,
  SkipBack,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Crosshair,
  HelpCircle,
  X,
  Undo2,
  Redo2,
  Plus,
  Trash2,
  Pencil,
  Check,
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

/** Base HSL values per input type: [hue, saturation%, lightness%] */
const TYPE_HSL: Record<Input['type'], [number, number, number]> = {
  'twitch-channel': [271, 81, 56], // purple-500
  'kick-channel': [142, 71, 45], // green-500
  whip: [217, 91, 60], // blue-500
  'local-mp4': [25, 95, 53], // orange-500
  image: [48, 96, 53], // yellow-500
  'text-input': [330, 81, 60], // pink-500
};

const LIGHTNESS_STEP = 10;

/**
 * Build a per-inputId color map: inputs of the same type get the same hue
 * but shifted lightness so they are visually distinguishable.
 */
function buildInputColorMap(inputs: Input[]) {
  const countByType = new Map<Input['type'], number>();
  const map = new Map<
    string,
    { dot: string; segBg: string; segBorder: string; ring: string }
  >();

  for (const input of inputs) {
    const idx = countByType.get(input.type) ?? 0;
    countByType.set(input.type, idx + 1);

    const [h, s, baseL] = TYPE_HSL[input.type];
    const l = Math.min(
      85,
      Math.max(
        25,
        baseL + (idx % 2 === 0 ? 1 : -1) * Math.ceil(idx / 2) * LIGHTNESS_STEP,
      ),
    );

    map.set(input.inputId, {
      dot: `hsl(${h} ${s}% ${l}%)`,
      segBg: `hsla(${h}, ${s}%, ${l}%, 0.4)`,
      segBorder: `hsla(${h}, ${s}%, ${l}%, 0.6)`,
      ring: `hsla(${h}, ${s}%, ${Math.min(90, l + 10)}%, 0.7)`,
    });
  }
  return map;
}

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
  tracks: import('../hooks/use-timeline-state').Track[],
  excludeClipId: string,
  playheadMs: number,
): number[] {
  const targets: number[] = [0, playheadMs];
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (clip.id === excludeClipId) continue;
      targets.push(clip.startMs, clip.endMs);
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
    undo,
    redo,
    canUndo,
    canRedo,
    structureRevision,
  } = useTimelineState(roomId, inputs);

  const [selectedClipId, setSelectedClipId] = useState<{
    trackId: string;
    clipId: string;
  } | null>(null);

  useEffect(() => {
    const selected = selectedClipId
      ? state.tracks
          .find((track) => track.id === selectedClipId.trackId)
          ?.clips.find((clip) => clip.id === selectedClipId.clipId)
      : null;
    if (!selectedClipId || !selected) {
      window.dispatchEvent(
        new CustomEvent('smelter:timeline:selected-clip', {
          detail: { clip: null },
        }),
      );
      return;
    }
    window.dispatchEvent(
      new CustomEvent('smelter:timeline:selected-clip', {
        detail: {
          clip: {
            trackId: selectedClipId.trackId,
            clipId: selected.id,
            inputId: selected.inputId,
            startMs: selected.startMs,
            endMs: selected.endMs,
            blockSettings: selected.blockSettings,
          },
        },
      }),
    );
  }, [selectedClipId, state.tracks]);

  useEffect(() => {
    const handler = (
      e: CustomEvent<{
        trackId: string;
        clipId: string;
        patch: Partial<import('../hooks/use-timeline-state').BlockSettings>;
      }>,
    ) => {
      const { trackId, clipId, patch } = e.detail;
      updateClipSettings(trackId, clipId, patch);
    };
    window.addEventListener(
      'smelter:timeline:update-clip-settings',
      handler as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:timeline:update-clip-settings',
        handler as unknown as EventListener,
      );
    };
  }, [updateClipSettings]);

  // Listen for WHIP input connections to replace placeholder inputIds
  useEffect(() => {
    const handler = (e: Event) => {
      const { oldInputId, newInputId } = (e as CustomEvent).detail;
      replaceInputId(oldInputId, newInputId);
    };
    window.addEventListener('smelter:timeline-input-replaced', handler);
    return () =>
      window.removeEventListener('smelter:timeline-input-replaced', handler);
  }, [replaceInputId]);

  const inputColorMap = useMemo(() => buildInputColorMap(inputs), [inputs]);

  const { play, stop, seek, applyAtPlayhead } = useTimelinePlayback(
    roomId,
    inputs,
    state,
    setPlayhead,
    setPlaying,
    refreshState,
    structureRevision,
  );

  const [panelHeight, setPanelHeight] = useState(DEFAULT_HEIGHT);
  const resizingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    trackId: string;
    inputId: string;
    isMuted: boolean;
    clipId?: string;
    splitAtMs?: number;
  } | null>(null);

  const [showHelp, setShowHelp] = useState(false);
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [editingTrackLabel, setEditingTrackLabel] = useState('');
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);

  // ── Clip interaction refs ─────────────────────────
  const dragRef = useRef<{
    type: 'move' | 'resize-left' | 'resize-right';
    trackId: string;
    clipId: string;
    originX: number;
    originY: number;
    originStartMs: number;
    originEndMs: number;
  } | null>(null);

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

  const handleTrackClick = useCallback(
    (trackId: string) => {
      // Find the first clip on this track to select its input
      const track = state.tracks.find((t) => t.id === trackId);
      if (track && track.clips.length > 0) {
        window.dispatchEvent(
          new CustomEvent('smelter:inputs:select', {
            detail: { inputId: track.clips[0].inputId },
          }),
        );
      }
    },
    [state.tracks],
  );

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
      const ms = rulerPxToMs(e.clientX, e.currentTarget);
      if (state.isPlaying) {
        seek(ms);
      } else {
        setPlayhead(ms);
      }
    },
    [setPlayhead, rulerPxToMs, state.isPlaying, seek],
  );

  const handleRulerPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!rulerScrubRef.current) return;
      const ms = rulerPxToMs(e.clientX, e.currentTarget);
      if (state.isPlaying) {
        seek(ms);
      } else {
        setPlayhead(ms);
      }
    },
    [setPlayhead, rulerPxToMs, state.isPlaying, seek],
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

  // ── Navigate tracks ─────────────────────────────────

  const navigateTrack = useCallback(
    (direction: 'up' | 'down') => {
      const trackIds = state.tracks.map((t) => t.id);
      if (trackIds.length === 0) return;
      // Find current track index based on selectedClipId or selectedInputId
      let currentIdx = -1;
      if (selectedClipId) {
        currentIdx = trackIds.indexOf(selectedClipId.trackId);
      } else if (selectedInputId) {
        currentIdx = state.tracks.findIndex((t) =>
          t.clips.some((c) => c.inputId === selectedInputId),
        );
      }
      let nextIdx: number;
      if (direction === 'down') {
        nextIdx = currentIdx < trackIds.length - 1 ? currentIdx + 1 : 0;
      } else {
        nextIdx = currentIdx > 0 ? currentIdx - 1 : trackIds.length - 1;
      }
      const nextTrack = state.tracks[nextIdx];
      if (nextTrack && nextTrack.clips.length > 0) {
        window.dispatchEvent(
          new CustomEvent('smelter:inputs:select', {
            detail: { inputId: nextTrack.clips[0].inputId },
          }),
        );
      }
    },
    [state.tracks, selectedInputId, selectedClipId],
  );

  // ── Tab to next clip on current track ────────────

  const tabToNextClip = useCallback(
    (reverse: boolean) => {
      // Find the track to tab within
      let trackId: string | null = null;
      if (selectedClipId) {
        trackId = selectedClipId.trackId;
      } else if (selectedInputId) {
        const t = state.tracks.find((t) =>
          t.clips.some((c) => c.inputId === selectedInputId),
        );
        if (t) trackId = t.id;
      }
      if (!trackId) return;
      const track = state.tracks.find((t) => t.id === trackId);
      if (!track || track.clips.length === 0) return;
      const clips = track.clips;
      const currentIdx = selectedClipId
        ? clips.findIndex((c) => c.id === selectedClipId.clipId)
        : -1;
      let nextIdx: number;
      if (reverse) {
        nextIdx = currentIdx > 0 ? currentIdx - 1 : clips.length - 1;
      } else {
        nextIdx = currentIdx < clips.length - 1 ? currentIdx + 1 : 0;
      }
      const clip = clips[nextIdx];
      setSelectedClipId({
        trackId: track.id,
        clipId: clip.id,
      });
      setPlayhead(clip.startMs);
    },
    [selectedInputId, selectedClipId, state.tracks, setPlayhead],
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
          if (selectedClipId) {
            const clipId = findClipAtPlayhead(selectedClipId.trackId);
            if (clipId)
              splitClip(selectedClipId.trackId, clipId, state.playheadMs);
          }
          break;
        }
        case 'd':
        case 'D': {
          if (ctrl) break;
          e.preventDefault();
          if (selectedClipId) {
            duplicateClip(selectedClipId.trackId, selectedClipId.clipId);
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
          if (selectedClipId) {
            e.preventDefault();
            deleteClip(selectedClipId.trackId, selectedClipId.clipId);
            setSelectedClipId(null);
          }
          break;
        }
        case 'Tab': {
          e.preventDefault();
          tabToNextClip(shift);
          break;
        }
        case 'Escape': {
          setSelectedClipId(null);
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
    tabToNextClip,
    findClipAtPlayhead,
    splitClip,
    deleteClip,
    duplicateClip,
    undo,
    redo,
    selectedInputId,
    selectedClipId,
  ]);

  // ── Clip pointer interactions ─────────────────────

  const pxToMs = useCallback(
    (px: number) => (px / state.pixelsPerSecond) * 1000,
    [state.pixelsPerSecond],
  );

  const snapThresholdMs = useMemo(() => pxToMs(SNAP_THRESHOLD_PX), [pxToMs]);

  // ── Determine which track the pointer is over ────
  const getTrackIdAtY = useCallback(
    (clientY: number): string | null => {
      const container = scrollContainerRef.current;
      if (!container) return null;
      const containerRect = container.getBoundingClientRect();
      const scrollTop = container.scrollTop;
      const relativeY = clientY - containerRect.top + scrollTop;
      const trackIndex = Math.floor(relativeY / TRACK_HEIGHT);
      if (trackIndex >= 0 && trackIndex < state.tracks.length) {
        return state.tracks[trackIndex].id;
      }
      return null;
    },
    [state.tracks],
  );

  const handleClipPointerDown = useCallback(
    (
      e: React.PointerEvent<HTMLDivElement>,
      trackId: string,
      clipId: string,
      clipStartMs: number,
      clipEndMs: number,
    ) => {
      // Alt+Click = split
      if (e.altKey) {
        const rect = e.currentTarget.parentElement!.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const atMs = Math.round(pxToMs(x));
        splitClip(trackId, clipId, atMs);
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      // Track clip selection
      setSelectedClipId({ trackId, clipId });

      const rect = e.currentTarget.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const clipWidthPx = rect.width;

      let type: 'move' | 'resize-left' | 'resize-right' = 'move';
      if (localX <= RESIZE_HANDLE_PX) {
        type = 'resize-left';
      } else if (localX >= clipWidthPx - RESIZE_HANDLE_PX) {
        type = 'resize-right';
      }

      dragRef.current = {
        type,
        trackId,
        clipId,
        originX: e.clientX,
        originY: e.clientY,
        originStartMs: clipStartMs,
        originEndMs: clipEndMs,
      };

      document.body.style.userSelect = 'none';
    },
    [pxToMs, splitClip],
  );

  // Use document-level listeners for drag so we can detect cross-track movement
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      const deltaX = e.clientX - drag.originX;
      const deltaMs = pxToMs(deltaX);

      const snapTargets = computeSnapTargets(
        state.tracks,
        drag.clipId,
        state.playheadMs,
      );

      if (drag.type === 'move') {
        let newStart = Math.round(drag.originStartMs + deltaMs);
        newStart = snapToNearest(newStart, snapTargets, snapThresholdMs);
        const duration = drag.originEndMs - drag.originStartMs;
        const snappedEnd = snapToNearest(
          newStart + duration,
          snapTargets,
          snapThresholdMs,
        );
        if (snappedEnd !== newStart + duration) {
          newStart = snappedEnd - duration;
        }

        // Detect cross-track movement
        const targetTrackId = getTrackIdAtY(e.clientY);
        if (targetTrackId && targetTrackId !== drag.trackId) {
          moveClipToTrack(drag.trackId, drag.clipId, targetTrackId, newStart);
          drag.trackId = targetTrackId;
        } else {
          moveClip(drag.trackId, drag.clipId, newStart);
        }
      } else if (drag.type === 'resize-left') {
        let newStart = Math.round(drag.originStartMs + deltaMs);
        newStart = snapToNearest(newStart, snapTargets, snapThresholdMs);
        resizeClip(drag.trackId, drag.clipId, 'left', newStart);
      } else {
        let newEnd = Math.round(drag.originEndMs + deltaMs);
        newEnd = snapToNearest(newEnd, snapTargets, snapThresholdMs);
        resizeClip(drag.trackId, drag.clipId, 'right', newEnd);
      }
    };

    const handlePointerUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        document.body.style.userSelect = '';
      }
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
    state.playheadMs,
    snapThresholdMs,
    moveClip,
    resizeClip,
    moveClipToTrack,
    getTrackIdAtY,
  ]);

  const handleClipHover = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragRef.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const localX = e.clientX - rect.left;
      const w = rect.width;
      if (localX <= RESIZE_HANDLE_PX || localX >= w - RESIZE_HANDLE_PX) {
        e.currentTarget.style.cursor = 'col-resize';
      } else {
        e.currentTarget.style.cursor = 'grab';
      }
    },
    [],
  );

  // ── Context menu ─────────────────────────────────────

  const handleContextMenu = useCallback(
    (e: ReactMouseEvent, trackId: string, inputId: string, clipId?: string) => {
      e.preventDefault();
      const input = inputs.find((i) => i.inputId === inputId);

      let splitAtMs: number | undefined;
      if (clipId) {
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
        trackId,
        inputId,
        isMuted: input ? input.volume === 0 : false,
        clipId,
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

  const handleHardDelete = useCallback(async () => {
    if (!contextMenu) return;
    const input = inputs.find((i) => i.inputId === contextMenu.inputId);
    const label = input?.title ?? contextMenu.inputId;
    const confirmed = window.confirm(
      `Permanently delete input "${label}"? This will remove it from the server and all timeline tracks.`,
    );
    if (!confirmed) return;
    closeContextMenu();
    await removeInput(roomId, contextMenu.inputId);
    await refreshState();
  }, [contextMenu, inputs, roomId, refreshState, closeContextMenu]);

  const handleSplitHere = useCallback(() => {
    if (contextMenu?.clipId && contextMenu.splitAtMs !== undefined) {
      splitClip(contextMenu.trackId, contextMenu.clipId, contextMenu.splitAtMs);
    }
    closeContextMenu();
  }, [contextMenu, splitClip, closeContextMenu]);

  const handleDeleteClip = useCallback(() => {
    if (contextMenu?.clipId) {
      deleteClip(contextMenu.trackId, contextMenu.clipId);
    }
    closeContextMenu();
  }, [contextMenu, deleteClip, closeContextMenu]);

  // ── Render helpers ───────────────────────────────────

  const renderClips = useCallback(
    (track: import('../hooks/use-timeline-state').Track) => {
      return track.clips.map((clip) => {
        const input = inputs.find((i) => i.inputId === clip.inputId);
        const colors = inputColorMap.get(clip.inputId);
        const leftPx = (clip.startMs / 1000) * state.pixelsPerSecond;
        const widthPx =
          ((clip.endMs - clip.startMs) / 1000) * state.pixelsPerSecond;
        const isClipSelected =
          selectedClipId?.trackId === track.id &&
          selectedClipId?.clipId === clip.id;
        const durationMs = clip.endMs - clip.startMs;
        const clipLabel = input?.title ?? clip.inputId;

        return (
          <div
            key={clip.id}
            data-no-dnd='true'
            className={`absolute top-1 bottom-1 rounded-sm border ${isClipSelected ? 'ring-2 brightness-125' : ''} flex items-center overflow-hidden touch-none`}
            style={{
              left: leftPx,
              width: Math.max(widthPx, 2),
              cursor: 'grab',
              backgroundColor: colors?.segBg,
              borderColor: colors?.segBorder,
              ...(isClipSelected
                ? { boxShadow: `0 0 0 2px ${colors?.ring ?? 'transparent'}` }
                : {}),
            }}
            title={`${clipLabel}: ${formatMs(clip.startMs)} → ${formatMs(clip.endMs)} (${formatMs(durationMs)})`}
            onPointerDown={(e) =>
              handleClipPointerDown(
                e,
                track.id,
                clip.id,
                clip.startMs,
                clip.endMs,
              )
            }
            onPointerMove={handleClipHover}
            onContextMenu={(e) => {
              e.stopPropagation();
              handleContextMenu(e, track.id, clip.inputId, clip.id);
            }}>
            {/* Left resize handle */}
            <div className='absolute left-0 top-0 bottom-0 w-[5px] cursor-col-resize z-10' />
            {/* Right resize handle */}
            <div className='absolute right-0 top-0 bottom-0 w-[5px] cursor-col-resize z-10' />
            {/* Label */}
            {widthPx > 40 && (
              <span className='text-[10px] text-neutral-300/80 truncate px-2 select-none pointer-events-none'>
                {clipLabel}
              </span>
            )}
          </div>
        );
      });
    },
    [
      inputs,
      inputColorMap,
      state.pixelsPerSecond,
      selectedClipId,
      handleClipPointerDown,
      handleClipHover,
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
          className='p-1 rounded hover:bg-neutral-700 text-neutral-400 hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'
          onClick={() => setPlayhead(0)}
          disabled={state.isPlaying}
          title='Skip to beginning'>
          <SkipBack className='w-3.5 h-3.5' />
        </button>
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
          state.tracks.map((track) => {
            // Determine a representative input for the track label color
            const firstClipInputId =
              track.clips.length > 0 ? track.clips[0].inputId : undefined;
            const firstClipInput = firstClipInputId
              ? inputs.find((i) => i.inputId === firstClipInputId)
              : undefined;
            const trackDotColor = firstClipInputId
              ? inputColorMap.get(firstClipInputId)?.dot
              : undefined;
            const isEditing = editingTrackId === track.id;

            return (
              <div
                key={track.id}
                className='flex border-b border-neutral-800/50 cursor-pointer group/track'
                style={{ height: TRACK_HEIGHT }}
                onClick={() => handleTrackClick(track.id)}
                onContextMenu={(e) => {
                  const inputId = firstClipInput?.inputId ?? '';
                  handleContextMenu(e, track.id, inputId);
                }}>
                {/* Track label (sticky left) */}
                <div
                  className='shrink-0 bg-neutral-900 flex items-center gap-1.5 px-2 sticky left-0 z-10'
                  style={{ width: SOURCES_WIDTH }}>
                  <div
                    className='w-2.5 h-2.5 rounded-full shrink-0'
                    style={{ backgroundColor: trackDotColor ?? '#737373' }}
                  />
                  {isEditing ? (
                    <input
                      autoFocus
                      className='text-sm text-neutral-200 bg-neutral-800 border border-neutral-600 rounded px-1 py-0.5 flex-1 min-w-0 outline-none focus:border-blue-500'
                      value={editingTrackLabel}
                      onChange={(e) => setEditingTrackLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const trimmed = editingTrackLabel.trim();
                          if (trimmed) renameTrack(track.id, trimmed);
                          setEditingTrackId(null);
                        } else if (e.key === 'Escape') {
                          setEditingTrackId(null);
                        }
                      }}
                      onBlur={() => {
                        const trimmed = editingTrackLabel.trim();
                        if (trimmed) renameTrack(track.id, trimmed);
                        setEditingTrackId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      className='text-sm text-neutral-200 truncate flex-1'
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditingTrackId(track.id);
                        setEditingTrackLabel(track.label);
                      }}>
                      {track.label}
                    </span>
                  )}
                  {!isEditing && (
                    <div className='flex items-center gap-0.5 opacity-0 group-hover/track:opacity-100 transition-opacity'>
                      <button
                        className='p-0.5 rounded hover:bg-neutral-700 text-neutral-500 hover:text-neutral-300 cursor-pointer'
                        title='Rename track'
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingTrackId(track.id);
                          setEditingTrackLabel(track.label);
                        }}>
                        <Pencil className='w-3 h-3' />
                      </button>
                      <button
                        className='p-0.5 rounded hover:bg-neutral-700 text-neutral-500 hover:text-red-400 cursor-pointer'
                        title='Delete track'
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteTrack(track.id);
                        }}>
                        <Trash2 className='w-3 h-3' />
                      </button>
                    </div>
                  )}
                </div>
                {/* Track timeline area */}
                <div
                  className='relative'
                  style={{
                    width: timelineWidthPx,
                    minWidth: `calc(100% - ${SOURCES_WIDTH}px)`,
                  }}>
                  {renderClips(track)}
                  {/* Playhead line on track */}
                  <div
                    className='absolute top-0 bottom-0 w-px bg-red-500/50 z-10 pointer-events-none'
                    style={{ left: playheadPx }}
                  />
                </div>
              </div>
            );
          })
        )}

        {/* Add Track button */}
        {!showStreamsSpinner && (
          <div
            className='flex border-b border-neutral-800/50'
            style={{ height: TRACK_HEIGHT }}>
            <div
              className='shrink-0 bg-neutral-900 flex items-center px-2 sticky left-0 z-10'
              style={{ width: SOURCES_WIDTH }}>
              <button
                className='flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 rounded px-2 py-1 cursor-pointer transition-colors'
                onClick={() => addTrack()}
                title='Add empty track'>
                <Plus className='w-3 h-3' />
                <span>Add Track</span>
              </button>
            </div>
          </div>
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
            <button
              className='w-full text-left py-1.5 px-3 text-sm hover:bg-neutral-700 cursor-pointer text-red-500 hover:text-red-400 font-semibold'
              onClick={handleHardDelete}>
              Hard Delete (remove input)
            </button>
            {contextMenu.clipId && (
              <>
                <div className='h-px bg-neutral-700 my-1' />
                <button
                  className='w-full text-left py-1.5 px-3 text-sm text-neutral-200 hover:bg-neutral-700 cursor-pointer'
                  onClick={handleSplitHere}>
                  Split Here
                </button>
                <button
                  className='w-full text-left py-1.5 px-3 text-sm text-neutral-200 hover:bg-neutral-700 cursor-pointer text-red-400 hover:text-red-300'
                  onClick={handleDeleteClip}>
                  Delete Clip
                </button>
              </>
            )}
            <div className='h-px bg-neutral-700 my-1' />
            <button
              className='w-full text-left py-1.5 px-3 text-sm text-neutral-200 hover:bg-neutral-700 cursor-pointer'
              onClick={() => {
                setEditingTrackId(contextMenu.trackId);
                const track = state.tracks.find(
                  (t) => t.id === contextMenu.trackId,
                );
                setEditingTrackLabel(track?.label ?? '');
                closeContextMenu();
              }}>
              Rename Track
            </button>
            <button
              className='w-full text-left py-1.5 px-3 text-sm text-red-400 hover:bg-neutral-700 hover:text-red-300 cursor-pointer'
              onClick={() => {
                deleteTrack(contextMenu.trackId);
                closeContextMenu();
              }}>
              Delete Track
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
