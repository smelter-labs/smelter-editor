'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { Input, Layer } from '@/lib/types';
import type { TimelineState } from '../../hooks/use-timeline-state';
import { OUTPUT_TRACK_INPUT_ID } from '../../hooks/use-timeline-state';
import { AlertTriangle } from 'lucide-react';
import LoadingSpinner from '@/components/ui/spinner';
import { toast } from 'sonner';
import { createElement } from 'react';

type ServerPlayback = {
  play: () => Promise<void>;
  pause: () => Promise<void>;
  stop: () => Promise<void>;
  applyAtPlayhead: () => Promise<void>;
  isPaused: boolean;
  isTimelineClientPending: boolean;
  isTimelineInteractionLocked: boolean;
  timelineBusyOperation: string | null;
  timelineBusyStage: 'idle' | 'running' | 'failed';
  timelineBusyPhase: string | null;
  timelineStopTimeoutActive: boolean;
};

type Params = {
  state: TimelineState;
  inputs: Input[];
  layers: Layer[];
  serverPlayback: ServerPlayback;
  recording: {
    isTogglingRecording: boolean;
    effectiveIsRecording: boolean;
    start: () => Promise<boolean>;
    stopAndDownload: () => Promise<void>;
  };
  updateClipSettings: (
    trackId: string,
    clipId: string,
    patch: Record<string, unknown>,
  ) => void;
  onBeforePlay?: () => Promise<boolean>;
  onTimelineActionsReady?: (
    actions: {
      applyAtPlayhead: () => Promise<void>;
      play: () => Promise<void>;
      recordAndPlay: () => Promise<void>;
      commitSceneAtPlayheadToTimeline: () => void;
    } | null,
  ) => void;
  onTimelineQueueStateChange?: (locked: boolean) => void;
};

export type TimelineInlineStatus = {
  toneClass: string;
  text: string;
  icon: ReactNode;
} | null;

export type TimelinePlaybackResult = {
  play: () => Promise<void>;
  pause: () => Promise<void>;
  stop: () => Promise<void>;
  applyAtPlayhead: () => Promise<void>;
  recordAndPlay: () => Promise<void>;
  commitSceneAtPlayheadToTimeline: () => void;
  isRecording: boolean;
  isTogglingRecording: boolean;
  isPaused: boolean;
  timelineControlsDisabled: boolean;
  timelineInlineStatus: TimelineInlineStatus;
  timelineBusyLabel: string;
  isTimelineInteractionLocked: boolean;
  timelineStopTimeoutActive: boolean;
};

export function useTimelinePlayback({
  state,
  inputs,
  layers,
  serverPlayback,
  recording,
  updateClipSettings,
  onBeforePlay,
  onTimelineActionsReady,
  onTimelineQueueStateChange,
}: Params): TimelinePlaybackResult {
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
  } = serverPlayback;

  const {
    isTogglingRecording,
    effectiveIsRecording: isRecording,
    start: startRec,
    stopAndDownload,
  } = recording;

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

  const timelineInlineStatus: TimelineInlineStatus = (() => {
    if (timelineBusyStage === 'failed') {
      return {
        toneClass: 'text-red-400',
        text: 'Timeline operation failed',
        icon: createElement(AlertTriangle, { className: 'h-3 w-3' }),
      };
    }
    if (timelineStopTimeoutActive) {
      return {
        toneClass: 'text-amber-400',
        text: 'Stop takes longer than expected',
        icon: createElement(AlertTriangle, { className: 'h-3 w-3' }),
      };
    }
    if (isTimelineInteractionLocked) {
      return {
        toneClass: 'text-muted-foreground',
        text: `${timelineBusyLabel}...`,
        icon: createElement(LoadingSpinner, { size: 'sm', variant: 'spinner' }),
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

  return {
    play: handlePlay,
    pause: handlePlayPauseToggle,
    stop: handleStop,
    applyAtPlayhead: handleApplyAtPlayhead,
    recordAndPlay: handleRecordAndPlay,
    commitSceneAtPlayheadToTimeline,
    isRecording,
    isTogglingRecording,
    isPaused,
    timelineControlsDisabled,
    timelineInlineStatus,
    timelineBusyLabel,
    isTimelineInteractionLocked,
    timelineStopTimeoutActive,
  };
}
