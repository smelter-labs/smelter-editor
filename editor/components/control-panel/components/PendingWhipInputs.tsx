'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import LoadingSpinner from '@/components/ui/spinner';
import { Video, Monitor, X, PlugZap } from 'lucide-react';
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
        className='w-full h-auto max-h-40 object-contain'
      />
    </div>
  );
}

type PendingWhipInputsProps = {
  pendingInputs: PendingWhipInput[];
  setPendingInputs: (inputs: PendingWhipInput[]) => void | Promise<void>;
  colorMap?: Record<string, string>;
};

export function PendingWhipInputs({
  pendingInputs,
  setPendingInputs,
  colorMap,
}: PendingWhipInputsProps) {
  const { addCameraInput, updateInput, updateRoom, getRoomInfo } = useActions();
  const { roomId, refreshState } = useControlPanelContext();
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
  const [acquiringId, setAcquiringId] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);

  useEffect(() => {
    previewsRef.current = previews;
  }, [previews]);

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

  if (pendingInputs.length === 0) return null;

  const handlePreview = async (
    pendingInput: PendingWhipInput,
    type: 'camera' | 'screenshare',
  ) => {
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
        next.set(pendingInput.id, { stream, type });
        return next;
      });
    } catch (e: any) {
      toast.error(`Failed to access ${type}: ${e?.message || e}`);
    } finally {
      setAcquiringId(null);
    }
  };

  const handleConnect = async (pendingInput: PendingWhipInput) => {
    const preview = previews.get(pendingInput.id);
    if (!preview) return;

    setConnectingId(pendingInput.id);
    const { stream: previewStream, type } = preview;

    const pcRef = type === 'camera' ? cameraPcRef : screensharePcRef;
    const streamRef =
      type === 'camera' ? cameraStreamRef : screenshareStreamRef;
    const setActiveInputId =
      type === 'camera' ? setActiveCameraInputId : setActiveScreenshareInputId;
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

      await setPendingInputs(
        pendingInputs.filter((p) => p.id !== pendingInput.id),
      );

      emitTimelineEvent(TIMELINE_EVENTS.CLEANUP_SPURIOUS_WHIP_TRACK, {
        inputId: response.inputId,
      });

      toast.success(
        `Connected ${type === 'camera' ? 'camera' : 'screenshare'}: ${pendingInput.title}`,
      );
    } catch (e: any) {
      console.error(`Failed to connect ${type}:`, e);
      toast.error(`Failed to connect: ${e?.message || e}`);
      stopCameraAndConnection(pcRef, streamRef);
      setActiveInputId(null);
      setIsActive(false);
    } finally {
      setConnectingId(null);
    }
  };

  const handleCancelPreview = (pendingInput: PendingWhipInput) => {
    cleanupPreview(pendingInput.id);
  };

  const handleDismiss = async (pendingInput: PendingWhipInput) => {
    cleanupPreview(pendingInput.id);
    const nextPendingInputs = pendingInputs.filter(
      (p) => p.id !== pendingInput.id,
    );
    await setPendingInputs(nextPendingInputs);
    if (nextPendingInputs.length > 0) {
      emitTimelineEvent(TIMELINE_EVENTS.APPLY_AT_PLAYHEAD, {});
    }
  };

  return (
    <div className='flex flex-col gap-2'>
      {pendingInputs.map((pendingInput) => {
        const placeholderId = `__pending-whip-${pendingInput.position}__`;
        const accentColor = colorMap?.[placeholderId];
        const preview = previews.get(pendingInput.id);
        const isAcquiring = acquiringId === pendingInput.id;
        const isConnecting = connectingId === pendingInput.id;

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
                onClick={() => void handleDismiss(pendingInput)}
                className='h-6 w-6 text-neutral-500 hover:text-white cursor-pointer'>
                <X className='w-4 h-4' />
              </Button>
            </div>
            <div className='text-xs text-neutral-500 mb-3'>
              WHIP input - {preview ? 'preview active' : 'click to connect'}
            </div>

            {preview && (
              <>
                <InlineVideoPreview stream={preview.stream} />
                <div className='flex gap-2'>
                  <Button
                    size='sm'
                    variant='outline'
                    className='flex-1 cursor-pointer'
                    disabled={isConnecting}
                    onClick={() => handleCancelPreview(pendingInput)}>
                    Cancel
                  </Button>
                  <Button
                    size='sm'
                    variant='default'
                    className='flex-1 cursor-pointer'
                    disabled={isConnecting}
                    onClick={() => handleConnect(pendingInput)}>
                    {isConnecting ? (
                      <LoadingSpinner size='sm' variant='spinner' />
                    ) : (
                      <>
                        <PlugZap className='w-4 h-4 mr-1' />
                        Connect
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}

            {!preview && (
              <div className='flex gap-2'>
                <Button
                  size='sm'
                  variant='outline'
                  className='flex-1 cursor-pointer'
                  disabled={isAcquiring || isConnecting}
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
                  className='flex-1 cursor-pointer'
                  disabled={isAcquiring || isConnecting}
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
