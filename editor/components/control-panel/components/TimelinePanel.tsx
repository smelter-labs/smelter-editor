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
import type { Input } from '@/lib/types';
import { useActions } from '../contexts/actions-context';
import { useRecordingControls } from '../hooks/use-recording-controls';
import type { InputWrapper } from '../hooks/use-control-panel-state';
import LoadingSpinner from '@/components/ui/spinner';
import { useControlPanelContext } from '../contexts/control-panel-context';
import { useTimelineState, DEFAULT_PPS } from '../hooks/use-timeline-state';
import { useServerTimelinePlayback } from '../hooks/use-server-timeline-playback';
import {
  Play,
  Pause,
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
  Zap,
} from 'lucide-react';
import { freezeRoom, unfreezeRoom } from '@/app/actions/actions';

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
  fillContainer?: boolean;
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
  game: [0, 72, 51], // red-500
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
const DEFAULT_HEIGHT = 250;
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

// ── Overlap check ────────────────────────────────────────

function hasOverlapOnTrack(
  clips: import('../hooks/use-timeline-state').Clip[],
  excludeClipId: string,
  startMs: number,
  endMs: number,
): boolean {
  return clips.some(
    (c) => c.id !== excludeClipId && startMs < c.endMs && endMs > c.startMs,
  );
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
  fillContainer,
}: TimelinePanelProps) {
  const { removeInput } = useActions();
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
    purgeInputId,
    moveClips,
    deleteClips,
    undo,
    redo,
    canUndo,
    canRedo,
    structureRevision,
  } = useTimelineState(roomId, inputs);

  const [selectedClipIds, setSelectedClipIds] = useState<
    { trackId: string; clipId: string }[]
  >([]);
  const lastClickedClipRef = useRef<{ trackId: string; clipId: string } | null>(
    null,
  );

  const selectedClipIdSet = useMemo(
    () => new Set(selectedClipIds.map((s) => s.clipId)),
    [selectedClipIds],
  );

  const selectClip = useCallback(
    (trackId: string, clipId: string, mode: 'replace' | 'toggle' | 'range') => {
      if (mode === 'replace') {
        setSelectedClipIds([{ trackId, clipId }]);
        lastClickedClipRef.current = { trackId, clipId };
      } else if (mode === 'toggle') {
        setSelectedClipIds((prev) => {
          const exists = prev.some(
            (s) => s.trackId === trackId && s.clipId === clipId,
          );
          if (exists) {
            return prev.filter(
              (s) => !(s.trackId === trackId && s.clipId === clipId),
            );
          }
          return [...prev, { trackId, clipId }];
        });
        lastClickedClipRef.current = { trackId, clipId };
      } else {
        // range: select all clips between lastClicked and this one on the same track
        const anchor = lastClickedClipRef.current;
        if (!anchor || anchor.trackId !== trackId) {
          setSelectedClipIds([{ trackId, clipId }]);
          lastClickedClipRef.current = { trackId, clipId };
          return;
        }
        const track = state.tracks.find((t) => t.id === trackId);
        if (!track) return;
        const anchorIdx = track.clips.findIndex((c) => c.id === anchor.clipId);
        const targetIdx = track.clips.findIndex((c) => c.id === clipId);
        if (anchorIdx < 0 || targetIdx < 0) {
          setSelectedClipIds([{ trackId, clipId }]);
          lastClickedClipRef.current = { trackId, clipId };
          return;
        }
        const lo = Math.min(anchorIdx, targetIdx);
        const hi = Math.max(anchorIdx, targetIdx);
        const rangeClips = track.clips.slice(lo, hi + 1).map((c) => ({
          trackId,
          clipId: c.id,
        }));
        setSelectedClipIds((prev) => {
          const otherTracks = prev.filter((s) => s.trackId !== trackId);
          return [...otherTracks, ...rangeClips];
        });
      }
    },
    [state.tracks],
  );

  useEffect(() => {
    const resolvedClips = selectedClipIds
      .map((sel) => {
        const track = state.tracks.find((t) => t.id === sel.trackId);
        const clip = track?.clips.find((c) => c.id === sel.clipId);
        if (!track || !clip) return null;
        return {
          trackId: sel.trackId,
          clipId: clip.id,
          inputId: clip.inputId,
          startMs: clip.startMs,
          endMs: clip.endMs,
          blockSettings: clip.blockSettings,
        };
      })
      .filter(Boolean);
    window.dispatchEvent(
      new CustomEvent('smelter:timeline:selected-clip', {
        detail: { clips: resolvedClips },
      }),
    );
  }, [selectedClipIds, state.tracks]);

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

  // Listen for input-level clip settings updates (e.g. from voice macros)
  useEffect(() => {
    const handler = (
      e: CustomEvent<{
        inputId: string;
        patch: Partial<import('../hooks/use-timeline-state').BlockSettings>;
      }>,
    ) => {
      const { inputId, patch } = e.detail;
      for (const track of state.tracks) {
        for (const clip of track.clips) {
          if (clip.inputId === inputId) {
            updateClipSettings(track.id, clip.id, patch);
          }
        }
      }
    };
    window.addEventListener(
      'smelter:timeline:update-clip-settings-for-input',
      handler as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:timeline:update-clip-settings-for-input',
        handler as unknown as EventListener,
      );
    };
  }, [state.tracks, updateClipSettings]);

  // Listen for bulk hard-deletes and purge all related clips from timeline.
  useEffect(() => {
    const handler = (e: CustomEvent<{ inputIds?: string[] }>) => {
      const ids = e.detail?.inputIds ?? [];
      const uniqueIds = [...new Set(ids.filter(Boolean))];
      for (const inputId of uniqueIds) {
        purgeInputId(inputId);
      }
    };
    window.addEventListener(
      'smelter:timeline:purge-input-ids',
      handler as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:timeline:purge-input-ids',
        handler as unknown as EventListener,
      );
    };
  }, [purgeInputId]);

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

  // Inward event: external code (voice, control-panel) can request a clip selection
  useEffect(() => {
    const handler = (
      e: CustomEvent<{
        inputId?: string;
        trackIndex?: number;
        trackId?: string;
        clipId?: string;
      } | null>,
    ) => {
      const detail = e.detail;
      if (!detail) {
        setSelectedClipIds([]);
        return;
      }

      if (detail.trackId && detail.clipId) {
        setSelectedClipIds([
          { trackId: detail.trackId, clipId: detail.clipId },
        ]);
        return;
      }

      if (detail.trackIndex != null) {
        const idx = detail.trackIndex - 1;
        if (idx < 0 || idx >= state.tracks.length) return;
        const track = state.tracks[idx];
        if (track.clips.length > 0) {
          setSelectedClipIds([
            { trackId: track.id, clipId: track.clips[0].id },
          ]);
          setPlayhead(track.clips[0].startMs);
        }
        return;
      }

      if (detail.inputId) {
        for (const track of state.tracks) {
          for (const clip of track.clips) {
            if (clip.inputId === detail.inputId) {
              setSelectedClipIds([{ trackId: track.id, clipId: clip.id }]);
              setPlayhead(clip.startMs);
              return;
            }
          }
        }
      }
    };
    window.addEventListener(
      'smelter:timeline:select-clip',
      handler as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:timeline:select-clip',
        handler as unknown as EventListener,
      );
    };
  }, [state.tracks, setPlayhead]);

  const inputColorMap = useMemo(() => buildInputColorMap(inputs), [inputs]);

  const { play, stop, applyAtPlayhead } = useServerTimelinePlayback(
    roomId,
    state,
    setPlayhead,
    setPlaying,
  );

  const { isRecording: serverIsRecording, isFrozen: serverIsFrozen } =
    useControlPanelContext();
  const {
    isTogglingRecording,
    effectiveIsRecording: isRecording,
    start: startRec,
    stopAndDownload,
  } = useRecordingControls(roomId, serverIsRecording, refreshState);
  const wasPlayingRef = useRef(false);

  const [frozen, setFrozen] = useState(serverIsFrozen);
  const [freezeLoading, setFreezeLoading] = useState(false);

  useEffect(() => {
    setFrozen(serverIsFrozen);
  }, [serverIsFrozen]);

  const handleTurboPause = useCallback(async () => {
    if (freezeLoading) return;
    setFreezeLoading(true);
    try {
      if (frozen) {
        await unfreezeRoom(roomId);
        setFrozen(false);
      } else {
        if (state.isPlaying) {
          stop();
        }
        await freezeRoom(roomId);
        setFrozen(true);
      }
    } catch (err) {
      console.error('TURBOPAUZA failed', err);
    } finally {
      setFreezeLoading(false);
    }
  }, [frozen, freezeLoading, roomId, state.isPlaying, stop]);

  const handleRecordAndPlay = useCallback(async () => {
    if (isTogglingRecording) return;
    if (isRecording) {
      stop();
      await stopAndDownload();
      return;
    }
    const started = await startRec();
    if (started) {
      play();
    }
  }, [isRecording, isTogglingRecording, play, stop, startRec, stopAndDownload]);

  useEffect(() => {
    if (wasPlayingRef.current && !state.isPlaying && isRecording) {
      void stopAndDownload();
    }
    wasPlayingRef.current = state.isPlaying;
  }, [state.isPlaying, isRecording, stopAndDownload]);

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
  const [invalidDropTrackId, setInvalidDropTrackId] = useState<string | null>(
    null,
  );
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);

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
        stop();
      }
      setPlayhead(ms);
    },
    [setPlayhead, rulerPxToMs, state.isPlaying, stop],
  );

  const handleRulerPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!rulerScrubRef.current) return;
      const ms = rulerPxToMs(e.clientX, e.currentTarget);
      if (state.isPlaying) {
        stop();
      }
      setPlayhead(ms);
    },
    [setPlayhead, rulerPxToMs, state.isPlaying, stop],
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
      let currentIdx = -1;
      if (selectedClipIds.length > 0) {
        currentIdx = trackIds.indexOf(selectedClipIds[0].trackId);
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
    [state.tracks, selectedInputId, selectedClipIds],
  );

  // ── Tab to next clip on current track ────────────

  const tabToNextClip = useCallback(
    (reverse: boolean) => {
      let trackId: string | null = null;
      const primarySel = selectedClipIds.length > 0 ? selectedClipIds[0] : null;
      if (primarySel) {
        trackId = primarySel.trackId;
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
      const currentIdx = primarySel
        ? clips.findIndex((c) => c.id === primarySel.clipId)
        : -1;
      let nextIdx: number;
      if (reverse) {
        nextIdx = currentIdx > 0 ? currentIdx - 1 : clips.length - 1;
      } else {
        nextIdx = currentIdx < clips.length - 1 ? currentIdx + 1 : 0;
      }
      const clip = clips[nextIdx];
      setSelectedClipIds([{ trackId: track.id, clipId: clip.id }]);
      setPlayhead(clip.startMs);
    },
    [selectedInputId, selectedClipIds, state.tracks, setPlayhead],
  );

  // ── Voice: select track / remove track / next-prev block ──────────

  useEffect(() => {
    const onSelectTrack = (e: CustomEvent<{ trackIndex: number }>) => {
      const idx = e.detail.trackIndex - 1;
      if (idx < 0 || idx >= state.tracks.length) {
        console.warn(`Voice: track ${e.detail.trackIndex} does not exist`);
        return;
      }
      const track = state.tracks[idx];
      if (track.clips.length > 0) {
        setSelectedClipIds([{ trackId: track.id, clipId: track.clips[0].id }]);
        setPlayhead(track.clips[0].startMs);
        window.dispatchEvent(
          new CustomEvent('smelter:inputs:select', {
            detail: { inputId: track.clips[0].inputId },
          }),
        );
      }
    };

    const onRemoveTrack = (e: CustomEvent<{ trackIndex: number }>) => {
      const idx = e.detail.trackIndex - 1;
      if (idx < 0 || idx >= state.tracks.length) {
        console.warn(`Voice: track ${e.detail.trackIndex} does not exist`);
        return;
      }
      deleteTrack(state.tracks[idx].id);
    };

    const onNextBlock = () => tabToNextClip(false);
    const onPrevBlock = () => tabToNextClip(true);

    window.addEventListener(
      'smelter:voice:select-track',
      onSelectTrack as unknown as EventListener,
    );
    window.addEventListener(
      'smelter:voice:remove-track',
      onRemoveTrack as unknown as EventListener,
    );
    window.addEventListener('smelter:voice:next-block', onNextBlock);
    window.addEventListener('smelter:voice:prev-block', onPrevBlock);

    return () => {
      window.removeEventListener(
        'smelter:voice:select-track',
        onSelectTrack as unknown as EventListener,
      );
      window.removeEventListener(
        'smelter:voice:remove-track',
        onRemoveTrack as unknown as EventListener,
      );
      window.removeEventListener('smelter:voice:next-block', onNextBlock);
      window.removeEventListener('smelter:voice:prev-block', onPrevBlock);
    };
  }, [state.tracks, setPlayhead, tabToNextClip, deleteTrack]);

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
        case 'a':
        case 'A': {
          if (!ctrl) break;
          e.preventDefault();
          const all: { trackId: string; clipId: string }[] = [];
          for (const track of state.tracks) {
            for (const clip of track.clips) {
              all.push({ trackId: track.id, clipId: clip.id });
            }
          }
          setSelectedClipIds(all);
          break;
        }
        case 's':
        case 'S': {
          if (ctrl) break;
          e.preventDefault();
          if (selectedClipIds.length === 1) {
            const sel = selectedClipIds[0];
            const clipId = findClipAtPlayhead(sel.trackId);
            if (clipId) splitClip(sel.trackId, clipId, state.playheadMs);
          }
          break;
        }
        case 'd':
        case 'D': {
          if (ctrl) break;
          e.preventDefault();
          if (selectedClipIds.length === 1) {
            duplicateClip(
              selectedClipIds[0].trackId,
              selectedClipIds[0].clipId,
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
          if (selectedClipIds.length > 0) {
            e.preventDefault();
            if (selectedClipIds.length === 1) {
              deleteClip(selectedClipIds[0].trackId, selectedClipIds[0].clipId);
            } else {
              deleteClips(selectedClipIds);
            }
            setSelectedClipIds([]);
          }
          break;
        }
        case 'Tab': {
          e.preventDefault();
          tabToNextClip(shift);
          break;
        }
        case 'Escape': {
          setSelectedClipIds([]);
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
    state.tracks,
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
    deleteClips,
    duplicateClip,
    undo,
    redo,
    selectedInputId,
    selectedClipIds,
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
      introTransitionMs: number,
      outroTransitionMs: number,
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

  // Use document-level listeners for drag so we can detect cross-track movement
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
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
        if (drag.multiClips && drag.multiClips.length > 1) {
          // Multi-clip move: compute delta via primary clip snap, apply to all
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
        newStart = snapToNearest(newStart, snapTargets, snapThresholdMs);
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
        newEnd = snapToNearest(newEnd, snapTargets, snapThresholdMs);
        resizeClip(drag.trackId, drag.clipId, 'right', newEnd);
      }
    };

    const handlePointerUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
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
    state.playheadMs,
    snapThresholdMs,
    moveClip,
    moveClips,
    resizeClip,
    moveClipToTrack,
    getTrackIdAtY,
    updateClipSettings,
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
        new CustomEvent('smelter:inputs:hide', {
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
    purgeInputId(contextMenu.inputId);
    await refreshState();
  }, [
    contextMenu,
    inputs,
    roomId,
    refreshState,
    closeContextMenu,
    purgeInputId,
  ]);

  const handleSplitHere = useCallback(() => {
    if (contextMenu?.clipId && contextMenu.splitAtMs !== undefined) {
      splitClip(contextMenu.trackId, contextMenu.clipId, contextMenu.splitAtMs);
    }
    closeContextMenu();
  }, [contextMenu, splitClip, closeContextMenu]);

  const handleDeleteClip = useCallback(() => {
    if (selectedClipIds.length > 1) {
      deleteClips(selectedClipIds);
      setSelectedClipIds([]);
    } else if (contextMenu?.clipId) {
      deleteClip(contextMenu.trackId, contextMenu.clipId);
      setSelectedClipIds([]);
    }
    closeContextMenu();
  }, [contextMenu, deleteClip, deleteClips, selectedClipIds, closeContextMenu]);

  // ── Render helpers ───────────────────────────────────

  const renderClips = useCallback(
    (track: import('../hooks/use-timeline-state').Track) => {
      return track.clips.map((clip) => {
        const input = inputs.find((i) => i.inputId === clip.inputId);
        const isDisconnected =
          !input && !clip.inputId.startsWith('__pending-whip-');
        const colors = inputColorMap.get(clip.inputId);
        const disconnectedBg = isDisconnected
          ? 'hsla(0, 0%, 45%, 0.25)'
          : undefined;
        const disconnectedBorder = isDisconnected
          ? 'hsla(0, 0%, 55%, 0.4)'
          : undefined;
        const disconnectedRing = isDisconnected
          ? 'hsla(0, 0%, 60%, 0.5)'
          : undefined;
        const leftPx = (clip.startMs / 1000) * state.pixelsPerSecond;
        const widthPx =
          ((clip.endMs - clip.startMs) / 1000) * state.pixelsPerSecond;
        const isClipSelected = selectedClipIdSet.has(clip.id);
        const durationMs = clip.endMs - clip.startMs;
        const clipLabel = input?.title ?? clip.inputId;

        const introT = clip.blockSettings.introTransition;
        const outroT = clip.blockSettings.outroTransition;
        const introWidthPx = introT
          ? (introT.durationMs / 1000) * state.pixelsPerSecond
          : 0;
        const outroWidthPx = outroT
          ? (outroT.durationMs / 1000) * state.pixelsPerSecond
          : 0;

        return (
          <div
            key={clip.id}
            data-no-dnd='true'
            className={`absolute top-1 bottom-1 rounded-sm border ${isClipSelected ? 'ring-2 brightness-125' : ''} ${isDisconnected ? 'opacity-60' : ''} flex items-center overflow-hidden touch-none`}
            style={{
              left: leftPx,
              width: Math.max(widthPx, 2),
              cursor: 'grab',
              backgroundColor: colors?.segBg ?? disconnectedBg,
              borderColor: colors?.segBorder ?? disconnectedBorder,
              borderStyle: isDisconnected ? 'dashed' : undefined,
              ...(isClipSelected
                ? {
                    boxShadow: `0 0 0 2px ${colors?.ring ?? disconnectedRing ?? 'transparent'}`,
                  }
                : {}),
              ...(isDisconnected
                ? {
                    backgroundImage:
                      'repeating-linear-gradient(135deg, transparent, transparent 4px, hsla(0,0%,50%,0.15) 4px, hsla(0,0%,50%,0.15) 8px)',
                  }
                : {}),
            }}
            title={
              isDisconnected
                ? `[Disconnected] ${clipLabel}: ${formatMs(clip.startMs)} → ${formatMs(clip.endMs)} (${formatMs(durationMs)})`
                : `${clipLabel}: ${formatMs(clip.startMs)} → ${formatMs(clip.endMs)} (${formatMs(durationMs)})`
            }
            onPointerDown={(e) =>
              handleClipPointerDown(
                e,
                track.id,
                clip.id,
                clip.startMs,
                clip.endMs,
                introT?.durationMs ?? 0,
                outroT?.durationMs ?? 0,
              )
            }
            onPointerMove={(e) =>
              handleClipHover(
                e,
                introT?.durationMs ?? 0,
                outroT?.durationMs ?? 0,
              )
            }
            onContextMenu={(e) => {
              e.stopPropagation();
              handleContextMenu(e, track.id, clip.inputId, clip.id);
            }}>
            {/* Left resize handle */}
            <div className='absolute left-0 top-0 bottom-0 w-[5px] cursor-col-resize z-10' />
            {/* Right resize handle */}
            <div className='absolute right-0 top-0 bottom-0 w-[5px] cursor-col-resize z-10' />
            {/* Intro transition zone */}
            {introWidthPx > 0 && (
              <>
                <div
                  className='absolute top-0 bottom-0 left-0 pointer-events-none z-[5]'
                  style={{
                    width: introWidthPx,
                    background:
                      'linear-gradient(to right, rgba(255,255,255,0.25), transparent)',
                  }}
                />
                <div
                  className='absolute top-0 bottom-0 z-[6] cursor-ew-resize'
                  style={{
                    left: introWidthPx - 2,
                    width: 4,
                    backgroundColor: 'rgba(255,255,255,0.4)',
                  }}
                />
              </>
            )}
            {/* Outro transition zone */}
            {outroWidthPx > 0 && (
              <>
                <div
                  className='absolute top-0 bottom-0 right-0 pointer-events-none z-[5]'
                  style={{
                    width: outroWidthPx,
                    background:
                      'linear-gradient(to left, rgba(255,255,255,0.25), transparent)',
                  }}
                />
                <div
                  className='absolute top-0 bottom-0 z-[6] cursor-ew-resize'
                  style={{
                    right: outroWidthPx - 2,
                    width: 4,
                    backgroundColor: 'rgba(255,255,255,0.4)',
                  }}
                />
              </>
            )}
            {/* Label */}
            {widthPx > 40 && (
              <span
                className={`text-[10px] truncate px-2 select-none pointer-events-none ${isDisconnected ? 'text-neutral-400/70 italic' : 'text-neutral-300/80'}`}>
                {isDisconnected ? `[Disconnected] ${clipLabel}` : clipLabel}
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
      selectedClipIdSet,
      handleClipPointerDown,
      handleClipHover,
      handleContextMenu,
    ],
  );

  return (
    <div
      className={`relative flex flex-col bg-neutral-950 ${fillContainer ? 'h-full' : 'border-t border-neutral-800'}`}
      style={fillContainer ? undefined : { height: panelHeight }}>
      {!fillContainer && (
        <div
          className='h-1 w-full cursor-ns-resize hover:bg-neutral-700 transition-colors shrink-0'
          onMouseDown={handleResizeStart}
        />
      )}

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
          onClick={state.isPlaying ? stop : play}
          title={state.isPlaying ? 'Pause' : 'Play'}>
          {state.isPlaying ? (
            <Pause className='w-3.5 h-3.5' />
          ) : (
            <Play className='w-3.5 h-3.5' />
          )}
        </button>
        <button
          className={`p-1 rounded hover:bg-neutral-700 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${isRecording ? 'animate-pulse' : ''}`}
          onClick={handleRecordAndPlay}
          disabled={isTogglingRecording}
          title={isRecording ? 'Stop recording' : 'Record & Play'}>
          <div className='w-3.5 h-3.5 flex items-center justify-center'>
            {isRecording ? (
              <div className='w-2.5 h-2.5 rounded-full bg-red-500' />
            ) : (
              <div className='w-2.5 h-2.5 rounded-full border-2 border-red-400/70' />
            )}
          </div>
        </button>
        <button
          className='p-1 rounded hover:bg-neutral-700 text-neutral-400 hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'
          onClick={applyAtPlayhead}
          disabled={state.isPlaying}
          title='Apply state at playhead'>
          <Crosshair className='w-3.5 h-3.5' />
        </button>
        <button
          className={`p-1 rounded hover:bg-neutral-700 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${frozen ? 'text-yellow-400 bg-yellow-400/20' : 'text-neutral-400 hover:text-white'}`}
          onClick={handleTurboPause}
          disabled={freezeLoading}
          title='TURBOPAUZA (freeze/unfreeze output)'>
          <Zap
            className={`w-3.5 h-3.5 ${freezeLoading ? 'animate-pulse' : ''}`}
          />
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
            const trackHasDisconnected = firstClipInputId && !firstClipInput;
            const trackDotColor = firstClipInputId
              ? (inputColorMap.get(firstClipInputId)?.dot ??
                (trackHasDisconnected ? '#6b7280' : undefined))
              : undefined;
            const isEditing = editingTrackId === track.id;

            return (
              <div
                key={track.id}
                className={`flex border-b border-neutral-800/50 cursor-pointer group/track ${
                  track.id === invalidDropTrackId ? 'bg-red-900/20' : ''
                }`}
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
                {selectedClipIds.length <= 1 && (
                  <button
                    className='w-full text-left py-1.5 px-3 text-sm text-neutral-200 hover:bg-neutral-700 cursor-pointer'
                    onClick={handleSplitHere}>
                    Split Here
                  </button>
                )}
                <button
                  className='w-full text-left py-1.5 px-3 text-sm text-neutral-200 hover:bg-neutral-700 cursor-pointer text-red-400 hover:text-red-300'
                  onClick={handleDeleteClip}>
                  {selectedClipIds.length > 1
                    ? `Delete ${selectedClipIds.length} Clips`
                    : 'Delete Clip'}
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
                  title='Selection'
                  items={[
                    ['Click', 'Select single clip'],
                    ['Ctrl/Cmd + Click', 'Toggle clip in selection'],
                    ['Shift + Click', 'Select range on track'],
                    ['Ctrl/Cmd + A', 'Select all clips'],
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
