'use client';

import {
  memo,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { Input, Layer } from '@/lib/types';
import { useActions } from '../contexts/actions-context';
import { useRecordingControls } from '../hooks/use-recording-controls';
import type { InputWrapper } from '../hooks/use-control-panel-state';
import LoadingSpinner from '@/components/ui/spinner';
import { useControlPanelContext } from '../contexts/control-panel-context';
import {
  useTimelineState,
  DEFAULT_PPS,
  resolveClipBlockSettingsAtOffset,
  OUTPUT_TRACK_ID,
  OUTPUT_CLIP_ID,
  OUTPUT_TRACK_INPUT_ID,
  type BlockSettings,
  type Clip,
  type Keyframe,
  type Track,
  type TimelineState,
} from '../hooks/use-timeline-state';
import { useServerTimelinePlayback } from '../hooks/use-server-timeline-playback';
import {
  Play,
  Pause,
  Square,
  SkipBack,
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
  ChevronRight,
  ChevronLeft,
  GripVertical,
  Volume2,
  AlertTriangle,
} from 'lucide-react';
import {
  hexToHsla,
  hexToHsl,
  hslToHex,
  generateShades,
} from '@/lib/color-utils';
import { formatMs, parseDurationInput } from '@/lib/format-utils';
import { Button } from '@/components/ui/button';
import { Input as ShadcnInput } from '@/components/ui/input';
import {
  TYPE_HSL,
  buildInputColorMap,
  MIN_HEIGHT,
  MAX_HEIGHT_VH,
  DEFAULT_HEIGHT,
  TRACK_HEIGHT,
  AUTOMATION_LANE_HEIGHT,
  SOURCES_WIDTH,
  MIN_SOURCES_WIDTH,
  MAX_SOURCES_WIDTH,
  SNAP_THRESHOLD_PX,
  RESIZE_HANDLE_PX,
  MIN_MOVABLE_KEYFRAME_MS,
  LONG_PRESS_MS,
  TIMELINE_COLOR_PRESETS,
  computeKeyframeDiff,
  computeRulerTicks,
  hasOverlapOnTrack,
  computeSnapTargets,
  snapToNearest,
  clampKeyframeTimeMs,
  computeKeyframeSnapTargets,
  resolveKeyframeCollision,
  findOrphanedInputIds,
  getContentExtentMs,
} from './timeline/timeline-utils';
import { ColorSwatch } from './timeline/ColorSwatch';
import { ShortcutGroup } from './timeline/ShortcutGroup';
import { VolumeAutomationLane } from './timeline/VolumeAutomationLane';
import {
  emitTimelineEvent,
  listenTimelineEvent,
  TIMELINE_EVENTS,
} from './timeline/timeline-events';
import { ResolveMissingAssetModal } from './ResolveMissingAssetModal';
import { toast } from 'sonner';

// ── Props ────────────────────────────────────────────────

export type TimelinePanelActions = {
  applyAtPlayhead: () => Promise<void>;
  play: () => Promise<void>;
  recordAndPlay: () => Promise<void>;
  commitSceneAtPlayheadToTimeline: () => void;
};

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
  onTimelineStateChange?: (state: TimelineState) => void;
  onTimelineLoadStateReady?: (
    loadState: (state: TimelineState) => void,
  ) => void;
  onTimelineActionsReady?: (actions: TimelinePanelActions | null) => void;
  onBeforePlay?: () => Promise<boolean>;
  onTimelineQueueStateChange?: (locked: boolean) => void;
  layers?: Layer[];
  sortMode?: 'timeline' | 'layers';
  onSortModeChange?: (mode: 'timeline' | 'layers') => void;
  sortModeSwitchDisabled?: boolean;
  sortModeSwitchReason?: string;
};

function replaceLayerInputId(
  layers: Layer[],
  oldInputId: string,
  newInputId: string,
): Layer[] {
  if (oldInputId === newInputId) return layers;

  let changed = false;
  const nextLayers = layers.map((layer) => {
    let layerChanged = false;
    const seen = new Set<string>();
    const nextInputs: Layer['inputs'] = [];

    for (const input of layer.inputs) {
      const nextInputId =
        input.inputId === oldInputId ? newInputId : input.inputId;
      if (nextInputId !== input.inputId) {
        layerChanged = true;
      }
      if (seen.has(nextInputId)) {
        // Prevent duplicate layer entries after replacing input IDs.
        layerChanged = true;
        continue;
      }
      seen.add(nextInputId);
      nextInputs.push(
        nextInputId === input.inputId
          ? input
          : { ...input, inputId: nextInputId },
      );
    }

    if (!layerChanged) return layer;
    changed = true;
    return { ...layer, inputs: nextInputs };
  });

  return changed ? nextLayers : layers;
}

// Color maps, constants, and utility functions are in ./timeline/timeline-utils.ts

// Utility functions extracted to ./timeline/timeline-utils.ts

// ── Editable Duration ────────────────────────────────────

