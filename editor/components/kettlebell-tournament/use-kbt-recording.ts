'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { startRecording, stopRecording } from '@/app/actions/actions';
import {
  DOWNLOAD_DELAY_MS,
  triggerRecordingDownload,
} from '@/components/control-panel/hooks/use-recording-controls';

/**
 * If the pushed kbt_state never confirms our toggle (lost broadcast, feed
 * down), fall back to the server-reported value after this long.
 */
const OPTIMISTIC_TIMEOUT_MS = 4000;

export type KbtRecording = {
  /** Optimistic recording state: reflects intent immediately, reconciled by kbt_state. */
  effectiveIsRecording: boolean;
  /** True while an API call is in flight. */
  isToggling: boolean;
  /** True while waiting for the delayed download after stop. */
  isWaitingForDownload: boolean;
  toggle: () => Promise<void>;
  stopAndDownload: () => Promise<void>;
};

/**
 * Context-free sibling of `useRecordingControls` for the KBT surfaces (which
 * mount no ActionsProvider): calls the recording server actions directly and
 * reconciles against the `isRecording` flag pushed via `kbt_state` instead of
 * pulling a room-state refresh.
 */
export function useKbtRecording(
  roomId: string | null,
  serverIsRecording: boolean,
): KbtRecording {
  const [isToggling, setIsToggling] = useState(false);
  const [isWaitingForDownload, setIsWaitingForDownload] = useState(false);
  const [optimisticRecording, setOptimisticRecording] = useState<
    boolean | null
  >(null);
  const downloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optimisticTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const effectiveIsRecording = optimisticRecording ?? serverIsRecording;

  useEffect(() => {
    return () => {
      if (downloadTimerRef.current) clearTimeout(downloadTimerRef.current);
      if (optimisticTimerRef.current) clearTimeout(optimisticTimerRef.current);
    };
  }, []);

  const clearOptimistic = useCallback(() => {
    if (optimisticTimerRef.current) {
      clearTimeout(optimisticTimerRef.current);
      optimisticTimerRef.current = null;
    }
    setOptimisticRecording(null);
  }, []);

  // The pushed state caught up with our intent — server truth takes over.
  useEffect(() => {
    if (
      optimisticRecording !== null &&
      serverIsRecording === optimisticRecording
    ) {
      clearOptimistic();
    }
  }, [serverIsRecording, optimisticRecording, clearOptimistic]);

  const holdOptimistic = useCallback((value: boolean) => {
    if (optimisticTimerRef.current) clearTimeout(optimisticTimerRef.current);
    setOptimisticRecording(value);
    optimisticTimerRef.current = setTimeout(() => {
      optimisticTimerRef.current = null;
      setOptimisticRecording(null);
    }, OPTIMISTIC_TIMEOUT_MS);
  }, []);

  const start = useCallback(async () => {
    if (!roomId) return;
    setIsToggling(true);
    holdOptimistic(true);
    try {
      const res = await startRecording(roomId);
      if (res.status !== 'recording') {
        // e.g. the other surface won the race ("Recording is already in progress")
        console.error('Failed to start recording', res.message);
        clearOptimistic();
      }
    } catch (err) {
      console.error('Failed to start recording', err);
      clearOptimistic();
    } finally {
      setIsToggling(false);
    }
  }, [roomId, holdOptimistic, clearOptimistic]);

  const stopAndDownload = useCallback(async () => {
    if (!roomId) return;
    setIsToggling(true);
    setIsWaitingForDownload(true);
    holdOptimistic(false);
    try {
      const res = await stopRecording(roomId);
      if (res.status === 'stopped' && res.fileName) {
        const fileName = res.fileName;
        downloadTimerRef.current = setTimeout(() => {
          downloadTimerRef.current = null;
          triggerRecordingDownload(fileName);
          setIsWaitingForDownload(false);
        }, DOWNLOAD_DELAY_MS);
      } else {
        if (res.status !== 'stopped') {
          console.error('Failed to stop recording', res.message);
        }
        setIsWaitingForDownload(false);
      }
    } catch (err) {
      console.error('Failed to stop recording', err);
      clearOptimistic();
      setIsWaitingForDownload(false);
    } finally {
      setIsToggling(false);
    }
  }, [roomId, holdOptimistic, clearOptimistic]);

  const toggle = useCallback(async () => {
    if (!roomId || isToggling || isWaitingForDownload) return;
    if (effectiveIsRecording) {
      await stopAndDownload();
    } else {
      await start();
    }
  }, [
    roomId,
    effectiveIsRecording,
    isToggling,
    isWaitingForDownload,
    start,
    stopAndDownload,
  ]);

  return {
    effectiveIsRecording,
    isToggling,
    isWaitingForDownload,
    toggle,
    stopAndDownload,
  };
}
