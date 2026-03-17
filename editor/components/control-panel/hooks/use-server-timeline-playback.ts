'use client';

import { useCallback, useRef, useEffect } from 'react';
import {
  startTimelinePlayback,
  stopTimelinePlayback,
  seekTimeline,
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

  const sseData = useTimelineSSE(roomId, state.isPlaying);
  const sseCountRef = useRef(0);

  // When we receive SSE updates, correct the playhead and interpolation base
  useEffect(() => {
    if (!sseData) return;
    sseCountRef.current += 1;

    if (!sseData.isPlaying && stateRef.current.isPlaying) {
      console.log(
        `[timeline-ui] SSE signaled stop (sseCount=${sseCountRef.current} playhead=${sseData.playheadMs})`,
      );
      setPlaying(false);
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
  }, [sseData, setPlayhead, setPlaying]);

  // Local interpolation loop during playback
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
      `[timeline-ui] PLAY requested fromMs=${fromMs} tracks=${config.tracks.length} totalDuration=${config.totalDurationMs}`,
    );
    sseCountRef.current = 0;

    try {
      await startTimelinePlayback(roomId, config, fromMs);
      console.log(`[timeline-ui] PLAY server acknowledged`);
      lastSSERef.current = {
        wallMs: performance.now(),
        playheadMs: fromMs,
      };
      setPlaying(true);
    } catch (err) {
      console.error('[timeline-ui] PLAY failed', err);
      setPlaying(false);
      lastSSERef.current = null;
    }
  }, [roomId, setPlaying]);

  const stop = useCallback(async () => {
    setPlaying(false);
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
    // No-op for server-side playback: state is applied on the server.
    // Kept for API compatibility with the old hook.
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return { play, stop, seek, applyAtPlayhead };
}
