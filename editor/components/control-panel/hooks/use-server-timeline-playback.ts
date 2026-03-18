'use client';

import { useCallback, useRef, useEffect, useState } from 'react';
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

  const [isPaused, setIsPaused] = useState(false);

  const sseData = useTimelineSSE(roomId, state.isPlaying || isPaused);
  const sseCountRef = useRef(0);

  useEffect(() => {
    if (!sseData) return;
    sseCountRef.current += 1;

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
      setPlayhead(Math.round(sseData.playheadMs));
    }
  }, [sseData, setPlayhead, setPlaying, isPaused]);

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
        setPlayhead(totalDuration);
        return;
      }

      setPlayhead(Math.round(interpolated));
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [state.isPlaying, setPlayhead]);

  const play = useCallback(async () => {
    if (stateRef.current.isPlaying) return;

    const config = toServerTimelineConfig(stateRef.current);
    const fromMs = stateRef.current.playheadMs;
    console.log(
      `[timeline-ui] PLAY requested fromMs=${fromMs} isPaused=${isPaused} tracks=${config.tracks.length} totalDuration=${config.totalDurationMs}`,
    );
    sseCountRef.current = 0;

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
      setPlayhead(Math.round(result.playheadMs));
    } catch (err) {
      console.error('[timeline-ui] PAUSE failed', err);
      setIsPaused(false);
    }
  }, [roomId, setPlaying, setPlayhead]);

  const stop = useCallback(async () => {
    setPlaying(false);
    setIsPaused(false);
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    lastSSERef.current = null;

    try {
      await stopTimelinePlayback(roomId);
    } catch (err) {
      console.error('[timeline] Failed to stop playback', err);
    }
  }, [roomId, setPlaying]);

  const seek = useCallback(
    async (ms: number) => {
      console.log(`[timeline-ui] SEEK to ${ms}ms`);
      setPlayhead(ms);
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
    [roomId, setPlayhead],
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

  const hasAutoApplied = useRef(false);
  useEffect(() => {
    if (hasAutoApplied.current) return;
    const hasClips = stateRef.current.tracks.some(
      (t) => t.clips.length > 0,
    );
    if (!hasClips) return;
    hasAutoApplied.current = true;
    void applyAtPlayhead();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return { play, pause, stop, seek, applyAtPlayhead, isPaused };
}