function EditableDuration({
  totalDurationMs,
  isPlaying,
  onChange,
}: {
  totalDurationMs: number;
  isPlaying: boolean;
  onChange: (ms: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEditing = useCallback(() => {
    if (isPlaying) return;
    setDraft(formatMs(totalDurationMs));
    setEditing(true);
  }, [isPlaying, totalDurationMs]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = useCallback(() => {
    setEditing(false);
    const parsed = parseDurationInput(draft);
    if (parsed != null && parsed > 0) {
      onChange(parsed);
    }
  }, [draft, onChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setEditing(false);
      }
    },
    [commit],
  );

  if (editing) {
    return (
      <input
        ref={inputRef}
        className='bg-transparent border border-border rounded px-1 text-[11px] font-mono tabular-nums w-14 text-center outline-none focus:border-primary'
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
      />
    );
  }

  return (
    <span
      className={`cursor-pointer hover:text-foreground transition-colors ${isPlaying ? 'pointer-events-none' : ''}`}
      onClick={startEditing}
      title='Click to edit total duration (mm:ss)'>
      {formatMs(totalDurationMs)}
    </span>
  );
}

// ── Component ────────────────────────────────────────────

export const TimelinePanel = memo(function TimelinePanel({
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
  onTimelineStateChange,
  onTimelineLoadStateReady,
  onTimelineActionsReady,
  onBeforePlay,
  onTimelineQueueStateChange,
  layers = [],
  sortMode = 'timeline',
  onSortModeChange,
  sortModeSwitchDisabled = false,
  sortModeSwitchReason,
}: TimelinePanelProps) {
  const { removeInput, updateRoom } = useActions();
  const {
    inputs,
    roomId,
    refreshState,
    isRecording: serverIsRecording,
  } = useControlPanelContext();
  const {
    state,
    setPlayhead,
    setPlaying,
    setZoom,
    setKeyframeInterpolationMode,
    setSnapToBlocks,
    setSnapToKeyframes,
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
    loadState,
    setTotalDuration,
  } = useTimelineState(roomId, inputs);

  useEffect(() => {
    onTimelineStateChange?.(state);
  }, [onTimelineStateChange, state]);

  useEffect(() => {
    onTimelineLoadStateReady?.(loadState);
  }, [loadState, onTimelineLoadStateReady]);

  const [selectedClipIds, setSelectedClipIds] = useState<
    { trackId: string; clipId: string }[]
  >([]);
  const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(
    null,
  );
  const lastClickedClipRef = useRef<{ trackId: string; clipId: string } | null>(
    null,
  );

  const [hoveredKeyframe, setHoveredKeyframe] = useState<{
    keyframeId: string;
    clipId: string;
    rect: DOMRect;
    diffs: string[];
    timeMs: number;
  } | null>(null);

  const [automationVisibleTracks, setAutomationVisibleTracks] = useState<
    Set<string>
  >(new Set());

  const [resolveMissingInputId, setResolveMissingInputId] = useState<
    string | null
  >(null);

  const toggleAutomationLane = useCallback((trackId: string) => {
    setAutomationVisibleTracks((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) {
        next.delete(trackId);
      } else {
        next.add(trackId);
      }
      return next;
    });
  }, []);

  const selectedClipIdSet = useMemo(
    () => new Set(selectedClipIds.map((s) => s.clipId)),
    [selectedClipIds],
  );

  const selectClip = useCallback(
    (trackId: string, clipId: string, mode: 'replace' | 'toggle' | 'range') => {
      if (mode === 'replace') {
        setSelectedClipIds([{ trackId, clipId }]);
        setSelectedKeyframeId(null);
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
        setSelectedKeyframeId(null);
        lastClickedClipRef.current = { trackId, clipId };
      } else {
        // range: select all clips between lastClicked and this one on the same track
        const anchor = lastClickedClipRef.current;
        if (!anchor || anchor.trackId !== trackId) {
          setSelectedClipIds([{ trackId, clipId }]);
          setSelectedKeyframeId(null);
          lastClickedClipRef.current = { trackId, clipId };
          return;
        }
        const track = state.tracks.find((t) => t.id === trackId);
        if (!track) return;
        const anchorIdx = track.clips.findIndex((c) => c.id === anchor.clipId);
        const targetIdx = track.clips.findIndex((c) => c.id === clipId);
        if (anchorIdx < 0 || targetIdx < 0) {
          setSelectedClipIds([{ trackId, clipId }]);
          setSelectedKeyframeId(null);
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
        setSelectedKeyframeId(null);
      }
    },
    [state.tracks],
  );

  useEffect(() => {
    if (selectedClipIds.length !== 1 || !selectedKeyframeId) return;
    const selected = selectedClipIds[0];
    const track = state.tracks.find((item) => item.id === selected.trackId);
    const clip = track?.clips.find((item) => item.id === selected.clipId);
    if (
      !clip ||
      !clip.keyframes.some((keyframe) => keyframe.id === selectedKeyframeId)
    ) {
      setSelectedKeyframeId(null);
    }
  }, [selectedClipIds, selectedKeyframeId, state.tracks]);

  useEffect(() => {
    const resolvedClips = selectedClipIds
      .map((sel) => {
        const track = state.tracks.find((t) => t.id === sel.trackId);
        const clip = track?.clips.find((c) => c.id === sel.clipId);
        if (!track || !clip) return null;
        const explicitKeyframeId =
          selectedClipIds.length === 1 &&
          sel.trackId === selectedClipIds[0]?.trackId &&
          sel.clipId === selectedClipIds[0]?.clipId
            ? selectedKeyframeId
            : null;

        let fallbackKeyframeId: string | null = null;
        if (!explicitKeyframeId) {
          const offsetMs = Math.max(0, state.playheadMs - clip.startMs);
          const sorted = [...clip.keyframes].sort(
            (a, b) => a.timeMs - b.timeMs,
          );
          const atPlayhead = sorted.filter((k) => k.timeMs <= offsetMs).pop();
          fallbackKeyframeId =
            atPlayhead?.id ??
            clip.keyframes.find((k) => k.timeMs === 0)?.id ??
            null;
        }

        const clipSelectedKeyframeId = explicitKeyframeId ?? fallbackKeyframeId;
        const selectedKeyframe = clipSelectedKeyframeId
          ? clip.keyframes.find(
              (keyframe) => keyframe.id === clipSelectedKeyframeId,
            )
          : null;
        return {
          trackId: sel.trackId,
          clipId: clip.id,
          inputId: clip.inputId,
          startMs: clip.startMs,
          endMs: clip.endMs,
          blockSettings: selectedKeyframe?.blockSettings ?? clip.blockSettings,
          keyframes: clip.keyframes,
          selectedKeyframeId: clipSelectedKeyframeId,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c != null);
    emitTimelineEvent(TIMELINE_EVENTS.SELECTED_CLIP, {
      clips: resolvedClips,
    });
  }, [selectedClipIds, selectedKeyframeId, state.tracks, state.playheadMs]);

  useEffect(() => {
    return listenTimelineEvent(
      TIMELINE_EVENTS.UPDATE_CLIP_SETTINGS,
      ({ trackId, clipId, patch }) => {
        updateClipSettings(trackId, clipId, patch);
      },
    );
  }, [updateClipSettings]);

  useEffect(() => {
    return listenTimelineEvent(
      TIMELINE_EVENTS.RESIZE_CLIP,
      ({ trackId, clipId, edge, newMs }) => {
        resizeClip(trackId, clipId, edge, newMs);
      },
    );
  }, [resizeClip]);

  useEffect(() => {
    const unsubs = [
      listenTimelineEvent(
        TIMELINE_EVENTS.ADD_KEYFRAME,
        ({ trackId, clipId, timeMs }) => {
          addKeyframe(trackId, clipId, timeMs);
        },
      ),
      listenTimelineEvent(
        TIMELINE_EVENTS.UPDATE_KEYFRAME,
        ({ trackId, clipId, keyframeId, patch }) => {
          updateKeyframe(trackId, clipId, keyframeId, patch);
        },
      ),
      listenTimelineEvent(
        TIMELINE_EVENTS.MOVE_KEYFRAME,
        ({ trackId, clipId, keyframeId, timeMs }) => {
          moveKeyframe(trackId, clipId, keyframeId, timeMs);
        },
      ),
      listenTimelineEvent(
        TIMELINE_EVENTS.DELETE_KEYFRAME,
        ({ trackId, clipId, keyframeId }) => {
          deleteKeyframe(trackId, clipId, keyframeId);
        },
      ),
      listenTimelineEvent(
        TIMELINE_EVENTS.SELECT_KEYFRAME,
        ({ trackId, clipId, keyframeId }) => {
          setSelectedClipIds([{ trackId, clipId }]);
          setSelectedKeyframeId(keyframeId);
          lastClickedClipRef.current = { trackId, clipId };
        },
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, [addKeyframe, deleteKeyframe, moveKeyframe, updateKeyframe]);

  useEffect(() => {
    return listenTimelineEvent(
      TIMELINE_EVENTS.UPDATE_CLIP_SETTINGS_FOR_INPUT,
      ({ inputId, patch }) => {
        for (const track of state.tracks) {
          for (const clip of track.clips) {
            if (clip.inputId === inputId) {
              updateClipSettings(track.id, clip.id, patch);
            }
          }
        }
      },
    );
  }, [state.tracks, updateClipSettings]);

  useEffect(() => {
    return listenTimelineEvent(
      TIMELINE_EVENTS.PURGE_INPUT_IDS,
      ({ inputIds }) => {
        const uniqueIds = [...new Set(inputIds.filter(Boolean))];
        for (const inputId of uniqueIds) {
          purgeInputId(inputId);
        }
      },
    );
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

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const unsub = listenTimelineEvent(
      TIMELINE_EVENTS.CLEANUP_SPURIOUS_WHIP_TRACK,
      ({ inputId }) => {
        const timer = setTimeout(() => {
          cleanupSpuriousWhipTrack(inputId);
        }, 1500);
        timers.push(timer);
      },
    );
    return () => {
      unsub();
      for (const t of timers) clearTimeout(t);
    };
  }, [cleanupSpuriousWhipTrack]);

  useEffect(() => {
    return listenTimelineEvent(
      TIMELINE_EVENTS.SWAP_CLIP_INPUT,
      ({ trackId, clipId, newInputId, sourceUpdates }) => {
        const oldInputId = state.tracks
          .find((track) => track.id === trackId)
          ?.clips.find((clip) => clip.id === clipId)?.inputId;

        swapClipInput(trackId, clipId, newInputId, sourceUpdates);

        if (!oldInputId || oldInputId === newInputId || layers.length === 0) {
          return;
        }

        const nextLayers = replaceLayerInputId(layers, oldInputId, newInputId);
        if (nextLayers === layers) {
          return;
        }

        void updateRoom(roomId, { layers: nextLayers }).catch((err) => {
          console.error(
            '[timeline] Failed to sync swapped input in layers',
            err,
          );
        });
      },
    );
  }, [layers, roomId, state.tracks, swapClipInput, updateRoom]);

  // Auto-create keyframe when layout map position changes
  useEffect(() => {
    const handler = (
      e: CustomEvent<{
        inputId: string;
        absoluteTop: number;
        absoluteLeft: number;
        absoluteWidth: number;
        absoluteHeight: number;
      }>,
    ) => {
      const { inputId, ...positionPatch } = e.detail;
      for (const track of state.tracks) {
        for (const clip of track.clips) {
          if (clip.inputId !== inputId) continue;
          if (state.playheadMs < clip.startMs || state.playheadMs >= clip.endMs)
            continue;
          const offsetMs = state.playheadMs - clip.startMs;
          const resolved = resolveClipBlockSettingsAtOffset(clip, offsetMs);
          addKeyframe(track.id, clip.id, offsetMs, {
            ...resolved,
            ...positionPatch,
          });
          return;
        }
      }
    };
    window.addEventListener(
      'smelter:layout-map:input-moved',
      handler as unknown as EventListener,
    );
    return () => {
      window.removeEventListener(
        'smelter:layout-map:input-moved',
        handler as unknown as EventListener,
      );
    };
  }, [state.tracks, state.playheadMs, addKeyframe]);

  // Inward event: external code (voice, control-panel) can request a clip selection
  useEffect(() => {
    return listenTimelineEvent(TIMELINE_EVENTS.SELECT_CLIP, (detail) => {
      if (!detail) {
        setSelectedClipIds([]);
        setSelectedKeyframeId(null);
        return;
      }

      if (detail.trackId && detail.clipId) {
        setSelectedClipIds([
          { trackId: detail.trackId, clipId: detail.clipId },
        ]);
        setSelectedKeyframeId(null);
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
          setSelectedKeyframeId(null);
          setPlayhead(track.clips[0].startMs);
        }
        return;
      }

      if (detail.inputId) {
        for (const track of state.tracks) {
          for (const clip of track.clips) {
            if (clip.inputId === detail.inputId) {
              setSelectedClipIds([{ trackId: track.id, clipId: clip.id }]);
              setSelectedKeyframeId(null);
              setPlayhead(clip.startMs);
              return;
            }
          }
        }
      }
    });
  }, [state.tracks, setPlayhead]);

  const inputColorMap = useMemo(() => buildInputColorMap(inputs), [inputs]);

  const {
    play,
    pause,
    stop,
    applyAtPlayhead,
    isPaused,
    isTimelineClientPending,
    isTimelineInteractionLocked,
    timelineBusyOperation,
    timelineBusyStage,
    timelineBusyPhase,
    timelineStopTimeoutActive,
  } = useServerTimelinePlayback(roomId, state, setPlayhead, setPlaying);

  const {
    isTogglingRecording,
    effectiveIsRecording: isRecording,
    start: startRec,
    stopAndDownload,
  } = useRecordingControls(roomId, serverIsRecording, refreshState);
  const wasPlayingRef = useRef(false);
  const timelineToastIdRef = useRef<string | number | null>(null);
  const timelineControlsDisabled = isTimelineInteractionLocked;
  const timelineBusyLabel = (() => {
    if (isTimelineClientPending && !timelineBusyOperation) {
      return 'Sending timeline request';
    }
    if (timelineBusyPhase === 'stopping-playback') return 'Stopping playback';
    if (timelineBusyPhase === 'seeking-to-zero')
      return 'Seeking cursor to 0 ms';
    if (timelineBusyPhase === 'waiting-before-apply')
      return 'Waiting before apply';
    if (timelineBusyPhase === 'applying-state')
      return 'Applying snapshot state';
    if (timelineBusyOperation) return `Timeline busy: ${timelineBusyOperation}`;
    return 'Timeline busy';
  })();
  const timelineInlineStatus = (() => {
    if (timelineBusyStage === 'failed') {
      return {
        toneClass: 'text-red-400',
        text: 'Timeline operation failed',
        icon: <AlertTriangle className='h-3 w-3' />,
      };
    }
    if (timelineStopTimeoutActive) {
      return {
        toneClass: 'text-amber-400',
        text: 'Stop takes longer than expected',
        icon: <AlertTriangle className='h-3 w-3' />,
      };
    }
    if (isTimelineInteractionLocked) {
      return {
        toneClass: 'text-muted-foreground',
        text: `${timelineBusyLabel}...`,
        icon: <LoadingSpinner size='sm' variant='spinner' />,
      };
    }
    return null;
  })();
  useEffect(() => {
    onTimelineQueueStateChange?.(isTimelineInteractionLocked);
  }, [isTimelineInteractionLocked, onTimelineQueueStateChange]);
  const runTimelineActionWithToast = useCallback(
    async (
      messages: {
        pending: string;
        success: string;
        error: string;
      },
      action: () => Promise<void>,
    ) => {
      if (timelineControlsDisabled) {
        return false;
      }
      const toastId =
        timelineToastIdRef.current ?? toast.loading(messages.pending);
      timelineToastIdRef.current = toastId;
      toast.loading(messages.pending, { id: toastId });
      try {
        await action();
        toast.success(messages.success, { id: toastId });
        return true;
      } catch (err) {
        console.error('[timeline-ui] timeline action failed', err);
        toast.error(messages.error, { id: toastId });
        return false;
      } finally {
        if (timelineToastIdRef.current === toastId) {
          timelineToastIdRef.current = null;
        }
      }
    },
    [timelineControlsDisabled],
  );

  const handlePlay = useCallback(async () => {
    if (onBeforePlay) {
      const allowed = await onBeforePlay();
      if (!allowed) return;
    }
    await runTimelineActionWithToast(
      {
        pending: isPaused ? 'Resuming timeline...' : 'Starting timeline...',
        success: isPaused ? 'Timeline resumed.' : 'Timeline started.',
        error: 'Failed to start timeline.',
      },
      play,
    );
  }, [isPaused, onBeforePlay, play, runTimelineActionWithToast]);

  const handlePlayPauseToggle = useCallback(async () => {
    if (state.isPlaying) {
      await runTimelineActionWithToast(
        {
          pending: 'Pausing timeline...',
          success: 'Timeline paused.',
          error: 'Failed to pause timeline.',
        },
        pause,
      );
      return;
    }

    await handlePlay();
  }, [handlePlay, pause, runTimelineActionWithToast, state.isPlaying]);

  const handleStop = useCallback(async () => {
    await runTimelineActionWithToast(
      {
        pending: 'Stopping timeline...',
        success: 'Timeline stopped.',
        error: 'Failed to stop timeline.',
      },
      stop,
    );
  }, [runTimelineActionWithToast, stop]);

  const handleApplyAtPlayhead = useCallback(async () => {
    await runTimelineActionWithToast(
      {
        pending: 'Applying timeline state...',
        success: 'Timeline state applied.',
        error: 'Failed to apply timeline state.',
      },
      applyAtPlayhead,
    );
  }, [applyAtPlayhead, runTimelineActionWithToast]);

  const commitSceneAtPlayheadToTimeline = useCallback(() => {
    const playheadMs = state.playheadMs;
    for (const track of state.tracks) {
      for (const clip of track.clips) {
        if (clip.inputId === OUTPUT_TRACK_INPUT_ID) continue;
        if (playheadMs < clip.startMs || playheadMs >= clip.endMs) continue;
        const input = inputs.find(
          (candidate) => candidate.inputId === clip.inputId,
        );
        if (!input) continue;
        const layerInput = layers
          .flatMap((layer) => layer.inputs)
          .find((layerItem) => layerItem.inputId === clip.inputId);
        updateClipSettings(track.id, clip.id, {
          volume: input.volume,
          shaders: input.shaders,
          showTitle: input.showTitle,
          text: input.text,
          textAlign: input.textAlign,
          textColor: input.textColor,
          textMaxLines: input.textMaxLines,
          textScrollEnabled: input.textScrollEnabled,
          textScrollSpeed: input.textScrollSpeed,
          textScrollLoop: input.textScrollLoop,
          textFontSize: input.textFontSize,
          borderColor: input.borderColor,
          borderWidth: input.borderWidth,
          attachedInputIds: input.attachedInputIds,
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
          gameBackgroundColor: input.gameBackgroundColor,
          gameCellGap: input.gameCellGap,
          gameBoardBorderColor: input.gameBoardBorderColor,
          gameBoardBorderWidth: input.gameBoardBorderWidth,
          gameGridLineColor: input.gameGridLineColor,
          gameGridLineAlpha: input.gameGridLineAlpha,
          snakeEventShaders: input.snakeEventShaders,
          ...(layerInput
            ? {
                absoluteLeft: layerInput.x,
                absoluteTop: layerInput.y,
                absoluteWidth: layerInput.width,
                absoluteHeight: layerInput.height,
                absoluteTransitionDurationMs: layerInput.transitionDurationMs,
                absoluteTransitionEasing: layerInput.transitionEasing,
              }
            : {}),
        });
      }
    }
  }, [inputs, layers, state.playheadMs, state.tracks, updateClipSettings]);

  const handleRecordAndPlay = useCallback(async () => {
    if (isTogglingRecording) return;
    if (isRecording) {
      if (timelineControlsDisabled) return;
      await runTimelineActionWithToast(
        {
          pending: 'Pausing timeline...',
          success: 'Timeline paused.',
          error: 'Failed to pause timeline.',
        },
        pause,
      );
      await stopAndDownload();
      return;
    }
    const started = await startRec();
    if (started) {
      if (onBeforePlay) {
        const allowed = await onBeforePlay();
        if (!allowed) return;
      }
      await runTimelineActionWithToast(
        {
          pending: isPaused ? 'Resuming timeline...' : 'Starting timeline...',
          success: isPaused ? 'Timeline resumed.' : 'Timeline started.',
          error: 'Failed to start timeline.',
        },
        play,
      );
    }
  }, [
    isPaused,
    isRecording,
    isTogglingRecording,
    play,
    pause,
    startRec,
    stopAndDownload,
    onBeforePlay,
    timelineControlsDisabled,
    runTimelineActionWithToast,
  ]);

  useEffect(() => {
    onTimelineActionsReady?.({
      applyAtPlayhead: handleApplyAtPlayhead,
      play: handlePlay,
      recordAndPlay: handleRecordAndPlay,
      commitSceneAtPlayheadToTimeline,
    });
    return () => {
      onTimelineActionsReady?.(null);
    };
  }, [
    handleApplyAtPlayhead,
    commitSceneAtPlayheadToTimeline,
    handlePlay,
    handleRecordAndPlay,
    onTimelineActionsReady,
  ]);

  useEffect(() => {
    if (!timelineStopTimeoutActive) {
      return;
    }
    const toastId =
      timelineToastIdRef.current ??
      toast.loading('Stopping timeline is taking longer than expected...');
    timelineToastIdRef.current = toastId;
    toast.warning('Stopping timeline is taking longer than expected...', {
      id: toastId,
    });
  }, [timelineStopTimeoutActive]);

  useEffect(() => {
    return () => {
      if (timelineToastIdRef.current !== null) {
        toast.dismiss(timelineToastIdRef.current);
        timelineToastIdRef.current = null;
      }
    };
  }, []);

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

  const [sourcesWidth, setSourcesWidth] = useState(SOURCES_WIDTH);
  const sourcesResizingRef = useRef(false);
  const sourcesStartXRef = useRef(0);
  const sourcesStartWidthRef = useRef(0);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    trackId: string;
    inputId: string;
    isMuted: boolean;
    clipId?: string;
    splitAtMs?: number;
  } | null>(null);
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

  // ── Track click ──────────────────────────────────────

  const handleTrackClick = useCallback(
    (trackId: string) => {
      // Find the first clip on this track to select its input
      const track = state.tracks.find((t) => t.id === trackId);
      if (track && track.clips.length > 0) {
        setSelectedKeyframeId(null);
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
    [setPlayhead, rulerPxToMs, resolvePlayheadMs, state.isPlaying, pause],
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
      setSelectedKeyframeId(null);
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
        setSelectedKeyframeId(null);
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

  const deleteClipsAndRemoveOrphans = useCallback(
    async (clipsToDelete: { trackId: string; clipId: string }[]) => {
      if (clipsToDelete.length === 0) return;

      const orphanedIds = findOrphanedInputIds(state.tracks, clipsToDelete);

      deleteClips(clipsToDelete);

      for (const inputId of orphanedIds) {
        await removeInput(roomId, inputId);
        purgeInputId(inputId);
      }
      if (orphanedIds.length > 0) await refreshState();
    },
    [
      state.tracks,
      deleteClip,
      deleteClips,
      removeInput,
      roomId,
      purgeInputId,
      refreshState,
    ],
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
          void handlePlayPauseToggle();
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
            animateZoom(state.pixelsPerSecond * 1.5);
          } else if (key === '+') {
            e.preventDefault();
            animateZoom(state.pixelsPerSecond * 1.5);
          }
          break;
        }
        case '-': {
          if (ctrl) e.preventDefault();
          animateZoom(state.pixelsPerSecond / 1.5);
          break;
        }
        case '0': {
          if (ctrl) break;
          e.preventDefault();
          const el = scrollContainerRef.current;
          if (el) {
            const availableWidth = el.clientWidth - sourcesWidth;
            const extentMs = getContentExtentMs(state.tracks);
            const extentSec =
              (extentMs > 0 ? extentMs : state.totalDurationMs) / 1000;
            if (extentSec > 0 && availableWidth > 0) {
              const padding = 40;
              animateZoom(Math.max(1, availableWidth - padding) / extentSec);
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
            void deleteClipsAndRemoveOrphans(selectedClipIds);
            setSelectedClipIds([]);
            setSelectedKeyframeId(null);
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
          setSelectedKeyframeId(null);
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
    handlePlayPauseToggle,
    setPlayhead,
    setZoom,
    animateZoom,
    scrollToPlayhead,
    jumpToEdge,
    navigateTrack,
    tabToNextClip,
    findClipAtPlayhead,
    splitClip,
    deleteClipsAndRemoveOrphans,
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
  const getTrackIndexAtY = useCallback(
    (relativeY: number): number => {
      let accumulated = 0;
      for (let i = 0; i < state.tracks.length; i++) {
        const h =
          TRACK_HEIGHT +
          (automationVisibleTracks.has(state.tracks[i].id)
            ? AUTOMATION_LANE_HEIGHT
            : 0);
        if (relativeY < accumulated + h) return i;
        accumulated += h;
      }
      return state.tracks.length - 1;
    },
    [state.tracks, automationVisibleTracks],
  );

  const getTrackIdAtY = useCallback(
    (clientY: number): string | null => {
      const container = scrollContainerRef.current;
      if (!container) return null;
      const containerRect = container.getBoundingClientRect();
      const scrollTop = container.scrollTop;
      const relativeY = clientY - containerRect.top + scrollTop;
      const trackIndex = getTrackIndexAtY(relativeY);
      if (trackIndex >= 0 && trackIndex < state.tracks.length) {
        return state.tracks[trackIndex].id;
      }
      return null;
    },
    [state.tracks, getTrackIndexAtY],
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
        let targetIndex = getTrackIndexAtY(relativeY);
        targetIndex = Math.max(
          0,
          Math.min(targetIndex, state.tracks.length - 1),
        );
        const targetTrack = state.tracks[targetIndex];
        if (targetTrack && targetTrack.id === OUTPUT_TRACK_ID) {
          return;
        }
        setTrackDropIndex(targetIndex);
        if (targetIndex !== trackDrag.currentIndex) {
          reorderTrack(trackDrag.trackId, targetIndex);
          trackDrag.currentIndex = targetIndex;
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
        keyframeDragRef.current || dragRef.current || trackDragRef.current;
      keyframeDragRef.current = null;
      dragRef.current = null;
      if (trackDragRef.current) {
        trackDragRef.current = null;
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
    state.playheadMs,
    state.snapToBlocks,
    state.snapToKeyframes,
    snapThresholdMs,
    moveClip,
    moveClips,
    resizeClip,
    moveClipToTrack,
    getTrackIdAtY,
    updateClipSettings,
    moveKeyframe,
    reorderTrack,
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

  const closeContextMenu = useCallback(() => {
    if (colorSubmenuCloseTimer.current) {
      clearTimeout(colorSubmenuCloseTimer.current);
      colorSubmenuCloseTimer.current = null;
    }
    setContextMenu(null);
    setColorSubmenuOpen(false);
    setLongPressColor(null);
  }, []);

  useEffect(() => {
    if (!contextMenu) return;

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && contextMenuRef.current?.contains(target)) return;
      closeContextMenu();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeContextMenu();
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
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

  const handleDelete = useCallback(async () => {
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

  const handleDeleteClip = useCallback(async () => {
    const clipsToDelete =
      selectedClipIds.length > 1
        ? selectedClipIds
        : contextMenu?.clipId
          ? [{ trackId: contextMenu.trackId, clipId: contextMenu.clipId }]
          : [];

    await deleteClipsAndRemoveOrphans(clipsToDelete);
    setSelectedClipIds([]);
    closeContextMenu();
  }, [
    contextMenu,
    selectedClipIds,
    closeContextMenu,
    deleteClipsAndRemoveOrphans,
  ]);

  const handleSetClipColor = useCallback(
    (color: string | undefined) => {
      if (!contextMenu?.clipId) return;
      updateClipSettings(contextMenu.trackId, contextMenu.clipId, {
        timelineColor: color,
      });
      closeContextMenu();
    },
    [contextMenu, updateClipSettings, closeContextMenu],
  );

  // ── Render helpers ───────────────────────────────────

  const renderKeyframes = useCallback(
    (track: Track) => {
      return track.clips.flatMap((clip) => {
        const isClipSelected =
          selectedClipIds.length === 1 &&
          selectedClipIds[0].trackId === track.id &&
          selectedClipIds[0].clipId === clip.id;

        const sortedKeyframes = [...clip.keyframes].sort(
          (a, b) => a.timeMs - b.timeMs,
        );

        let resolvedKeyframeId: string | null = selectedKeyframeId;
        if (isClipSelected && !resolvedKeyframeId) {
          const offsetMs = Math.max(0, state.playheadMs - clip.startMs);
          const atPlayhead = sortedKeyframes
            .filter((k) => k.timeMs <= offsetMs)
            .pop();
          resolvedKeyframeId =
            atPlayhead?.id ??
            clip.keyframes.find((k) => k.timeMs === 0)?.id ??
            null;
        }

        return clip.keyframes.map((keyframe) => {
          const leftPx =
            ((clip.startMs + keyframe.timeMs) / 1000) * state.pixelsPerSecond;
          const isSelected =
            isClipSelected && resolvedKeyframeId === keyframe.id;

          return (
            <Button
              key={`${clip.id}:${keyframe.id}`}
              type='button'
              variant='ghost'
              size='icon'
              className='absolute z-20 size-3 -ml-1.5 -mt-1.5 border border-background hover:scale-110 p-0 rounded-none'
              style={{
                left: leftPx,
                top: TRACK_HEIGHT / 2,
                transform: 'rotate(45deg)',
                transition: zoomAnimating
                  ? `left ${ZOOM_TRANSITION_MS}ms ease-out, transform 150ms`
                  : 'transform 150ms',
                cursor: keyframe.timeMs === 0 ? 'pointer' : 'ew-resize',
                backgroundColor: isSelected
                  ? 'rgb(248 113 113)'
                  : 'rgb(212 212 212 / 0.9)',
                boxShadow: isSelected
                  ? '0 0 0 2px rgb(248 113 113 / 0.35)'
                  : 'none',
              }}
              onMouseEnter={(e) => {
                const rect = (
                  e.currentTarget as HTMLElement
                ).getBoundingClientRect();
                const idx = sortedKeyframes.findIndex(
                  (k) => k.id === keyframe.id,
                );
                const diffs =
                  idx <= 0
                    ? []
                    : computeKeyframeDiff(
                        sortedKeyframes[idx - 1].blockSettings,
                        keyframe.blockSettings,
                      );
                setHoveredKeyframe({
                  keyframeId: keyframe.id,
                  clipId: clip.id,
                  rect,
                  diffs,
                  timeMs: keyframe.timeMs,
                });
              }}
              onMouseLeave={() => setHoveredKeyframe(null)}
              onPointerDown={(e) =>
                handleKeyframePointerDown(e, track.id, clip, keyframe)
              }
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            />
          );
        });
      });
    },
    [
      selectedClipIds,
      selectedKeyframeId,
      state.pixelsPerSecond,
      state.playheadMs,
      handleKeyframePointerDown,
    ],
  );

  const renderClips = useCallback(
    (track: Track) => {
      return track.clips.map((clip) => {
        const isOutputClip = clip.id === OUTPUT_CLIP_ID;
        const input = inputs.find((i) => i.inputId === clip.inputId);
        const isDisconnected =
          !isOutputClip &&
          !input &&
          !clip.inputId.startsWith('__pending-whip-');
        const isMissingAsset =
          !isOutputClip &&
          ((input?.type === 'local-mp4' && input.mp4AssetMissing === true) ||
            (input?.type === 'image' && input.imageAssetMissing === true));
        const baseColors = inputColorMap.get(clip.inputId);
        const tc = clip.blockSettings.timelineColor;
        const colors = tc
          ? {
              dot: tc,
              segBg: hexToHsla(tc, 0.18),
              segBorder: hexToHsla(tc, 0.35),
              ring: hexToHsla(tc, 0.7),
            }
          : baseColors;
        const warnState = isMissingAsset || isDisconnected;
        const warnBg = isMissingAsset
          ? 'hsla(35, 90%, 50%, 0.12)'
          : isDisconnected
            ? 'hsla(0, 0%, 45%, 0.15)'
            : undefined;
        const warnBorder = isMissingAsset
          ? 'hsla(35, 90%, 55%, 0.35)'
          : isDisconnected
            ? 'hsla(0, 0%, 55%, 0.25)'
            : undefined;
        const warnRing = isMissingAsset
          ? 'hsla(35, 90%, 60%, 0.6)'
          : isDisconnected
            ? 'hsla(0, 0%, 60%, 0.5)'
            : undefined;
        const leftPx = (clip.startMs / 1000) * state.pixelsPerSecond;
        const widthPx =
          ((clip.endMs - clip.startMs) / 1000) * state.pixelsPerSecond;
        const isClipSelected = selectedClipIdSet.has(clip.id);
        const durationMs = clip.endMs - clip.startMs;
        const clipLabelSuffix = clip.blockSettings.swapLabelSuffix ?? '';
        const clipLabel = isOutputClip
          ? 'Main Video'
          : `${input?.title ?? clip.inputId}${clipLabelSuffix}`;

        const introT = clip.blockSettings.introTransition;
        const outroT = clip.blockSettings.outroTransition;
        const introWidthPx = introT
          ? (introT.durationMs / 1000) * state.pixelsPerSecond
          : 0;
        const outroWidthPx = outroT
          ? (outroT.durationMs / 1000) * state.pixelsPerSecond
          : 0;

        const outputClipBg = 'hsla(270, 60%, 50%, 0.15)';
        const outputClipBorder = 'hsla(270, 60%, 55%, 0.3)';
        const outputClipRing = 'hsla(270, 60%, 60%, 0.6)';

        return (
          <div
            key={clip.id}
            data-no-dnd='true'
            className={`absolute top-1 bottom-1 rounded-sm border ${isClipSelected ? 'ring-2 brightness-125' : ''} ${warnState ? 'opacity-60' : ''} flex items-center overflow-hidden touch-none`}
            style={{
              left: leftPx,
              width: Math.max(widthPx, 2),
              cursor: isOutputClip ? 'default' : 'grab',
              transition: zoomAnimating ? zoomTransitionStyle : undefined,
              backgroundColor: isOutputClip
                ? outputClipBg
                : (colors?.segBg ?? warnBg),
              borderColor: isOutputClip
                ? outputClipBorder
                : (colors?.segBorder ?? warnBorder),
              borderStyle: isMissingAsset ? 'dashed' : undefined,
              ...(isClipSelected
                ? {
                    boxShadow: `0 0 0 2px ${isOutputClip ? outputClipRing : (colors?.ring ?? warnRing ?? 'transparent')}`,
                  }
                : {}),
              ...(isMissingAsset || isDisconnected
                ? {
                    backgroundImage: isMissingAsset
                      ? 'repeating-linear-gradient(135deg, transparent, transparent 4px, hsla(35,90%,50%,0.10) 4px, hsla(35,90%,50%,0.10) 8px)'
                      : 'repeating-linear-gradient(135deg, transparent, transparent 4px, hsla(0,0%,50%,0.15) 4px, hsla(0,0%,50%,0.15) 8px)',
                  }
                : {}),
            }}
            title={
              isMissingAsset
                ? `[Missing file] ${clipLabel}: ${formatMs(clip.startMs)} → ${formatMs(clip.endMs)} (${formatMs(durationMs)})`
                : isDisconnected
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
            {!isOutputClip && (
              <>
                <div className='absolute left-0 top-0 bottom-0 w-[5px] cursor-col-resize z-10' />
                <div className='absolute right-0 top-0 bottom-0 w-[5px] cursor-col-resize z-10' />
              </>
            )}
            {!isOutputClip && introWidthPx > 0 && (
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
            {!isOutputClip && outroWidthPx > 0 && (
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
            {widthPx > 40 && (
              <span
                className={`text-[10px] truncate select-none pointer-events-none pl-2 ${isMissingAsset ? 'pr-7' : 'pr-2'} ${isOutputClip ? 'text-purple-300/80' : isMissingAsset ? 'text-amber-200/85' : isDisconnected ? 'text-muted-foreground/70 italic' : 'text-card-foreground/80'}`}>
                {isMissingAsset
                  ? `[Missing file] ${clipLabel}`
                  : isDisconnected
                    ? `[Disconnected] ${clipLabel}`
                    : clipLabel}
              </span>
            )}
            {isMissingAsset && (
              <Button
                type='button'
                variant='ghost'
                size='icon'
                title='Attach missing file…'
                className='absolute right-0.5 top-1/2 z-20 h-6 w-6 min-w-6 shrink-0 -translate-y-1/2 p-0 text-amber-400 hover:bg-amber-950/50 hover:text-amber-300 cursor-pointer'
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setResolveMissingInputId(clip.inputId);
                }}>
                <AlertTriangle className='size-3.5' strokeWidth={2.25} />
              </Button>
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
      setResolveMissingInputId,
    ],
  );

  return (
    <div
      className={`relative flex flex-col bg-background ${fillContainer ? 'h-full' : 'border-t border-border'}`}
      style={fillContainer ? undefined : { height: panelHeight }}>
      {!fillContainer && (
        <div
          className='h-1 w-full cursor-ns-resize hover:bg-accent transition-colors shrink-0'
          onMouseDown={handleResizeStart}
        />
      )}

      {/* Transport bar */}
      <div className='flex items-center gap-2 px-3 h-8 bg-background border-b border-border shrink-0'>
        <Button
          variant='ghost'
          size='icon'
          className='h-6 w-6 text-muted-foreground hover:text-foreground cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'
          onClick={() => setPlayhead(0)}
          disabled={state.isPlaying || timelineControlsDisabled}
          title='Skip to beginning'>
          <SkipBack className='w-3.5 h-3.5' />
        </Button>
        <Button
          variant='ghost'
          size='icon'
          className={`h-6 w-6 cursor-pointer ${state.isPlaying ? 'text-green-400' : isPaused ? 'text-yellow-400' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => void handlePlayPauseToggle()}
          disabled={timelineControlsDisabled}
          title={state.isPlaying ? 'Pause' : isPaused ? 'Resume' : 'Play'}>
          {state.isPlaying ? (
            <Pause className='w-3.5 h-3.5' />
          ) : (
            <Play className='w-3.5 h-3.5' />
          )}
        </Button>
        <Button
          variant='ghost'
          size='icon'
          className='h-6 w-6 text-muted-foreground hover:text-foreground cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'
          onClick={() => void handleStop()}
          disabled={timelineControlsDisabled || (!state.isPlaying && !isPaused)}
          title='Stop'>
          <Square className='w-3.5 h-3.5' />
        </Button>
        <Button
          variant='ghost'
          size='icon'
          className={`h-6 w-6 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${isRecording ? 'animate-pulse' : ''}`}
          onClick={handleRecordAndPlay}
          disabled={isTogglingRecording || timelineControlsDisabled}
          title={isRecording ? 'Stop recording' : 'Record & Play'}>
          <div className='w-3.5 h-3.5 flex items-center justify-center'>
            {isRecording ? (
              <div className='w-2.5 h-2.5 rounded-full bg-red-500' />
            ) : (
              <div className='w-2.5 h-2.5 rounded-full border-2 border-red-400/70' />
            )}
          </div>
        </Button>
        <Button
          variant='ghost'
          size='icon'
          className='h-6 w-6 text-muted-foreground hover:text-foreground cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed'
          onClick={() => void handleApplyAtPlayhead()}
          disabled={state.isPlaying || timelineControlsDisabled}
          title='Apply state at playhead'>
          <Crosshair className='w-3.5 h-3.5' />
        </Button>

        {timelineInlineStatus && (
          <div
            className={`ml-2 flex items-center gap-1 text-[11px] ${timelineInlineStatus.toneClass}`}>
            {timelineInlineStatus.icon}
            <span>{timelineInlineStatus.text}</span>
          </div>
        )}

        <div className='w-px h-4 bg-secondary' />

        <Button
          variant='ghost'
          size='icon'
          className='h-6 w-6 text-muted-foreground hover:text-foreground cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed'
          onClick={undo}
          disabled={!canUndo}
          title='Undo (Ctrl+Z)'>
          <Undo2 className='w-3.5 h-3.5' />
        </Button>
        <Button
          variant='ghost'
          size='icon'
          className='h-6 w-6 text-muted-foreground hover:text-foreground cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed'
          onClick={redo}
          disabled={!canRedo}
          title='Redo (Ctrl+Shift+Z)'>
          <Redo2 className='w-3.5 h-3.5' />
        </Button>

        <div className='text-[11px] text-muted-foreground font-mono tabular-nums ml-1'>
          {formatMs(state.playheadMs)}
          <span className='text-muted-foreground mx-1'>/</span>
          <EditableDuration
            totalDurationMs={state.totalDurationMs}
            isPlaying={state.isPlaying}
            onChange={setTotalDuration}
          />
        </div>

        <div className='ml-2 flex items-center gap-1 rounded border border-border bg-background/60 p-0.5'>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className={`rounded px-2 py-0.5 h-auto text-[10px] uppercase tracking-wide cursor-pointer ${
              sortMode === 'timeline'
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-card-foreground'
            }`}
            onClick={() => onSortModeChange?.('timeline')}
            disabled={sortModeSwitchDisabled}
            title={sortModeSwitchReason ?? 'Timeline sorting mode'}>
            Timeline
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className={`rounded px-2 py-0.5 h-auto text-[10px] uppercase tracking-wide cursor-pointer ${
              sortMode === 'layers'
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-card-foreground'
            }`}
            onClick={() => onSortModeChange?.('layers')}
            disabled={sortModeSwitchDisabled}
            title={sortModeSwitchReason ?? 'Layers sorting mode'}>
            Layers
          </Button>
        </div>

        <div className='flex-1' />

        <div className='flex items-center gap-1 rounded border border-border bg-background/60 p-0.5'>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className={`rounded px-2 py-0.5 h-auto text-[10px] uppercase tracking-wide cursor-pointer ${
              state.snapToBlocks
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-card-foreground'
            }`}
            onClick={() => setSnapToBlocks(!state.snapToBlocks)}
            title='Snap clip move/resize to neighboring block edges and playhead'>
            Snap Blocks
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className={`rounded px-2 py-0.5 h-auto text-[10px] uppercase tracking-wide cursor-pointer ${
              state.snapToKeyframes
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-card-foreground'
            }`}
            onClick={() => setSnapToKeyframes(!state.snapToKeyframes)}
            title='Snap keyframe drag to nearby keyframe times'>
            Snap Keyframes
          </Button>
        </div>

        <div className='flex items-center gap-1 rounded border border-border bg-background/60 p-0.5'>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className={`rounded px-2 py-0.5 h-auto text-[10px] uppercase tracking-wide cursor-pointer ${
              state.keyframeInterpolationMode === 'step'
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-card-foreground'
            }`}
            onClick={() => setKeyframeInterpolationMode('step')}
            title='Use the latest keyframe snapshot until the next one'>
            Step
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className={`rounded px-2 py-0.5 h-auto text-[10px] uppercase tracking-wide cursor-pointer ${
              state.keyframeInterpolationMode === 'smooth'
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-card-foreground'
            }`}
            onClick={() => setKeyframeInterpolationMode('smooth')}
            title='Interpolate numeric values between keyframes'>
            Smooth
          </Button>
        </div>

        <Button
          variant='ghost'
          size='icon'
          className='h-6 w-6 text-muted-foreground hover:text-foreground cursor-pointer'
          onClick={handleZoomOut}
          title='Zoom out'>
          <ZoomOut className='w-3.5 h-3.5' />
        </Button>
        <div className='text-[10px] text-muted-foreground font-mono w-10 text-center'>
          {Math.round((state.pixelsPerSecond / DEFAULT_PPS) * 100)}%
        </div>
        <Button
          variant='ghost'
          size='icon'
          className='h-6 w-6 text-muted-foreground hover:text-foreground cursor-pointer'
          onClick={handleZoomIn}
          title='Zoom in'>
          <ZoomIn className='w-3.5 h-3.5' />
        </Button>

        <div className='w-px h-4 bg-secondary mx-1' />

        <Button
          variant='ghost'
          size='icon'
          className='h-6 w-6 text-muted-foreground hover:text-foreground cursor-pointer'
          onClick={scrollToPlayhead}
          title='Scroll to playhead (F)'>
          <Crosshair className='w-3.5 h-3.5' />
        </Button>

        <Button
          variant='ghost'
          size='icon'
          className='h-6 w-6 text-muted-foreground hover:text-foreground cursor-pointer'
          onClick={() => setShowHelp((prev) => !prev)}
          title='Keyboard shortcuts (?)'>
          <HelpCircle className='w-3.5 h-3.5' />
        </Button>
      </div>

      <div className='relative flex-1 flex flex-col min-h-0'>
        {/* Header: Sources label + ruler */}
        <div className='flex shrink-0'>
          <div
            className='relative shrink-0 bg-muted/40 flex items-center px-3 border-b border-r border-border/30'
            style={{ width: sourcesWidth }}>
            <span className='text-[11px] text-muted-foreground uppercase tracking-wider font-medium'>
              Sources
            </span>
            <div
              className='absolute top-0 bottom-0 right-0 z-10 w-3 translate-x-1/2 cursor-col-resize bg-transparent hover:bg-accent/40 active:bg-accent/70 transition-colors'
              onMouseDown={handleSourcesResizeStart}
              onDoubleClick={() => setSourcesWidth(SOURCES_WIDTH)}
              title='Drag to resize track names'>
              <div className='absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/80 pointer-events-none' />
            </div>
          </div>
          <div
            ref={rulerRef}
            className='flex-1 h-7 bg-background border-b border-border relative cursor-pointer overflow-x-hidden touch-none'
            onPointerDown={handleRulerPointerDown}
            onPointerMove={handleRulerPointerMove}
            onPointerUp={handleRulerPointerUp}
            onPointerCancel={handleRulerPointerUp}>
            <div
              className='relative h-full pointer-events-none'
              style={{
                width: timelineWidthPx,
                minWidth: '100%',
                transition: zoomAnimating
                  ? `width ${ZOOM_TRANSITION_MS}ms ease-out`
                  : undefined,
              }}>
              {rulerTicks.map((tick) => {
                const x = (tick.timeMs / 1000) * state.pixelsPerSecond;
                return (
                  <div
                    key={tick.timeMs}
                    className='absolute flex flex-col items-center top-0 bottom-0 justify-end'
                    style={{
                      left: x,
                      transition: zoomAnimating
                        ? `left ${ZOOM_TRANSITION_MS}ms ease-out`
                        : undefined,
                    }}>
                    <span className='text-[10px] text-muted-foreground font-mono -translate-x-1/2 leading-none mb-1'>
                      {tick.label}
                    </span>
                    <div className='w-px h-1.5 bg-secondary -translate-x-1/2' />
                  </div>
                );
              })}
              {/* Playhead marker on ruler */}
              <div
                className='absolute top-0 bottom-0 w-px bg-red-500 z-10 pointer-events-none'
                style={{
                  left: playheadPx,
                  transition: zoomAnimating
                    ? `left ${ZOOM_TRANSITION_MS}ms ease-out`
                    : undefined,
                }}
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
              <div className='flex items-center gap-2 text-card-foreground text-sm'>
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
            state.tracks.map((track, trackIndex) => {
              // Determine a representative input for the track label color
              const firstClipInputId =
                track.clips.length > 0 ? track.clips[0].inputId : undefined;
              const firstClipInput = firstClipInputId
                ? inputs.find((i) => i.inputId === firstClipInputId)
                : undefined;
              const trackHasDisconnected = firstClipInputId && !firstClipInput;
              const firstClipColor =
                track.clips.length > 0
                  ? track.clips[0].blockSettings.timelineColor
                  : undefined;
              const trackDotColor =
                track.id === OUTPUT_TRACK_ID
                  ? '#a855f7'
                  : (firstClipColor ??
                    (firstClipInputId
                      ? (inputColorMap.get(firstClipInputId)?.dot ??
                        (trackHasDisconnected ? '#6b7280' : undefined))
                      : undefined));
              const isEditing = editingTrackId === track.id;
              const isBeingDragged = trackDragRef.current?.trackId === track.id;
              const showDropIndicator =
                trackDropIndex !== null && trackDropIndex === trackIndex;

              const isAutomationVisible =
                track.id !== OUTPUT_TRACK_ID &&
                automationVisibleTracks.has(track.id);

              return (
                <div
                  key={track.id}
                  className={`flex flex-col border-b border-border/50 cursor-pointer group/track relative ${
                    track.id === invalidDropTrackId ? 'bg-red-900/20' : ''
                  } ${isBeingDragged ? 'bg-blue-500/10' : ''}`}
                  onClick={() => handleTrackClick(track.id)}
                  onContextMenu={(e) => {
                    const inputId = firstClipInput?.inputId ?? '';
                    handleContextMenu(e, track.id, inputId);
                  }}>
                  {showDropIndicator && trackDragRef.current && (
                    <div className='absolute left-0 right-0 top-0 h-0.5 bg-blue-500 z-20 pointer-events-none' />
                  )}
                  {/* Main track row */}
                  <div className='flex' style={{ height: TRACK_HEIGHT }}>
                    {/* Track label (sticky left) */}
                    <div
                      className='shrink-0 bg-muted/40 flex items-center gap-1.5 px-2 sticky left-0 z-10 border-r border-border/30'
                      style={{ width: sourcesWidth }}>
                      {track.id !== OUTPUT_TRACK_ID && (
                        <GripVertical
                          className='w-3 h-3 shrink-0 text-muted-foreground/50 opacity-0 group-hover/track:opacity-100 transition-opacity cursor-grab active:cursor-grabbing'
                          onPointerDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const idx = state.tracks.findIndex(
                              (t) => t.id === track.id,
                            );
                            if (idx < 0) return;
                            trackDragRef.current = {
                              trackId: track.id,
                              originY: e.clientY,
                              currentIndex: idx,
                            };
                            setTrackDropIndex(idx);
                            document.body.style.userSelect = 'none';
                          }}
                        />
                      )}
                      <div
                        className='w-2.5 h-2.5 rounded-full shrink-0'
                        style={{ backgroundColor: trackDotColor ?? '#737373' }}
                      />
                      {track.id === OUTPUT_TRACK_ID ? (
                        <span className='text-sm text-purple-400 truncate flex-1 font-medium'>
                          {track.label}
                        </span>
                      ) : isEditing ? (
                        <ShadcnInput
                          autoFocus
                          className='text-sm text-foreground bg-card border border-border rounded px-1 py-0.5 flex-1 min-w-0 outline-none focus:border-blue-500'
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
                          className='text-sm text-foreground truncate flex-1'
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setEditingTrackId(track.id);
                            setEditingTrackLabel(track.label);
                          }}>
                          {track.label}
                        </span>
                      )}
                      {!isEditing && track.id !== OUTPUT_TRACK_ID && (
                        <div className='flex items-center gap-0.5'>
                          <Button
                            variant='ghost'
                            size='icon'
                            className={`h-5 w-5 cursor-pointer transition-opacity ${
                              isAutomationVisible
                                ? 'text-cyan opacity-100'
                                : 'text-muted-foreground hover:text-card-foreground opacity-0 group-hover/track:opacity-100'
                            }`}
                            title={
                              isAutomationVisible
                                ? 'Hide volume automation'
                                : 'Show volume automation'
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleAutomationLane(track.id);
                            }}>
                            <Volume2 className='w-3 h-3' />
                          </Button>
                          <Button
                            variant='ghost'
                            size='icon'
                            className='h-5 w-5 text-muted-foreground hover:text-card-foreground cursor-pointer opacity-0 group-hover/track:opacity-100 transition-opacity'
                            title='Rename track'
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingTrackId(track.id);
                              setEditingTrackLabel(track.label);
                            }}>
                            <Pencil className='w-3 h-3' />
                          </Button>
                          <Button
                            variant='ghost'
                            size='icon'
                            className='h-5 w-5 text-muted-foreground hover:text-red-400 cursor-pointer opacity-0 group-hover/track:opacity-100 transition-opacity'
                            title='Delete track'
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteTrack(track.id);
                            }}>
                            <Trash2 className='w-3 h-3' />
                          </Button>
                        </div>
                      )}
                    </div>
                    {/* Track timeline area */}
                    <div
                      className='relative'
                      style={{
                        width: timelineWidthPx,
                        minWidth: `calc(100% - ${sourcesWidth}px)`,
                        transition: zoomAnimating
                          ? `width ${ZOOM_TRANSITION_MS}ms ease-out`
                          : undefined,
                      }}>
                      {renderClips(track)}
                      {renderKeyframes(track)}
                      {/* Playhead line on track */}
                      <div
                        className='absolute top-0 bottom-0 w-px bg-red-500/50 z-10 pointer-events-none'
                        style={{
                          left: playheadPx,
                          transition: zoomAnimating
                            ? `left ${ZOOM_TRANSITION_MS}ms ease-out`
                            : undefined,
                        }}
                      />
                    </div>
                  </div>
                  {/* Volume automation lane */}
                  {isAutomationVisible && (
                    <div
                      className='flex border-t border-border/30'
                      style={{ height: AUTOMATION_LANE_HEIGHT }}>
                      <div
                        className='shrink-0 bg-muted/30 flex items-center justify-center sticky left-0 z-10 border-r border-border/30'
                        style={{ width: sourcesWidth }}>
                        <span className='text-[10px] text-muted-foreground select-none'>
                          Vol
                        </span>
                      </div>
                      <div
                        className='relative'
                        style={{
                          width: timelineWidthPx,
                          minWidth: `calc(100% - ${sourcesWidth}px)`,
                          transition: zoomAnimating
                            ? `width ${ZOOM_TRANSITION_MS}ms ease-out`
                            : undefined,
                        }}>
                        <VolumeAutomationLane
                          trackId={track.id}
                          clips={track.clips}
                          pixelsPerSecond={state.pixelsPerSecond}
                          interpolationMode={state.keyframeInterpolationMode}
                          timelineWidthPx={timelineWidthPx}
                          selectedKeyframeId={selectedKeyframeId}
                          onAddKeyframe={(tId, clipId, timeMs, volume) => {
                            const clip = track.clips.find(
                              (c) => c.id === clipId,
                            );
                            if (!clip) return;
                            const resolved = resolveClipBlockSettingsAtOffset(
                              clip,
                              timeMs,
                            );
                            addKeyframe(tId, clipId, timeMs, {
                              ...resolved,
                              volume,
                            });
                          }}
                          onUpdateKeyframeVolume={(
                            tId,
                            clipId,
                            keyframeId,
                            volume,
                          ) => {
                            updateKeyframe(tId, clipId, keyframeId, {
                              volume,
                            });
                          }}
                          onMoveKeyframe={(tId, clipId, keyframeId, timeMs) => {
                            moveKeyframe(tId, clipId, keyframeId, timeMs);
                          }}
                          onDeleteKeyframe={(tId, clipId, keyframeId) => {
                            deleteKeyframe(tId, clipId, keyframeId);
                          }}
                          onSelectKeyframe={(tId, clipId, keyframeId) => {
                            selectClip(tId, clipId, 'replace');
                            setSelectedKeyframeId(keyframeId);
                          }}
                        />
                        {/* Playhead line on automation lane */}
                        <div
                          className='absolute top-0 bottom-0 w-px bg-red-500/50 z-10 pointer-events-none'
                          style={{
                            left: playheadPx,
                            transition: zoomAnimating
                              ? `left ${ZOOM_TRANSITION_MS}ms ease-out`
                              : undefined,
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}

          {/* Add Track button */}
          {!showStreamsSpinner && (
            <div
              className='flex border-b border-border/50'
              style={{ height: TRACK_HEIGHT }}>
              <div
                className='shrink-0 bg-muted/40 flex items-center px-2 sticky left-0 z-10 border-r border-border/30'
                style={{ width: sourcesWidth }}>
                <Button
                  variant='ghost'
                  size='sm'
                  className='flex items-center gap-1.5 text-xs text-muted-foreground hover:text-card-foreground hover:bg-card px-2 py-1 cursor-pointer'
                  onClick={() => addTrack()}
                  title='Add empty track'>
                  <Plus className='w-3 h-3' />
                  <span>Add Track</span>
                </Button>
              </div>
            </div>
          )}
        </div>

        {isTimelineInteractionLocked && (
          <div className='absolute inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm'>
            <div className='flex items-center gap-2 text-card-foreground text-sm'>
              <LoadingSpinner size='sm' variant='spinner' />
              <span>
                {timelineStopTimeoutActive
                  ? 'Stopping timeline is taking longer than expected...'
                  : `${timelineBusyLabel}...`}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu &&
        createPortal(
          <div
            ref={contextMenuRef}
            className='fixed z-[9999] bg-card border border-border rounded-lg shadow-xl py-1 min-w-[160px]'
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}>
            {contextMenu.trackId !== OUTPUT_TRACK_ID && (
              <>
                <Button
                  variant='ghost'
                  className='w-full justify-start rounded-none py-1.5 px-3 text-sm text-foreground hover:bg-accent cursor-pointer'
                  onClick={handleFx}>
                  FX / Shaders
                </Button>
                <Button
                  variant='ghost'
                  className='w-full justify-start rounded-none py-1.5 px-3 text-sm text-foreground hover:bg-accent cursor-pointer'
                  onClick={handleMuteToggle}>
                  {contextMenu.isMuted ? 'Unmute' : 'Mute'}
                </Button>
              </>
            )}
            {contextMenu.clipId && (
              <div
                className='relative'
                onMouseEnter={() => {
                  if (colorSubmenuCloseTimer.current) {
                    clearTimeout(colorSubmenuCloseTimer.current);
                    colorSubmenuCloseTimer.current = null;
                  }
                  setColorSubmenuOpen(true);
                }}
                onMouseLeave={() => {
                  colorSubmenuCloseTimer.current = setTimeout(() => {
                    setColorSubmenuOpen(false);
                    setLongPressColor(null);
                    colorSubmenuCloseTimer.current = null;
                  }, 150);
                }}>
                <Button
                  variant='ghost'
                  className='w-full justify-between rounded-none py-1.5 px-3 text-sm text-foreground hover:bg-accent cursor-pointer'
                  onClick={() => setColorSubmenuOpen((v) => !v)}>
                  <span>Color</span>
                  <ChevronRight className='w-3.5 h-3.5 text-muted-foreground' />
                </Button>
                {colorSubmenuOpen && (
                  <div
                    className='absolute left-full top-0 bg-card border border-border rounded-lg shadow-xl py-2 px-2 z-[10000]'
                    style={{ minWidth: 140 }}
                    onMouseEnter={() => {
                      if (colorSubmenuCloseTimer.current) {
                        clearTimeout(colorSubmenuCloseTimer.current);
                        colorSubmenuCloseTimer.current = null;
                      }
                    }}>
                    {longPressColor ? (
                      <>
                        <Button
                          variant='ghost'
                          size='sm'
                          className='flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1.5 cursor-pointer'
                          onClick={() => setLongPressColor(null)}>
                          <ChevronLeft className='w-3 h-3' />
                          <span
                            className='w-3 h-3 rounded-sm border border-border inline-block'
                            style={{ backgroundColor: longPressColor }}
                          />
                          <span>Shades</span>
                        </Button>
                        <div className='grid grid-cols-7 gap-1.5'>
                          {generateShades(longPressColor).map((shade) => (
                            <Button
                              key={shade}
                              variant='ghost'
                              size='icon'
                              className='w-5 h-5 rounded-sm border border-border hover:scale-125 transition-transform cursor-pointer p-0'
                              style={{ backgroundColor: shade }}
                              title={shade}
                              onClick={() => handleSetClipColor(shade)}
                            />
                          ))}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className='grid grid-cols-5 gap-1.5 mb-2'>
                          {TIMELINE_COLOR_PRESETS.map((color) => (
                            <ColorSwatch
                              key={color}
                              color={color}
                              onQuickClick={handleSetClipColor}
                              onLongPress={setLongPressColor}
                            />
                          ))}
                        </div>
                        <div className='flex items-center gap-2 mb-1.5'>
                          <label className='text-xs text-muted-foreground'>
                            Custom
                          </label>
                          <input
                            type='color'
                            className='w-6 h-5 bg-transparent border-none cursor-pointer'
                            defaultValue={(() => {
                              const track = state.tracks.find(
                                (t) => t.id === contextMenu.trackId,
                              );
                              const clip = track?.clips.find(
                                (c) => c.id === contextMenu.clipId,
                              );
                              return (
                                clip?.blockSettings.timelineColor ?? '#3b82f6'
                              );
                            })()}
                            onChange={(e) => handleSetClipColor(e.target.value)}
                          />
                        </div>
                        <Button
                          variant='ghost'
                          size='sm'
                          className='w-full justify-start py-1 px-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer'
                          onClick={() => handleSetClipColor(undefined)}>
                          Reset to default
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
            {contextMenu.trackId !== OUTPUT_TRACK_ID && (
              <Button
                variant='ghost'
                className='w-full justify-start rounded-none py-1.5 px-3 text-sm text-red-400 hover:bg-accent hover:text-red-300 cursor-pointer'
                onClick={handleDelete}>
                Delete
              </Button>
            )}
            {contextMenu.clipId && contextMenu.clipId !== OUTPUT_CLIP_ID && (
              <>
                <div className='h-px bg-secondary my-1' />
                {selectedClipIds.length <= 1 && (
                  <Button
                    variant='ghost'
                    className='w-full justify-start rounded-none py-1.5 px-3 text-sm text-foreground hover:bg-accent cursor-pointer'
                    onClick={handleSplitHere}>
                    Split Here
                  </Button>
                )}
                <Button
                  variant='ghost'
                  className='w-full justify-start rounded-none py-1.5 px-3 text-sm text-red-400 hover:bg-accent hover:text-red-300 cursor-pointer'
                  onClick={handleDeleteClip}>
                  {selectedClipIds.length > 1
                    ? `Delete ${selectedClipIds.length} Clips`
                    : 'Delete Clip'}
                </Button>
              </>
            )}
            {contextMenu.trackId !== OUTPUT_TRACK_ID &&
              (() => {
                const ctxTrackIdx = state.tracks.findIndex(
                  (t) => t.id === contextMenu.trackId,
                );
                const canMoveUp =
                  ctxTrackIdx > 0 &&
                  state.tracks[ctxTrackIdx - 1]?.id !== OUTPUT_TRACK_ID;
                const canMoveDown =
                  ctxTrackIdx >= 0 &&
                  ctxTrackIdx < state.tracks.length - 1 &&
                  state.tracks[ctxTrackIdx + 1]?.id !== OUTPUT_TRACK_ID;
                return (
                  <>
                    <div className='h-px bg-secondary my-1' />
                    <Button
                      variant='ghost'
                      className='w-full justify-start rounded-none py-1.5 px-3 text-sm text-foreground hover:bg-accent cursor-pointer disabled:opacity-40 disabled:cursor-default'
                      disabled={!canMoveUp}
                      onClick={() => {
                        reorderTrack(contextMenu.trackId, ctxTrackIdx - 1);
                        closeContextMenu();
                      }}>
                      Move Up
                    </Button>
                    <Button
                      variant='ghost'
                      className='w-full justify-start rounded-none py-1.5 px-3 text-sm text-foreground hover:bg-accent cursor-pointer disabled:opacity-40 disabled:cursor-default'
                      disabled={!canMoveDown}
                      onClick={() => {
                        reorderTrack(contextMenu.trackId, ctxTrackIdx + 1);
                        closeContextMenu();
                      }}>
                      Move Down
                    </Button>
                    <Button
                      variant='ghost'
                      className='w-full justify-start rounded-none py-1.5 px-3 text-sm text-foreground hover:bg-accent cursor-pointer'
                      onClick={() => {
                        setEditingTrackId(contextMenu.trackId);
                        const track = state.tracks.find(
                          (t) => t.id === contextMenu.trackId,
                        );
                        setEditingTrackLabel(track?.label ?? '');
                        closeContextMenu();
                      }}>
                      Rename Track
                    </Button>
                    <Button
                      variant='ghost'
                      className='w-full justify-start rounded-none py-1.5 px-3 text-sm text-red-400 hover:bg-accent hover:text-red-300 cursor-pointer'
                      onClick={() => {
                        deleteTrack(contextMenu.trackId);
                        closeContextMenu();
                      }}>
                      Delete Track
                    </Button>
                  </>
                );
              })()}
          </div>,
          document.body,
        )}

      {/* Keyframe tooltip */}
      {hoveredKeyframe &&
        createPortal(
          <div
            className='fixed z-[10000] pointer-events-none'
            style={{
              left: hoveredKeyframe.rect.left + hoveredKeyframe.rect.width / 2,
              top: hoveredKeyframe.rect.top - 8,
              transform: 'translate(-50%, -100%)',
            }}>
            <div className='bg-background border border-border rounded px-2.5 py-1.5 text-[10px] text-foreground shadow-lg max-w-[240px]'>
              <div className='font-medium text-foreground mb-0.5'>
                {hoveredKeyframe.timeMs === 0
                  ? 'Base keyframe (0ms)'
                  : `Keyframe at ${formatMs(hoveredKeyframe.timeMs)}`}
              </div>
              {hoveredKeyframe.timeMs === 0 ? (
                <div className='text-muted-foreground'>Initial values</div>
              ) : hoveredKeyframe.diffs.length === 0 ? (
                <div className='text-muted-foreground'>
                  No changes from previous
                </div>
              ) : (
                <ul className='space-y-px'>
                  {hoveredKeyframe.diffs.map((diff, i) => (
                    <li key={i} className='text-card-foreground truncate'>
                      {diff}
                    </li>
                  ))}
                </ul>
              )}
            </div>
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
              className='bg-background border border-border rounded-xl shadow-2xl w-[520px] max-h-[80vh] overflow-y-auto'
              onClick={(e) => e.stopPropagation()}>
              <div className='flex items-center justify-between px-5 py-3 border-b border-border'>
                <h2 className='text-sm font-semibold text-foreground'>
                  Keyboard Shortcuts
                </h2>
                <Button
                  variant='ghost'
                  size='icon'
                  className='h-6 w-6 text-muted-foreground hover:text-foreground cursor-pointer'
                  onClick={() => setShowHelp(false)}>
                  <X className='w-4 h-4' />
                </Button>
              </div>
              <div className='p-5 space-y-4 text-[13px]'>
                <ShortcutGroup
                  title='Playback & Navigation'
                  items={[
                    ['Space', 'Play / Pause'],
                    ['Home', 'Go to start'],
                    ['End', 'Go to end'],
                    ['← / →', 'Move playhead ±1s'],
                    ['Shift + ← / →', 'Move playhead ±5s'],
                    ['Shift + Drag ruler', 'Snap playhead to nearby targets'],
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
                    [
                      'Shift + Drag',
                      'Lock horizontal position (vertical only)',
                    ],
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

      <ResolveMissingAssetModal
        open={resolveMissingInputId !== null}
        onOpenChange={(o) => {
          if (!o) setResolveMissingInputId(null);
        }}
        roomId={roomId}
        input={
          resolveMissingInputId
            ? (inputs.find((i) => i.inputId === resolveMissingInputId) ?? null)
            : null
        }
        refreshState={refreshState}
      />
    </div>
  );
});
