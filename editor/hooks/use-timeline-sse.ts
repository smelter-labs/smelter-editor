'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

export type TimelineSSEData = {
  playheadMs: number;
  isPlaying: boolean;
};

export function useTimelineSSE(
  roomId: string,
  enabled: boolean,
): TimelineSSEData | null {
  const [data, setData] = useState<TimelineSSEData | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const close = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      close();
      setData(null);
      return;
    }

    const url = `/api/room/${encodeURIComponent(roomId)}/timeline/sse`;
    console.log(`[timeline-sse] Connecting url=${url}`);
    const es = new EventSource(url);
    eventSourceRef.current = es;
    let msgCount = 0;

    es.onopen = () => {
      console.log(`[timeline-sse] Connection opened`);
    };

    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as TimelineSSEData;
        msgCount++;
        if (msgCount === 1) {
          console.log(
            `[timeline-sse] First message: playhead=${parsed.playheadMs} isPlaying=${parsed.isPlaying}`,
          );
        }
        setData(parsed);
      } catch {
        console.warn(`[timeline-sse] Malformed event data:`, event.data);
      }
    };

    es.onerror = (evt) => {
      console.warn(
        `[timeline-sse] Error (readyState=${es.readyState} msgCount=${msgCount})`,
        evt,
      );
    };

    return () => {
      console.log(
        `[timeline-sse] Closing (received ${msgCount} messages)`,
      );
      es.close();
      eventSourceRef.current = null;
    };
  }, [roomId, enabled, close]);

  return data;
}
