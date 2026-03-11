'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Subscribes to the SSE motion-scores stream for a room
 * and returns a live map of inputId → score.
 */
export function useMotionScores(roomId: string): Record<string, number> {
  const [scores, setScores] = useState<Record<string, number>>({});
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const url = `/api/room/${encodeURIComponent(roomId)}/motion-scores/sse`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as Record<string, number>;
        setScores(data);
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
    };
  }, [roomId]);

  return scores;
}
