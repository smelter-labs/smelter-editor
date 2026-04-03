'use client';

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type MutableRefObject,
} from 'react';
import { Button } from '@/components/ui/button';
import LoadingSpinner from '@/components/ui/spinner';
import { Video, Monitor, X } from 'lucide-react';
import { useActions } from '../contexts/actions-context';
import { startPublish } from '../whip-input/utils/whip-publisher';
import { startScreensharePublish } from '../whip-input/utils/screenshare-publisher';
import { stopCameraAndConnection } from '../whip-input/utils/preview';
import {
  saveWhipSession,
  saveLastWhipInputId,
} from '../whip-input/utils/whip-storage';
import { toast } from 'sonner';
import { emitTimelineEvent, TIMELINE_EVENTS } from './timeline/timeline-events';
import type { PendingWhipInput } from './ConfigurationSection';
import { updateTimelineInputId } from '@/lib/room-config';
import { useControlPanelContext } from '../contexts/control-panel-context';
import { useWhipConnectionsContext } from '../contexts/whip-connections-context';
import { hexToHsla } from '@/lib/color-utils';

function colorToTint(color: string, alpha: number): string {
  if (color.startsWith('#')) return hexToHsla(color, alpha);
  const match = color.match(/hsl\((\d+)\s+(\d+)%\s+(\d+)%\)/);
  if (match) return `hsla(${match[1]}, ${match[2]}%, ${match[3]}%, ${alpha})`;
  return color;
}

function stopStream(s: MediaStream | null) {
  s?.getTracks().forEach((t) => {
    try {
      t.stop();
    } catch {}
  });
}

type PreviewState = {
  stream: MediaStream;
  type: 'camera' | 'screenshare';
};

function InlineVideoPreview({ stream }: { stream: MediaStream }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
      video.play().catch(() => {});
    }
    return () => {
      if (video) {
        video.srcObject = null;
      }
    };
  }, [stream]);

  return (
    <div className='rounded overflow-hidden bg-black border border-neutral-700 my-2'>
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        className='w-full h-auto object-contain'
      />
    </div>
  );
}

type PendingWhipInputsProps = {
  pendingInputs: PendingWhipInput[];
  setPendingInputs: (inputs: PendingWhipInput[]) => void | Promise<void>;
  colorMap?: Record<string, string>;
  connectAllRef?: MutableRefObject<(() => Promise<boolean>) | null>;
  onConnectAllReadyChange?: (ready: boolean) => void;
};

