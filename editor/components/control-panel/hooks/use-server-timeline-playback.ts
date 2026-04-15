'use client';

import { useCallback, useRef, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  startTimelinePlayback,
  stopTimelinePlayback,
  seekTimeline,
  pauseTimeline,
  applyTimelineState,
} from '@/app/actions/actions';
import { toServerTimelineConfig } from '@/lib/timeline-config';
import { useTimelineSSE } from '@/hooks/use-timeline-sse';
import type { TimelineState } from './use-timeline-state';
import { OUTPUT_TRACK_ID } from './use-timeline-state';
import {
  listenTimelineEvent,
  TIMELINE_EVENTS,
} from '../components/timeline/timeline-events';

const PLAYHEAD_UI_UPDATE_INTERVAL_MS = 33;
const AUTO_PAUSE_BEFORE_END_MS = 2000;
const STOP_AND_APPLY_TIMEOUT_MS = 10_000;

export function useServerTimelinePlayback(
  roomId: string,
  state: TimelineState,
  setPlayhead: (ms: number) => void,
  setPlaying: (playing: boolean) => void,
) {
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const rafRef = useRef<number | null>(null);
  const lastSSERef = useRef<{ wallMs: number; playheadMs: number } | null>(
    null,
  );
  const lastPlayheadUpdateRef = useRef<{ ts: number; ms: number | null }>({
    ts: 0,
    ms: null,
  });

  const [isPaused, setIsPaused] = useState(false);
  const [isTimelineBusy, setIsTimelineBusy] = useState(false);
  const [timelineBusyOperation, setTimelineBusyOperation] = useState<
    'play' | 'stop' | 'seek' | 'apply' | null
  >(null);
  const [timelineBusyStage, setTimelineBusyStage] = useState<
    'idle' | 'running' | 'failed'
  >('idle');
  const autoPauseBeforeEndTriggeredRef = useRef(false);
  const stopInFlightRef = useRef<Promise<void> | null>(null);
  const timelineToastId = useRef(`timeline-ops-${roomId}`);
  const wasBusyRef = useRef(false);
  const seenFailedOperationRef = useRef<string | null>(null);
  useEffect(() => {
    timelineToastId.current = `timeline-ops-${roomId}`;
    seenFailedOperationRef.current = null;
    wasBusyRef.current = false;
  }, [roomId]);

  const sseData = useTimelineSSE(roomId, true);
  const sseCountRef = useRef(0);

  const pushPlayheadUpdate = useCallback(
    (ms: number, options?: { force?: boolean }) => {
      const now = performance.now();
      const clampedMs = Math.round(
        Math.max(0, Math.min(ms, stateRef.current.totalDurationMs)),
      );
      if (lastPlayheadUpdateRef.current.ms === clampedMs) {
        return;
      }
      if (
        !options?.force &&
        now - lastPlayheadUpdateRef.current.ts < PLAYHEAD_UI_UPDATE_INTERVAL_MS
      ) {
        return;
      }
      lastPlayheadUpdateRef.current = {
        ts: now,
        ms: clampedMs,
      };
      setPlayhead(clampedMs);
    },
    [setPlayhead],
  );

  useEffect(() => {
    if (!sseData) return;
    sseCountRef.current += 1;
    const busy = sseData.busy === true;
    const operation = sseData.operation ?? null;
    const stage = sseData.stage ?? 'idle';
    const opKey = `${sseData.operationId ?? 'none'}:${stage}`;
    setIsTimelineBusy(busy);
    setTimelineBusyOperation(operation);
    setTimelineBusyStage(stage);

    if (busy) {
      const label = operation
        ? `Timeline: ${operation}...`
        : 'Timeline busy...';
      toast.loading(label, { id: timelineToastId.current });
      wasBusyRef.current = true;
    } else if (stage === 'failed') {
      if (seenFailedOperationRef.current !== opKey) {
        toast.error('Timeline operation failed.', {
          id: timelineToastId.current,
          duration: 5000,
        });
        seenFailedOperationRef.current = opKey;
      }
      wasBusyRef.current = false;
    } else if (wasBusyRef.current) {
      toast.dismiss(timelineToastId.current);
      wasBusyRef.current = false;
    }

    if (sseData.isPaused && !isPaused) {
      setIsPaused(true);
    }

    if (!sseData.isPlaying && !sseData.isPaused && stateRef.current.isPlaying) {
      console.log(
        `[timeline-ui] SSE signaled stop (sseCount=${sseCountRef.current} playhead=${sseData.playheadMs})`,
      );
      setPlaying(false);
      setIsPaused(false);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastSSERef.current = null;
      return;
    }

    if (sseData.isPlaying) {
      if (sseCountRef.current <= 3 || sseCountRef.current % 25 === 0) {
        console.log(
          `[timeline-ui] SSE update #${sseCountRef.current} playhead=${sseData.playheadMs}`,
        );
      }
      lastSSERef.current = {
        wallMs: performance.now(),
        playheadMs: sseData.playheadMs,
      };
      pushPlayheadUpdate(sseData.playheadMs, { force: true });
    }
  }, [sseData, pushPlayheadUpdate, setPlaying, isPaused]);

  useEffect(() => {
    if (!state.isPlaying) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const tick = () => {
      const base = lastSSERef.current;
      if (!base) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const elapsed = performance.now() - base.wallMs;
      const interpolated = base.playheadMs + elapsed;
      const totalDuration = stateRef.current.totalDurationMs;

      if (interpolated >= totalDuration) {
        pushPlayheadUpdate(totalDuration, { force: true });
        return;
      }

      pushPlayheadUpdate(interpolated);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [state.isPlaying, pushPlayheadUpdate]);

  const play = useCallback(async () => {
    if (stateRef.current.isPlaying) return;

    const config = toServerTimelineConfig(stateRef.current);
    const fromMs = stateRef.current.playheadMs;
    console.log(
      `[timeline-ui] PLAY requested fromMs=${fromMs} isPaused=${isPaused} tracks=${config.tracks.length} totalDuration=${config.totalDurationMs}`,
    );
    sseCountRef.current = 0;

    autoPauseBeforeEndTriggeredRef.current = false;
    try {
      await startTimelinePlayback(roomId, config, fromMs);
      console.log(`[timeline-ui] PLAY server acknowledged`);
      lastSSERef.current = {
        wallMs: performance.now(),
        playheadMs: fromMs,
      };
      setIsPaused(false);
      setPlaying(true);
    } catch (err) {
      console.error('[timeline-ui] PLAY failed', err);
      setPlaying(false);
      lastSSERef.current = null;
    }
  }, [roomId, setPlaying, isPaused]);

  const pause = useCallback(async () => {
    setPlaying(false);
    setIsPaused(true);
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    lastSSERef.current = null;

    try {
      const result = await pauseTimeline(roomId);
      pushPlayheadUpdate(result.playheadMs, { force: true });
    } catch (err) {
      console.error('[timeline-ui] PAUSE failed', err);
      setIsPaused(false);
    }
  }, [roomId, pushPlayheadUpdate, setPlaying]);

  const stop = useCallback(async () => {
    if (stopInFlightRef.current) {
      return stopInFlightRef.current;
    }
    const stopPromise = (async () => {
      const toastId = timelineToastId.current;
      toast.loading('Stopping timeline and applying snapshot...', {
        id: toastId,
      });
      autoPauseBeforeEndTriggeredRef.current = false;
      setPlaying(false);
      setIsPaused(false);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastSSERef.current = null;
      pushPlayheadUpdate(0, { force: true });

      const stopAndApplyPromise = (async () => {
        await stopTimelinePlayback(roomId);
        const config = toServerTimelineConfig(stateRef.current);
        if (config.tracks.length === 0) return;
        await applyTimelineState(roomId, config, 0);
      })();

      const result = await Promise.race([
        stopAndApplyPromise.then(() => 'done' as const),
        new Promise<'timeout'>((resolve) =>
          setTimeout(() => resolve('timeout'), STOP_AND_APPLY_TIMEOUT_MS),
        ),
      ]);

      if (result === 'timeout') {
        toast.warning('Timeline stop is taking longer than expected.', {
          id: toastId,
          duration: 5000,
        });
        stopAndApplyPromise
          .then(() => {
            toast.success('Timeline stop recovered.', {
              id: toastId,
              duration: 2500,
            });
          })
          .catch((err) => {
            console.error('[timeline-ui] stop+apply after timeout failed', err);
            toast.error('Timeline stop failed after timeout.', {
              id: toastId,
              duration: 5000,
            });
          });
        return;
      }

      toast.success('Timeline stopped.', { id: toastId, duration: 2000 });
    })()
      .catch((err) => {
        console.error('[timeline-ui] stop+apply failed', err);
        toast.error('Failed to stop timeline.', {
          id: timelineToastId.current,
          duration: 5000,
        });
      })
      .finally(() => {
        stopInFlightRef.current = null;
      });
    stopInFlightRef.current = stopPromise;
    return stopPromise;
  }, [roomId, pushPlayheadUpdate, setPlaying]);

  const seek = useCallback(
    async (ms: number) => {
      autoPauseBeforeEndTriggeredRef.current = false;
      console.log(`[timeline-ui] SEEK to ${ms}ms`);
      pushPlayheadUpdate(ms, { force: true });
      lastSSERef.current = {
        wallMs: performance.now(),
        playheadMs: ms,
      };

      try {
        await seekTimeline(roomId, ms);
      } catch (err) {
        console.error('[timeline-ui] SEEK failed', err);
      }
    },
    [roomId, pushPlayheadUpdate],
  );

  const applyAtPlayhead = useCallback(async () => {
    const config = toServerTimelineConfig(stateRef.current);
    if (config.tracks.length === 0) return;
    const playheadMs = stateRef.current.playheadMs;
    try {
      await applyTimelineState(roomId, config, playheadMs);
      setIsPaused(true);
    } catch (err) {
      console.error('[timeline-ui] applyAtPlayhead failed', err);
    }
  }, [roomId]);

  useEffect(() => {
    return listenTimelineEvent(TIMELINE_EVENTS.APPLY_AT_PLAYHEAD, () => {
      void applyAtPlayhead();
    });
  }, [applyAtPlayhead]);

  const hasAutoApplied = useRef(false);
  useEffect(() => {
    hasAutoApplied.current = false;
  }, [roomId]);

  useEffect(() => {
    if (!state.isPlaying) {
      autoPauseBeforeEndTriggeredRef.current = false;
      return;
    }

    if (state.totalDurationMs <= AUTO_PAUSE_BEFORE_END_MS) {
      return;
    }

    const autoPauseAtMs = Math.max(
      0,
      state.totalDurationMs - AUTO_PAUSE_BEFORE_END_MS,
    );
    if (state.playheadMs < autoPauseAtMs) {
      autoPauseBeforeEndTriggeredRef.current = false;
      return;
    }

    if (autoPauseBeforeEndTriggeredRef.current) {
      return;
    }
    autoPauseBeforeEndTriggeredRef.current = true;
    pushPlayheadUpdate(autoPauseAtMs, { force: true });
    void pause();
  }, [
    state.isPlaying,
    state.playheadMs,
    state.totalDurationMs,
    pause,
    pushPlayheadUpdate,
  ]);

  useEffect(() => {
    if (hasAutoApplied.current) return;
    const hasClips = state.tracks.some(
      (track) => track.id !== OUTPUT_TRACK_ID && track.clips.length > 0,
    );
    if (!hasClips) return;
    hasAutoApplied.current = true;
    void applyAtPlayhead();
  }, [state.tracks, roomId, applyAtPlayhead]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      toast.dismiss(timelineToastId.current);
    };
  }, []);

  return {
    play,
    pause,
    stop,
    seek,
    applyAtPlayhead,
    isPaused,
    isTimelineBusy,
    timelineBusyOperation,
    timelineBusyStage,
  };
}
