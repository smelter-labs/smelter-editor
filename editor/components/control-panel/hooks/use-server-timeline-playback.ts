'use client';

import { useCallback, useRef, useEffect, useState } from 'react';
import {
  startTimelinePlayback,
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
const STOP_BUSY_TIMEOUT_MS = 2500;

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
  const [timelineClientPendingCount, setTimelineClientPendingCount] =
    useState(0);
  const [timelineBusyOperation, setTimelineBusyOperation] = useState<
    'play' | 'stop' | 'seek' | 'apply' | null
  >(null);
  const [timelineBusyStage, setTimelineBusyStage] = useState<
    'idle' | 'running' | 'failed'
  >('idle');
  const [timelineBusyPhase, setTimelineBusyPhase] = useState<
    | 'stopping-playback'
    | 'seeking-to-zero'
    | 'waiting-before-apply'
    | 'applying-state'
    | null
  >(null);
  const [busyTimeoutFallbackActive, setBusyTimeoutFallbackActive] =
    useState(false);
  const isTimelineClientPending = timelineClientPendingCount > 0;
  const autoPauseBeforeEndTriggeredRef = useRef(false);
  const stopInFlightRef = useRef<Promise<void> | null>(null);
  useEffect(() => {
    setBusyTimeoutFallbackActive(false);
  }, [roomId]);

  const sseData = useTimelineSSE(roomId, true);
  const sseCountRef = useRef(0);
  const runWithClientPending = useCallback(
    async <T>(
      operation: () => Promise<T>,
      options?: { stopTimeoutMs?: number },
    ): Promise<T> => {
      setTimelineClientPendingCount((prev) => prev + 1);
      let timeoutId: number | null = null;
      if (options?.stopTimeoutMs) {
        timeoutId = window.setTimeout(() => {
          setBusyTimeoutFallbackActive(true);
        }, options.stopTimeoutMs);
      }
      try {
        return await operation();
      } finally {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
          setBusyTimeoutFallbackActive(false);
        }
        setTimelineClientPendingCount((prev) => Math.max(0, prev - 1));
      }
    },
    [],
  );

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
    const phase = sseData.phase ?? null;
    setIsTimelineBusy(busy);
    setTimelineBusyOperation(operation);
    setTimelineBusyStage(stage);
    setTimelineBusyPhase(phase);
    if (!busy && busyTimeoutFallbackActive) {
      setBusyTimeoutFallbackActive(false);
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
  }, [
    sseData,
    pushPlayheadUpdate,
    setPlaying,
    isPaused,
    busyTimeoutFallbackActive,
  ]);

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
    setBusyTimeoutFallbackActive(false);

    const config = toServerTimelineConfig(stateRef.current);
    const fromMs = stateRef.current.playheadMs;
    console.log(
      `[timeline-ui] PLAY requested fromMs=${fromMs} isPaused=${isPaused} tracks=${config.tracks.length} totalDuration=${config.totalDurationMs}`,
    );
    sseCountRef.current = 0;

    autoPauseBeforeEndTriggeredRef.current = false;
    await runWithClientPending(async () => {
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
        throw err;
      }
    });
  }, [roomId, setPlaying, isPaused, runWithClientPending]);

  const pause = useCallback(async () => {
    setBusyTimeoutFallbackActive(false);
    setPlaying(false);
    setIsPaused(true);
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    lastSSERef.current = null;

    await runWithClientPending(async () => {
      try {
        const result = await pauseTimeline(roomId);
        pushPlayheadUpdate(result.playheadMs, { force: true });
      } catch (err) {
        console.error('[timeline-ui] PAUSE failed', err);
        setIsPaused(false);
        throw err;
      }
    });
  }, [roomId, pushPlayheadUpdate, setPlaying, runWithClientPending]);

  const stop = useCallback(async () => {
    if (stopInFlightRef.current) {
      return stopInFlightRef.current;
    }
    const stopPromise = (async () => {
      await runWithClientPending(
        async () => {
          let stopError: unknown = null;
          autoPauseBeforeEndTriggeredRef.current = false;
          setPlaying(false);
          if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
          }
          lastSSERef.current = null;
          setBusyTimeoutFallbackActive(false);
          try {
            const result = await pauseTimeline(roomId);
            pushPlayheadUpdate(result.playheadMs, { force: true });
          } catch (err) {
            console.error('[timeline-ui] PAUSE in stop failed', err);
            stopError = err;
          }
          pushPlayheadUpdate(0, { force: true });
          const config = toServerTimelineConfig(stateRef.current);
          if (config.tracks.length > 0) {
            try {
              await applyTimelineState(roomId, config, 0);
            } catch (err) {
              console.error('[timeline-ui] apply at 0 in stop failed', err);
              stopError = stopError ?? err;
            }
          }
          setIsPaused(true);
          if (stopError) {
            throw stopError;
          }
        },
        {
          stopTimeoutMs: STOP_BUSY_TIMEOUT_MS,
        },
      );
    })().finally(() => {
      stopInFlightRef.current = null;
    });
    stopInFlightRef.current = stopPromise;
    return stopPromise;
  }, [roomId, pushPlayheadUpdate, setPlaying, runWithClientPending]);

  const seek = useCallback(
    async (ms: number) => {
      setBusyTimeoutFallbackActive(false);
      autoPauseBeforeEndTriggeredRef.current = false;
      console.log(`[timeline-ui] SEEK to ${ms}ms`);
      pushPlayheadUpdate(ms, { force: true });
      lastSSERef.current = {
        wallMs: performance.now(),
        playheadMs: ms,
      };

      await runWithClientPending(async () => {
        try {
          await seekTimeline(roomId, ms);
        } catch (err) {
          console.error('[timeline-ui] SEEK failed', err);
          throw err;
        }
      });
    },
    [roomId, pushPlayheadUpdate, runWithClientPending],
  );

  const applyAtPlayhead = useCallback(async () => {
    setBusyTimeoutFallbackActive(false);
    const config = toServerTimelineConfig(stateRef.current);
    if (config.tracks.length === 0) return;
    const playheadMs = stateRef.current.playheadMs;
    await runWithClientPending(async () => {
      try {
        await applyTimelineState(roomId, config, playheadMs);
        setIsPaused(true);
      } catch (err) {
        console.error('[timeline-ui] applyAtPlayhead failed', err);
        throw err;
      }
    });
  }, [roomId, runWithClientPending]);

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
    void pause().catch((err) => {
      console.error('[timeline-ui] auto pause failed', err);
    });
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
    void applyAtPlayhead().catch((err) => {
      console.error('[timeline-ui] auto applyAtPlayhead failed', err);
    });
  }, [state.tracks, roomId, applyAtPlayhead]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
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
    isTimelineClientPending,
    isTimelineInteractionLocked: isTimelineBusy || isTimelineClientPending,
    timelineBusyOperation,
    timelineBusyStage,
    timelineBusyPhase,
    timelineStopTimeoutActive: busyTimeoutFallbackActive,
  };
}
