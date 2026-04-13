'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomState } from '@/lib/types';
import { getRoomInfo } from '@/app/actions/actions';

const FALLBACK_POLL_INTERVAL = 30_000;
const SSE_RECONNECT_DELAY = 3_000;

export function useRoomStateSse(roomId: string | undefined) {
  const [roomState, setRoomState] = useState<RoomState>({
    inputs: [],
    layers: [],
    whepUrl: '',
  });
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pollState = useCallback(async () => {
    if (!roomId) return null;
    const state = await getRoomInfo(roomId);
    if (state === 'not-found') {
      setNotFound(true);
      setLoading(false);
      return 'not-found' as const;
    }
    setNotFound(false);
    setRoomState(state);
    setLoading(false);
    return state;
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;

    let cancelled = false;

    const startFallbackPoll = () => {
      if (fallbackTimerRef.current) return;
      fallbackTimerRef.current = setInterval(() => {
        if (!cancelled) void pollState();
      }, FALLBACK_POLL_INTERVAL);
    };

    const stopFallbackPoll = () => {
      if (fallbackTimerRef.current) {
        clearInterval(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
    };

    const connect = () => {
      if (cancelled) return;

      const url = `/api/room/${encodeURIComponent(roomId)}/state/sse`;
      console.log(
        `[${new Date().toISOString()}] [sync][web-recv] connecting state SSE`,
        { roomId, url },
      );
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        if (cancelled) return;
        console.log(
          `[${new Date().toISOString()}] [sync][web-recv] state SSE open`,
          { roomId, url },
        );
        setIsConnected(true);
        stopFallbackPoll();
      };

      es.onmessage = (event) => {
        if (cancelled) return;
        try {
          const data = JSON.parse(event.data) as RoomState;
          console.log(
            `[${new Date().toISOString()}] [sync][web-recv] state SSE message`,
            {
              roomId,
              inputs: data.inputs.length,
              layers: data.layers.length,
            },
          );
          setRoomState(data);
          setLoading(false);
        } catch {
          // ignore malformed events
        }
      };

      es.onerror = () => {
        if (cancelled) return;
        console.warn(
          `[${new Date().toISOString()}] [sync][web-recv] state SSE error`,
          { roomId, url },
        );
        setIsConnected(false);
        es.close();
        eventSourceRef.current = null;

        startFallbackPoll();

        reconnectTimerRef.current = setTimeout(() => {
          if (!cancelled) connect();
        }, SSE_RECONNECT_DELAY);
      };
    };

    void pollState().then((result) => {
      if (!cancelled && result !== 'not-found') connect();
    });

    startFallbackPoll();

    return () => {
      cancelled = true;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      stopFallbackPoll();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [roomId, pollState]);

  return { roomState, loading, notFound, isConnected, refreshState: pollState };
}
