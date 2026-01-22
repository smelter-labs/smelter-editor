import { useEffect, useMemo, useRef } from 'react';
import { addCameraInput, removeInput, type Input } from '@/app/actions/actions';
import {
  loadLastWhipInputId,
  saveLastWhipInputId,
  saveWhipSession,
  tryAcquireAutoResumeLock,
  clearWhipSessionFor,
} from '../utils/whip-storage';
import type { AddInputResponse } from '../utils/types';
import { startPublish } from '../utils/whip-publisher';
import { stopCameraAndConnection } from '../utils/preview';

export function useAutoResume(
  roomId: string,
  userName: string,
  pcRef: React.MutableRefObject<RTCPeerConnection | null>,
  streamRef: React.MutableRefObject<MediaStream | null>,
  inputs: Input[],
  refreshState?: () => Promise<void>,
  setActiveWhipInputId?: (id: string | null) => void,
  setIsWhipActive?: (active: boolean) => void,
) {
  const isPageReload = useMemo(() => {
    try {
      const nav = performance.getEntriesByType('navigation')[0] as
        | PerformanceNavigationTiming
        | undefined;
      return nav?.type === 'reload';
    } catch {
      return false;
    }
  }, []);

  const startedRef = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        if (startedRef.current) return;
        if (!isPageReload) return;
        const acquired = tryAcquireAutoResumeLock(roomId);
        if (!acquired) return;

        startedRef.current = true;
        if (pcRef.current) return;

        const lastInputId = loadLastWhipInputId(roomId);
        if (!lastInputId) return;

        const trimmedUserName = userName.trim();

        try {
          await removeInput(roomId, lastInputId);
        } catch {}
        try {
          clearWhipSessionFor(roomId, lastInputId);
        } catch {}

        const nameArg = trimmedUserName || undefined;
        const resp: AddInputResponse = await addCameraInput(roomId, nameArg);

        if (setActiveWhipInputId) setActiveWhipInputId(resp.inputId);
        if (setIsWhipActive) setIsWhipActive(false);

        // Ensure UI reflects the newly added input as soon as possible
        if (refreshState) {
          try {
            await refreshState();
          } catch {}
        }

        const onDisconnected = () => {
          stopCameraAndConnection(pcRef, streamRef);
          if (setIsWhipActive) setIsWhipActive(false);
        };

        const { location } = await startPublish(
          resp.inputId,
          resp.bearerToken,
          resp.whipUrl,
          pcRef,
          streamRef,
          onDisconnected,
        );

        if (setIsWhipActive) setIsWhipActive(true);

        saveWhipSession({
          roomId,
          inputId: resp.inputId,
          bearerToken: resp.bearerToken,
          location,
          ts: Date.now(),
        });
        saveLastWhipInputId(roomId, resp.inputId);

        // Final refresh in case server-side state changed during publish
        if (refreshState) {
          try {
            await refreshState();
          } catch {}
        }
      } catch (e) {
        if (setActiveWhipInputId) setActiveWhipInputId(null);
        if (setIsWhipActive) setIsWhipActive(false);
      }
    })();
  }, [
    roomId,
    userName,
    isPageReload,
    pcRef,
    streamRef,
    inputs,
    refreshState,
    setActiveWhipInputId,
    setIsWhipActive,
  ]);
}
