import { useCallback, useRef, useState } from 'react';
import { startRecording, stopRecording } from '@/app/actions/actions';

const DOWNLOAD_DELAY_MS = 1500;

export function triggerRecordingDownload(fileName: string): void {
  if (typeof window === 'undefined') return;
  const link = document.createElement('a');
  link.href = `/api/recordings/${encodeURIComponent(fileName)}`;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export type RecordingControls = {
  /** True while an API call is in flight */
  isTogglingRecording: boolean;
  /** True while waiting for the delayed download after stop */
  isWaitingForDownload: boolean;
  /** Optimistic recording state: reflects intent immediately, reconciled on refresh */
  effectiveIsRecording: boolean;
  start: () => Promise<boolean>;
  stopAndDownload: () => Promise<void>;
  toggle: () => Promise<void>;
};

export function useRecordingControls(
  roomId: string,
  serverIsRecording: boolean,
  refreshState: () => Promise<void>,
): RecordingControls {
  const [isTogglingRecording, setIsTogglingRecording] = useState(false);
  const [isWaitingForDownload, setIsWaitingForDownload] = useState(false);
  const [optimisticRecording, setOptimisticRecording] = useState<
    boolean | null
  >(null);
  const downloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const effectiveIsRecording = optimisticRecording ?? serverIsRecording;

  const start = useCallback(async (): Promise<boolean> => {
    setIsTogglingRecording(true);
    setOptimisticRecording(true);
    try {
      const res = await startRecording(roomId);
      if (res.status === 'recording') {
        await refreshState();
        setOptimisticRecording(null);
        return true;
      }
      console.error('Failed to start recording', res.message);
      setOptimisticRecording(null);
      return false;
    } catch (err) {
      console.error('Failed to start recording', err);
      setOptimisticRecording(null);
      return false;
    } finally {
      setIsTogglingRecording(false);
    }
  }, [roomId, refreshState]);

  const stopAndDownload = useCallback(async () => {
    setIsTogglingRecording(true);
    setIsWaitingForDownload(true);
    setOptimisticRecording(false);
    try {
      const res = await stopRecording(roomId);
      await refreshState();
      setOptimisticRecording(null);
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
      setOptimisticRecording(null);
      setIsWaitingForDownload(false);
    } finally {
      setIsTogglingRecording(false);
    }
  }, [roomId, refreshState]);

  const toggle = useCallback(async () => {
    if (isTogglingRecording || isWaitingForDownload) return;
    if (effectiveIsRecording) {
      await stopAndDownload();
    } else {
      await start();
    }
  }, [
    effectiveIsRecording,
    isTogglingRecording,
    isWaitingForDownload,
    start,
    stopAndDownload,
  ]);

  return {
    isTogglingRecording,
    isWaitingForDownload,
    effectiveIsRecording,
    start,
    stopAndDownload,
    toggle,
  };
}
