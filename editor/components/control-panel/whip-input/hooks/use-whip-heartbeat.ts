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

    intervalRef.current = setInterval(() => {
      if (isActive) {
        acknowledgeWhipInput(roomId, inputId).catch((err) => {
          console.warn('[WHIP Heartbeat] Failed to send ack:', err);
        });
      }
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [roomId, inputId, isActive]);
}
