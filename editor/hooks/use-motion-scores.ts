'use client';

import { useEffect, useRef, useState } from 'react';

const MOTION_UPDATE_INTERVAL_MS = 100;

function areScoresEqual(
  current: Record<string, number>,
  next: Record<string, number>,
): boolean {
  const currentEntries = Object.entries(current);
  const nextEntries = Object.entries(next);
  if (currentEntries.length !== nextEntries.length) return false;
  for (const [key, value] of currentEntries) {
    if (next[key] !== value) return false;
  }
  return true;
}

/**
 * Subscribes to the SSE motion-scores stream for a room
 * and returns a live map of inputId → score.
 */
export function useMotionScores(roomId: string): Record<string, number> {
  const [scores, setScores] = useState<Record<string, number>>({});
  const eventSourceRef = useRef<EventSource | null>(null);
  const pendingScoresRef = useRef<Record<string, number> | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const flushPendingScores = () => {
      const nextScores = pendingScoresRef.current;
      pendingScoresRef.current = null;
      flushTimerRef.current = null;
      if (!nextScores) return;
      setScores((prev) => (areScoresEqual(prev, nextScores) ? prev : nextScores));
    };

    const url = `/api/room/${encodeURIComponent(roomId)}/motion-scores/sse`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as Record<string, number>;
        pendingScoresRef.current = data;
        if (flushTimerRef.current) return;
        flushTimerRef.current = setTimeout(
          flushPendingScores,
          MOTION_UPDATE_INTERVAL_MS,
        );
      } catch {
        // ignore malformed events
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects on error
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingScoresRef.current = null;
    };
  }, [roomId]);

  return scores;
}
