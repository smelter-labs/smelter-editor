import { useEffect, useRef } from 'react';
import { acknowledgeWhipInput } from '@/app/actions/actions';

const HEARTBEAT_INTERVAL_MS = 5000;

export function useWhipHeartbeat(
  roomId: string,
  inputId: string | null,
  isActive: boolean,
) {
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

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
    const sendAck = () => {
      acknowledgeWhipInput(roomId, inputId).catch((err) => {
        console.warn('[WHIP Heartbeat] Failed to send ack:', err, {
          roomId,
          inputId,
          isActive,
        });
      });
    };

    // Do not wait for first interval tick; send an ack immediately.
    sendAck();
    intervalRef.current = setInterval(sendAck, HEARTBEAT_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [roomId, inputId, isActive]);
}
