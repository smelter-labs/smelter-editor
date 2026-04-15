'use client';

import { useEffect, useRef, useCallback, useState } from 'react';

type TimelineSSEData = {
  playheadMs: number;
  isPlaying: boolean;
  isPaused: boolean;
  busy?: boolean;
  operationId?: string | null;
  operation?: 'play' | 'stop' | 'seek' | 'apply' | null;
  stage?: 'idle' | 'running' | 'failed';
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
    console.log(
      `[${new Date().toISOString()}] [sync][web-recv] timeline SSE connect`,
      { roomId, url },
    );
    const es = new EventSource(url);
    eventSourceRef.current = es;
    let msgCount = 0;

    es.onopen = () => {
      console.log(
        `[${new Date().toISOString()}] [sync][web-recv] timeline SSE open`,
        { roomId, url },
      );
    };

    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as TimelineSSEData;
        msgCount++;
        if (msgCount === 1) {
          console.log(
            `[${new Date().toISOString()}] [sync][web-recv] timeline SSE first message`,
            parsed,
          );
        }
        setData(parsed);
      } catch {
        console.warn(
          `[${new Date().toISOString()}] [sync][web-recv] timeline SSE malformed event data`,
          event.data,
        );
      }
    };

    es.onerror = (evt) => {
      console.warn(
        `[${new Date().toISOString()}] [sync][web-recv] timeline SSE error (readyState=${es.readyState} msgCount=${msgCount})`,
        evt,
      );
    };

    return () => {
      console.log(
        `[${new Date().toISOString()}] [sync][web-recv] timeline SSE close`,
        { roomId, received: msgCount },
      );
      es.close();
      eventSourceRef.current = null;
    };
  }, [roomId, enabled, close]);

  return data;
}
