'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ObCamHandFrameMessage } from '@smelter-editor/types';
import { useHandFrame } from '@/components/ob-van/phone/use-hand-frame';
import { useWhipConnectionsContext } from '../contexts/whip-connections-context';

// OB Van finger frame for the editor's own WHIP camera: when this tab
// publishes a camera that the OB Van has adopted as one of its cams, the
// fingertip quad is detected right here (same in-browser detector as the
// phone page) and shipped over the Next proxy — the Python worker's slower
// scan of that input is silenced server-side while this detector is heard.
// Headless: the operator watches the result on the program.

const POLL_MS = 3000;

export function WhipHandFrame({ roomId }: { roomId: string }) {
  const { cameraStreamRef, activeCameraInputId, isCameraActive } =
    useWhipConnectionsContext();
  const [wanted, setWanted] = useState(false);

  // While this tab publishes a camera, poll whether the OB Van wants hand
  // frames from it (FRAME on + our input adopted as a cam).
  useEffect(() => {
    if (!isCameraActive || !activeCameraInputId) {
      setWanted(false);
      return;
    }
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/room/${roomId}/ob-van/hand-frame`, {
          cache: 'no-store',
        });
        const info = (await res.json()) as {
          fingerFrame?: boolean;
          camInputIds?: string[];
        };
        if (!stopped) {
          setWanted(
            info.fingerFrame === true &&
              (info.camInputIds ?? []).includes(activeCameraInputId),
          );
        }
      } catch {
        if (!stopped) setWanted(false);
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [roomId, isCameraActive, activeCameraInputId]);

  const send = useCallback(
    (msg: Omit<ObCamHandFrameMessage, 'type'>) => {
      if (!activeCameraInputId) return;
      void fetch(`/api/room/${roomId}/ob-van/hand-frame`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inputId: activeCameraInputId, ...msg }),
      }).catch(() => {});
    },
    [roomId, activeCameraInputId],
  );

  useHandFrame(wanted, { camStreamRef: cameraStreamRef }, send);
  return null;
}
