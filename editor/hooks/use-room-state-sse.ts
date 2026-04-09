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
  const lastSerializedStateRef = useRef<string | null>(null);

  const applyRoomStateIfChanged = useCallback(
    (nextState: RoomState, serializedHint?: string) => {
      const serialized = serializedHint ?? JSON.stringify(nextState);
      if (serialized === lastSerializedStateRef.current) {
        setLoading(false);
        return;
      }
      lastSerializedStateRef.current = serialized;
      setRoomState(nextState);
      setLoading(false);
    },
    [],
  );

  const pollState = useCallback(async () => {
    if (!roomId) return null;
    const state = await getRoomInfo(roomId);
    if (state === 'not-found') {
      setNotFound(true);
      setLoading(false);
      return 'not-found' as const;
    }
    setNotFound(false);
    applyRoomStateIfChanged(state);
    return state;
  }, [applyRoomStateIfChanged, roomId]);

  useEffect(() => {
    if (!roomId) return;

    let cancelled = false;
    lastSerializedStateRef.current = null;

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
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        if (cancelled) return;
        setIsConnected(true);
        stopFallbackPoll();
      };

      es.onmessage = (event) => {
        if (cancelled) return;
        if (event.data === lastSerializedStateRef.current) {
          setLoading(false);
          return;
        }
        try {
          const data = JSON.parse(event.data) as RoomState;
          applyRoomStateIfChanged(data, event.data);
        } catch {
          // ignore malformed events
        }
      };

      es.onerror = () => {
        if (cancelled) return;
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
  }, [applyRoomStateIfChanged, roomId, pollState]);

  return { roomState, loading, notFound, isConnected, refreshState: pollState };
}
