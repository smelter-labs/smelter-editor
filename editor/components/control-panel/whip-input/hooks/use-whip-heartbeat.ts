import { useCallback, useEffect, useRef } from 'react';

const HEARTBEAT_INTERVAL_MS = 5000;

export function useWhipHeartbeat(
  roomId: string,
  inputId: string | null,
  isActive: boolean,
) {
  const workerRef = useRef<Worker | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const inputIdRef = useRef(inputId);
  inputIdRef.current = inputId;

  const sendAck = useCallback(() => {
    const id = inputIdRef.current;
    if (!id) return;
    void fetch('/api/whip-ack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, inputId: id }),
      keepalive: true,
    }).catch((err) => {
      console.warn('[WHIP Heartbeat] Fallback ACK failed:', err);
    });
  }, [roomId]);

  useEffect(() => {
    if (!inputId) return;

    // --- Web Worker heartbeat (survives background/screen-off on mobile) ---
    let worker: Worker | null = null;
    try {
      worker = new Worker('/whip-heartbeat-worker.js');
      workerRef.current = worker;
      worker.postMessage({
        type: 'start',
        url: `/api/whip-ack-worker?roomId=${encodeURIComponent(roomId)}&inputId=${encodeURIComponent(inputId)}`,
        intervalMs: HEARTBEAT_INTERVAL_MS,
      });
      worker.onmessage = (e) => {
        if (e.data?.type === 'ack-result' && !e.data.ok) {
          console.warn('[WHIP Heartbeat Worker] ACK failed:', e.data);
        }
      };
    } catch {
      console.warn('[WHIP Heartbeat] Worker not available, using fallback');
    }

    // --- Fallback: main-thread interval (for browsers that block workers too) ---
    sendAck();
    const fallbackInterval = setInterval(sendAck, HEARTBEAT_INTERVAL_MS);

    // --- Wake Lock: prevents screen/CPU sleep on mobile ---
    let wakeLock: WakeLockSentinel | null = null;
    const acquireWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await navigator.wakeLock.request('screen');
          wakeLockRef.current = wakeLock;
          wakeLock.addEventListener('release', () => {
            wakeLockRef.current = null;
          });
        }
      } catch {
        // Wake Lock not supported or denied — not critical
      }
    };
    void acquireWakeLock();

    // --- visibilitychange: re-acquire wake lock + immediate ACK ---
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        sendAck();
        void acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(fallbackInterval);
      if (worker) {
        worker.postMessage({ type: 'stop' });
        worker.terminate();
        workerRef.current = null;
      }
      if (wakeLockRef.current) {
        void wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [roomId, inputId, isActive, sendAck]);
}
