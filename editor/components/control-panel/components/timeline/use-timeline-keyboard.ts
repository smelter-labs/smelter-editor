'use client';

import { useCallback, useEffect } from 'react';
import type { TimelineState } from '../../hooks/use-timeline-state';
import { shouldIgnoreGlobalShortcut } from '@/lib/keyboard';
import { findOrphanedInputIds, getContentExtentMs } from './timeline-utils';

type Params = {
  state: TimelineState;
  selectedClipIds: { trackId: string; clipId: string }[];
  selectedInputId: string | null;
  setSelectedClipIds: (
    updater:
      | { trackId: string; clipId: string }[]
      | ((
          prev: { trackId: string; clipId: string }[],
        ) => { trackId: string; clipId: string }[]),
  ) => void;
  setSelectedKeyframeId: (id: string | null) => void;
  setShowHelp: (v: boolean | ((prev: boolean) => boolean)) => void;
  setPlayhead: (ms: number) => void;
  handlePlayPauseToggle: () => Promise<void>;
  animateZoom: (pps: number) => void;
  scrollToPlayhead: () => void;
  jumpToEdge: (direction: 'prev' | 'next') => void;
  findClipAtPlayhead: (trackId: string) => string | null;
  splitClip: (trackId: string, clipId: string, atMs: number) => void;
  duplicateClip: (trackId: string, clipId: string) => void;
  deleteClips: (clips: { trackId: string; clipId: string }[]) => void;
  deleteTrack: (trackId: string) => void;
  undo: () => void;
  redo: () => void;
  removeInput: (roomId: string, inputId: string) => Promise<void>;
  purgeInputId: (inputId: string) => void;
  refreshState: () => Promise<void>;
  roomId: string;
  sourcesWidth: number;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
};

export type TimelineKeyboardResult = {
  deleteClipsAndRemoveOrphans: (
    clipsToDelete: { trackId: string; clipId: string }[],
  ) => Promise<void>;
};

export function useTimelineKeyboard({
  state,
  selectedClipIds,
  selectedInputId,
  setSelectedClipIds,
  setSelectedKeyframeId,
  setShowHelp,
  setPlayhead,
  handlePlayPauseToggle,
  animateZoom,
  scrollToPlayhead,
  jumpToEdge,
  findClipAtPlayhead,
  splitClip,
  duplicateClip,
  deleteClips,
  deleteTrack,
  undo,
  redo,
  removeInput,
  purgeInputId,
  refreshState,
  roomId,
  sourcesWidth,
  scrollContainerRef,
}: Params): TimelineKeyboardResult {
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
      // Don't intercept typing in any editable field (including contenteditable).
      if (shouldIgnoreGlobalShortcut(e.target)) return;

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
          if (!e.ctrlKey) break;
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

  return { deleteClipsAndRemoveOrphans };
}
