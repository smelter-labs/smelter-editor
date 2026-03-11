'use client';

import { useEffect } from 'react';

// Mirrors server/src/server/roomEventBus.ts - sync manually.
type InputUpdatedEvent = {
  type: 'input_updated';
  roomId: string;
  inputId: string;
  input: unknown;
  // nullable x-source-id from the request that triggered this event
  sourceId: string | null;
};

type RoomEvent = InputUpdatedEvent;

const WS_BASE = process.env.NEXT_PUBLIC_SMELTER_WS_URL ?? 'ws://localhost:3001';

export function useRoomWebSocket(roomId: string): void {
  useEffect(() => {
    const url = `${WS_BASE}/room/${encodeURIComponent(roomId)}/ws`;
    const ws = new WebSocket(url);

    // just log for now
    ws.addEventListener('open', () => {
      console.log('[room-ws] connected', { roomId, url });
    });

    // just log for now
    ws.addEventListener('message', (ev) => {
      let event: RoomEvent;
      try {
        event = JSON.parse(ev.data as string) as RoomEvent;
      } catch {
        console.warn('[room-ws] unparseable message', ev.data);
        return;
      }
      console.log('[room-ws] event', event);
    });

    ws.addEventListener('error', () => {
      console.error('[room-ws] connection error', { roomId, url });
    });

    ws.addEventListener('close', (ev) => {
      console.log('[room-ws] disconnected', {
        roomId,
        code: ev.code,
        reason: ev.reason,
      });
    });

    return () => {
      ws.close();
    };
  }, [roomId]);
}
