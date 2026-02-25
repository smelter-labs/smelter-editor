import { useCallback, useEffect, useRef } from 'react';

const HEARTBEAT_INTERVAL_MS = 5000;

export function useWhipHeartbeat(
  roomId: string,
  inputId: string | null,
  isActive: boolean,
) {
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const inputIdRef = useRef(inputId);
  inputIdRef.current = inputId;

  const sendAck = useCallback(() => {
    const id = inputIdRef.current;
    if (!id) return;
    void fetch('/api/whip-ack', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ roomId, inputId: id }),
      keepalive: true,
    })
      .then(async (res) => {
        if (!res.ok) {
          const errBody = await res.text().catch(() => '');
          throw new Error(
            `ACK failed (${res.status}): ${errBody || 'No details'}`,
          );
        }
      })
      .catch((err) => {
        console.warn('[WHIP Heartbeat] Failed to send ack:', err, {
          roomId,
          inputId: id,
          isActive,
        });
      });
  }, [roomId, isActive]);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!inputId) {
      return;
    }

    // Keep server-side WHIP input alive even when WebRTC state briefly flaps.
    // Mobile browsers can transiently report disconnected/hidden states.

    // Do not wait for first interval tick; send an ack immediately.
    sendAck();
    intervalRef.current = setInterval(sendAck, HEARTBEAT_INTERVAL_MS);

    // Mobile browsers aggressively throttle/pause setInterval when the page
    // is backgrounded or the screen is off. Send an immediate ACK when the
    // page becomes visible again so the server doesn't consider us stale.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        sendAck();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [roomId, inputId, isActive, sendAck]);
}
