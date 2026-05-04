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
import { resolveSsePlayheadSync } from './timeline-playhead-sync';
import {
  listenTimelineEvent,
  TIMELINE_EVENTS,
} from '../components/timeline/timeline-events';

const PLAYHEAD_UI_UPDATE_INTERVAL_MS = 33;
const PLAYHEAD_BACKWARD_TOLERANCE_MS = 120;
const AUTO_PAUSE_BEFORE_END_MS = 1000;
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
  const uiPlayheadMsRef = useRef(state.playheadMs);
  useEffect(() => {
    uiPlayheadMsRef.current = state.playheadMs;
  }, [state.playheadMs]);

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
  const awaitingStartPlaybackSSERef = useRef(false);
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
    (
      ms: number,
      options?: {
        force?: boolean;
        allowBackward?: boolean;
      },
    ) => {
      const now = performance.now();
      const clampedMs = Math.round(
        Math.max(0, Math.min(ms, stateRef.current.totalDurationMs)),
      );
      const previousUiMs = uiPlayheadMsRef.current;
      if (
        options?.allowBackward === false &&
        clampedMs < previousUiMs - PLAYHEAD_BACKWARD_TOLERANCE_MS
      ) {
        // Timeline SSE can arrive slightly delayed relative to local interpolation.
        // While playing, ignore stale backward jumps to keep the playhead monotonic.
        return;
      }
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
      uiPlayheadMsRef.current = clampedMs;
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
      if (awaitingStartPlaybackSSERef.current) {
        // Ignore transient idle snapshots right after PLAY request.
        return;
      }
      console.log(
        `[timeline-ui] SSE signaled stop (sseCount=${sseCountRef.current} playhead=${sseData.playheadMs})`,
      );
      awaitingStartPlaybackSSERef.current = false;
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
      const awaitingStartPlaybackSSE = awaitingStartPlaybackSSERef.current;
      if (sseCountRef.current <= 3 || sseCountRef.current % 25 === 0) {
        console.log(
          `[timeline-ui] SSE update #${sseCountRef.current} playhead=${sseData.playheadMs}`,
        );
      }
      const { nextPlayheadMs, allowBackward, clearStartResync } =
        resolveSsePlayheadSync({
          uiPlayheadMs: uiPlayheadMsRef.current,
          ssePlayheadMs: sseData.playheadMs,
          awaitingStartPlaybackSSE,
        });
      // Keep interpolation base monotonic for small SSE delays.
      // If drift is very large, snap back to server to re-sync.
      lastSSERef.current = {
        wallMs: performance.now(),
        playheadMs: nextPlayheadMs,
      };
      pushPlayheadUpdate(nextPlayheadMs, {
        force: true,
        allowBackward,
      });
      if (clearStartResync) {
        awaitingStartPlaybackSSERef.current = false;
      }
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

      pushPlayheadUpdate(interpolated, { allowBackward: false });
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
    awaitingStartPlaybackSSERef.current = true;

    const config = toServerTimelineConfig(stateRef.current);
    const totalDurationMs = stateRef.current.totalDurationMs;
    const fromMs = stateRef.current.playheadMs;
    const normalizedFromMs =
      totalDurationMs > 0 && fromMs >= totalDurationMs ? 0 : fromMs;
    if (normalizedFromMs !== fromMs) {
      pushPlayheadUpdate(normalizedFromMs, { force: true });
    }
    console.log(
      `[timeline-ui] PLAY requested fromMs=${fromMs} normalizedFromMs=${normalizedFromMs} isPaused=${isPaused} tracks=${config.tracks.length} totalDuration=${config.totalDurationMs}`,
    );
    sseCountRef.current = 0;

    autoPauseBeforeEndTriggeredRef.current = false;
    await runWithClientPending(async () => {
      try {
        await startTimelinePlayback(roomId, config, normalizedFromMs);
        console.log(`[timeline-ui] PLAY server acknowledged`);
        lastSSERef.current = {
          wallMs: performance.now(),
          playheadMs: normalizedFromMs,
        };
        setIsPaused(false);
        setPlaying(true);
      } catch (err) {
        console.error('[timeline-ui] PLAY failed', err);
        awaitingStartPlaybackSSERef.current = false;
        setPlaying(false);
        lastSSERef.current = null;
        throw err;
      }
    });
  }, [roomId, setPlaying, isPaused, runWithClientPending, pushPlayheadUpdate]);

  const pause = useCallback(async () => {
    setBusyTimeoutFallbackActive(false);
    awaitingStartPlaybackSSERef.current = false;
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
          awaitingStartPlaybackSSERef.current = false;
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
      awaitingStartPlaybackSSERef.current = false;
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
