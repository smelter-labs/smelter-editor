'use client';

import { useEffect, useState } from 'react';

const NO_MEDIA_PATH_MSG =
  'NO MEDIA PATH — the phone cannot reach the media server ' +
  'directly (different network?). Join the same Wi-Fi as ' +
  'the host and try again.';

/**
 * Publish watchdog shared by the lifter page and the commentator publishes.
 * Reads outbound-rtp off the publish pc once live: returns the send fps
 * (file-mode diagnostics) and flags a transport that never carries media —
 * signalling worked but ICE has no route (typically a different network and
 * no TURN) — through the caller's camErr setter. Clears only its own
 * message, so unrelated errors survive.
 */
export function usePublishWatchdog(
  live: boolean,
  camPcRef: React.MutableRefObject<RTCPeerConnection | null>,
  setCamErr: React.Dispatch<React.SetStateAction<string | null>>,
): number | null {
  const [sendFps, setSendFps] = useState<number | null>(null);

  useEffect(() => {
    if (!live) {
      setSendFps(null);
      return;
    }
    let lastFrames = 0;
    let zeroPolls = 0;
    let cancelled = false;
    const timer = window.setInterval(() => {
      const pc = camPcRef.current;
      if (!pc || pc.connectionState === 'closed') return;
      void pc.getStats().then((report) => {
        if (cancelled) return;
        let frames = 0;
        report.forEach((s) => {
          const stat = s as { type?: string; kind?: string } & Record<
            string,
            unknown
          >;
          if (stat.type === 'outbound-rtp' && stat.kind === 'video') {
            frames =
              typeof stat.framesEncoded === 'number' ? stat.framesEncoded : 0;
          }
        });
        setSendFps(Math.max(0, frames - lastFrames));
        lastFrames = frames;
        if (frames === 0) {
          zeroPolls += 1;
          if (zeroPolls === 5 && pc.connectionState !== 'connected') {
            setCamErr(NO_MEDIA_PATH_MSG);
          }
        } else {
          zeroPolls = 0;
          setCamErr((prev) =>
            prev?.startsWith('NO MEDIA PATH') ? null : prev,
          );
        }
      });
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [live, camPcRef, setCamErr]);

  return sendFps;
}
