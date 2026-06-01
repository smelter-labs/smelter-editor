'use client';

import { useEffect, useRef } from 'react';
import {
  getEffectiveClientServerUrl,
  toWsUrl,
} from '@/lib/server-url';

export type ShaderPushSocket = {
  send: (inputId: string, params: Record<string, number>) => boolean;
};

// Opens a dedicated low-latency WebSocket for pushing pong shader-param
// updates without going through the slider HTTP path (with its 200ms debounce).
// Auto-reconnects with exponential backoff. Sends are best-effort: they
// silently drop while the socket is connecting/disconnected.
export function useShaderPushSocket(roomId: string): ShaderPushSocket {
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let destroyed = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (destroyed) return;
      const url = `${toWsUrl(getEffectiveClientServerUrl())}/room/${encodeURIComponent(roomId)}/ws`;
      const ws = new WebSocket(url);
      socketRef.current = ws;

      ws.addEventListener('open', () => {
        attempt = 0;
      });
      ws.addEventListener('close', () => {
        if (socketRef.current === ws) socketRef.current = null;
        if (destroyed) return;
        attempt += 1;
        const delay = Math.min(15000, 250 * 2 ** Math.min(attempt, 6));
        reconnectTimer = setTimeout(connect, delay);
      });
      // Don't log errors — `close` fires after them, and reconnect kicks in there.
      ws.addEventListener('error', () => {});
    };

    connect();

    return () => {
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [roomId]);

  // Stable returned object — the consumer holds a reference and calls
  // `.send()` from a RAF loop; the underlying socket may swap on reconnect.
  const apiRef = useRef<ShaderPushSocket>({
    send: (inputId, params) => {
      const ws = socketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      try {
        ws.send(
          JSON.stringify({
            type: 'pong_shader_partial_update',
            inputId,
            shaderId: 'pong',
            params,
          }),
        );
        return true;
      } catch {
        return false;
      }
    },
  });
  return apiRef.current;
}