export function PendingWhipInputs({
  pendingInputs,
  setPendingInputs,
  colorMap,
  connectAllRef,
  onConnectAllReadyChange,
}: PendingWhipInputsProps) {
  const { addCameraInput, updateInput, updateRoom, getRoomInfo } = useActions();
  const { roomId } = useControlPanelContext();
  const {
    cameraPcRef,
    cameraStreamRef,
    screensharePcRef,
    screenshareStreamRef,
    setActiveCameraInputId,
    setIsCameraActive,
    setActiveScreenshareInputId,
    setIsScreenshareActive,
  } = useWhipConnectionsContext();

  const [previews, setPreviews] = useState<Map<string, PreviewState>>(
    new Map(),
  );
  const previewsRef = useRef(previews);
  const pendingInputsRef = useRef(pendingInputs);
  const [acquiringId, setAcquiringId] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [isBulkConnecting, setIsBulkConnecting] = useState(false);

  useEffect(() => {
    previewsRef.current = previews;
  }, [previews]);

  useEffect(() => {
    pendingInputsRef.current = pendingInputs;
  }, [pendingInputs]);

  const cleanupPreview = useCallback((pendingId: string) => {
    setPreviews((prev) => {
      const existing = prev.get(pendingId);
      if (existing) {
        stopStream(existing.stream);
        const next = new Map(prev);
        next.delete(pendingId);
        return next;
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    return () => {
      for (const preview of previewsRef.current.values()) {
        stopStream(preview.stream);
      }
    };
  }, []);

  const handlePreview = useCallback(
    async (pendingInput: PendingWhipInput, type: 'camera' | 'screenshare') => {
      setAcquiringId(pendingInput.id);
      try {
        let stream: MediaStream;
        if (type === 'camera') {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
        } else {
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: { displaySurface: 'monitor' } as any,
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
        }
        setPreviews((prev) => {
          const next = new Map(prev);
          const existing = next.get(pendingInput.id);
          if (existing) {
            stopStream(existing.stream);
          }
          next.set(pendingInput.id, { stream, type });
          return next;
        });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        toast.error(`Failed to access ${type}: ${message}`);
      } finally {
        setAcquiringId(null);
      }
    },
    [],
  );

  const handleConnect = useCallback(
    async (pendingInput: PendingWhipInput) => {
      const preview = previewsRef.current.get(pendingInput.id);
      if (!preview) return false;

      setConnectingId(pendingInput.id);
      const { stream: previewStream, type } = preview;

      const pcRef = type === 'camera' ? cameraPcRef : screensharePcRef;
      const streamRef =
        type === 'camera' ? cameraStreamRef : screenshareStreamRef;
      const setActiveInputId =
        type === 'camera'
          ? setActiveCameraInputId
          : setActiveScreenshareInputId;
      const setIsActive =
        type === 'camera' ? setIsCameraActive : setIsScreenshareActive;

      try {
        const response = await addCameraInput(roomId, pendingInput.title);
        setActiveInputId(response.inputId);
        setIsActive(false);

        const placeholderId = `__pending-whip-${pendingInput.position}__`;
        const timelineUpdated = updateTimelineInputId(
          roomId,
          placeholderId,
          response.inputId,
        );
        if (timelineUpdated) {
          window.dispatchEvent(
            new CustomEvent('smelter:timeline-input-replaced', {
              detail: {
                oldInputId: placeholderId,
                newInputId: response.inputId,
              },
            }),
          );
        }

        const onDisconnected = () => {
          stopCameraAndConnection(pcRef, streamRef);
          setIsActive(false);
        };

        const { location } =
          type === 'camera'
            ? await startPublish(
                response.inputId,
                response.bearerToken,
                response.whipUrl,
                pcRef,
                streamRef,
                onDisconnected,
                undefined,
                undefined,
                previewStream,
              )
            : await startScreensharePublish(
                response.inputId,
                response.bearerToken,
                response.whipUrl,
                pcRef,
                streamRef,
                onDisconnected,
                previewStream,
              );

        setIsActive(true);

        // Remove from previews map (stream now owned by publisher)
        setPreviews((prev) => {
          const next = new Map(prev);
          next.delete(pendingInput.id);
          return next;
        });

        saveWhipSession({
          roomId,
          inputId: response.inputId,
          bearerToken: response.bearerToken,
          location,
          ts: Date.now(),
        });
        saveLastWhipInputId(roomId, response.inputId);

        await updateInput(roomId, response.inputId, {
          volume: pendingInput.config.volume,
          shaders: pendingInput.config.shaders,
          showTitle: pendingInput.config.showTitle,
        });

        const roomInfo = await getRoomInfo(roomId);
        if (roomInfo !== 'not-found') {
          const currentInputIds = roomInfo.inputs.map((i) => i.inputId);
          const newInputId = response.inputId;
          const targetPosition = pendingInput.position;

          const withoutNew = currentInputIds.filter((id) => id !== newInputId);
          const reordered = [
            ...withoutNew.slice(0, targetPosition),
            newInputId,
            ...withoutNew.slice(targetPosition),
          ];

          await updateRoom(roomId, { inputOrder: reordered });
        }

        const nextPendingInputs = pendingInputsRef.current.filter(
          (p) => p.id !== pendingInput.id,
        );
        pendingInputsRef.current = nextPendingInputs;
        await setPendingInputs(nextPendingInputs);

        emitTimelineEvent(TIMELINE_EVENTS.CLEANUP_SPURIOUS_WHIP_TRACK, {
          inputId: response.inputId,
        });

        toast.success(
          `Connected ${type === 'camera' ? 'camera' : 'screenshare'}: ${pendingInput.title}`,
        );
        return true;
      } catch (e: unknown) {
        console.error(`Failed to connect ${type}:`, e);
        const message = e instanceof Error ? e.message : String(e);
        toast.error(`Failed to connect: ${message}`);
        stopCameraAndConnection(pcRef, streamRef);
        setActiveInputId(null);
        setIsActive(false);
        return false;
      } finally {
        setConnectingId(null);
      }
    },
    [
      addCameraInput,
      cameraPcRef,
      cameraStreamRef,
      getRoomInfo,
      roomId,
      screensharePcRef,
      screenshareStreamRef,
      setActiveCameraInputId,
      setActiveScreenshareInputId,
      setIsCameraActive,
      setIsScreenshareActive,
      setPendingInputs,
      updateInput,
      updateRoom,
    ],
  );

  const connectAll = useCallback(async () => {
    const currentPendingInputs = pendingInputsRef.current;
    if (currentPendingInputs.length === 0) {
      return false;
    }

    setIsBulkConnecting(true);
    try {
      for (const pendingInput of currentPendingInputs) {
        if (!previewsRef.current.has(pendingInput.id)) {
          return false;
        }
        const connected = await handleConnect(pendingInput);
        if (!connected) {
          return false;
        }
      }
      return true;
    } finally {
      setIsBulkConnecting(false);
    }
  }, [handleConnect]);

  useEffect(() => {
    if (!connectAllRef) {
      return;
    }

    const allInputsReady =
      pendingInputs.length > 0 && previews.size === pendingInputs.length;
    const isBusy =
      acquiringId !== null || connectingId !== null || isBulkConnecting;
    connectAllRef.current = allInputsReady && !isBusy ? connectAll : null;
    onConnectAllReadyChange?.(allInputsReady && !isBusy);

    return () => {
      if (connectAllRef.current === connectAll) {
        connectAllRef.current = null;
      }
      onConnectAllReadyChange?.(false);
    };
  }, [
    acquiringId,
    connectAll,
    connectAllRef,
    connectingId,
    isBulkConnecting,
    onConnectAllReadyChange,
    pendingInputs.length,
    previews.size,
  ]);

  const handleCancelPreview = (pendingInput: PendingWhipInput) => {
    cleanupPreview(pendingInput.id);
  };

  const handleDismiss = async (pendingInput: PendingWhipInput) => {
    cleanupPreview(pendingInput.id);
    const nextPendingInputs = pendingInputsRef.current.filter(
      (p) => p.id !== pendingInput.id,
    );
    pendingInputsRef.current = nextPendingInputs;
    await setPendingInputs(nextPendingInputs);
    if (nextPendingInputs.length > 0) {
      emitTimelineEvent(TIMELINE_EVENTS.APPLY_AT_PLAYHEAD, {});
    }
  };

  if (pendingInputs.length === 0) return null;

  return (
    <div className='flex flex-col gap-2'>
      {pendingInputs.map((pendingInput) => {
        const placeholderId = `__pending-whip-${pendingInput.position}__`;
        const accentColor = colorMap?.[placeholderId];
        const preview = previews.get(pendingInput.id);
        const isAcquiring = acquiringId === pendingInput.id;
        const isConnecting = connectingId === pendingInput.id;
        const isBusy =
          isBulkConnecting || acquiringId !== null || connectingId !== null;

        return (
          <div
            key={pendingInput.id}
            className='p-3 bg-neutral-900 rounded-sm'
            style={
              accentColor
                ? {
                    borderLeft: `4px solid ${accentColor}`,
                    background: colorToTint(accentColor, 0.08),
                  }
                : {
                    border: '2px dashed var(--color-neutral-700)',
                  }
            }>
            <div className='flex items-center justify-between mb-2'>
              {accentColor && (
                <span
                  className='w-2.5 h-2.5 rounded-full mr-2 shrink-0'
                  style={{ background: accentColor }}
                />
              )}
              <span className='text-sm text-white font-medium truncate flex-1'>
                {pendingInput.title}
              </span>
              <Button
                variant='ghost'
                size='icon'
                onClick={() =>
                  preview
                    ? handleCancelPreview(pendingInput)
                    : void handleDismiss(pendingInput)
                }
                className='h-6 w-6 text-neutral-500 hover:text-white cursor-pointer'>
                <X className='w-4 h-4' />
              </Button>
            </div>
            <div className='text-xs text-neutral-500 mb-3'>
              WHIP input - {preview ? 'preview active' : 'click to connect'}
            </div>

            {preview && (
              <InlineVideoPreview stream={preview.stream} />
            )}

            {!preview && (
              <div className='flex gap-2'>
                <Button
                  size='sm'
                  variant='outline'
                  className={`flex-1 cursor-pointer ${!isBusy ? 'animate-pulse-cyan' : ''}`}
                  disabled={isBusy}
                  onClick={() => handlePreview(pendingInput, 'camera')}>
                  {isAcquiring && acquiringId === pendingInput.id ? (
                    <LoadingSpinner size='sm' variant='spinner' />
                  ) : (
                    <>
                      <Video className='w-4 h-4 mr-1' />
                      Camera
                    </>
                  )}
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  className={`flex-1 cursor-pointer ${!isBusy ? 'animate-pulse-cyan' : ''}`}
                  disabled={isBusy}
                  onClick={() => handlePreview(pendingInput, 'screenshare')}>
                  {isAcquiring && acquiringId === pendingInput.id ? (
                    <LoadingSpinner size='sm' variant='spinner' />
                  ) : (
                    <>
                      <Monitor className='w-4 h-4 mr-1' />
                      Screen
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
