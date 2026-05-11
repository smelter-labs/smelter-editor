'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Camera, Monitor, PhoneOff, RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import LoadingSpinner from '@/components/ui/spinner';
import { staggerContainer } from '@/utils/animations';
import { addCameraInput, removeInput } from '@/app/actions/actions';
import {
  startPublish,
  rotateBy90,
  cleanupRotation,
  type RotationAngle,
} from '@/components/control-panel/whip-input/utils/whip-publisher';
import { startScreensharePublish } from '@/components/control-panel/whip-input/utils/screenshare-publisher';
import { stopCameraAndConnection } from '@/components/control-panel/whip-input/utils/preview';
import {
  clearWhipSession,
  clearWhipSessionFor,
  loadUserName,
  saveLastWhipInputId,
  saveUserName,
  saveWhipSession,
} from '@/components/control-panel/whip-input/utils/whip-storage';
import { useIsMobileDevice } from '@/hooks/use-mobile';

type ConnectKind = 'camera' | 'screenshare';
type Mode =
  | { kind: 'initializing' }
  | { kind: 'connecting'; source: ConnectKind }
  | { kind: 'active'; source: ConnectKind; inputId: string }
  | { kind: 'idle' }
  | { kind: 'error'; message: string };

const DEFAULT_MODE_KEY = 'smelter-guest-default-mode';

function loadDefaultMode(): ConnectKind {
  if (typeof window === 'undefined') return 'camera';
  try {
    const stored = window.localStorage.getItem(DEFAULT_MODE_KEY);
    if (stored === 'screenshare' || stored === 'camera') return stored;
  } catch {}
  return 'camera';
}

function saveDefaultMode(kind: ConnectKind) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DEFAULT_MODE_KEY, kind);
  } catch {}
}

function buildDefaultUserName(roomId: string, kind: ConnectKind): string {
  const saved = loadUserName(roomId);
  if (saved) {
    if (kind === 'screenshare') {
      return saved
        .replace(/\s+Camera$/i, ' Screenshare')
        .replace(/^User\s+/i, 'Screenshare ');
    }
    return saved;
  }
  if (typeof window !== 'undefined') {
    const storedName = window.localStorage.getItem('smelter-display-name');
    if (storedName) {
      return `${storedName} ${kind === 'camera' ? 'Camera' : 'Screenshare'}`;
    }
  }
  return `User ${Math.floor(1000 + Math.random() * 9000)}`;
}

interface GuestPanelProps {
  roomId: string;
}

export default function GuestPanel({ roomId }: GuestPanelProps) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isMobileDevice = useIsMobileDevice();

  const [mode, setMode] = useState<Mode>({ kind: 'initializing' });
  const [rotation, setRotation] = useState<RotationAngle>(0);
  const autoStartedRef = useRef(false);
  const activeInputIdRef = useRef<string | null>(null);

  const teardownConnection = useCallback(() => {
    stopCameraAndConnection(pcRef, streamRef);
    cleanupRotation();
    setRotation(0);
  }, []);

  const connect = useCallback(
    async (kind: ConnectKind) => {
      teardownConnection();

      const previousInputId = activeInputIdRef.current;
      if (previousInputId) {
        activeInputIdRef.current = null;
        clearWhipSessionFor(roomId, previousInputId);
        try {
          await removeInput(roomId, previousInputId);
        } catch {
          // Best-effort cleanup; input may already be gone.
        }
      }

      setMode({ kind: 'connecting', source: kind });

      const userName = buildDefaultUserName(roomId, kind);
      let createdInputId: string | null = null;

      try {
        const response = await addCameraInput(roomId, userName);
        createdInputId = response.inputId;

        const onDisconnected = () => {
          if (activeInputIdRef.current !== createdInputId) return;
          activeInputIdRef.current = null;
          teardownConnection();
          clearWhipSessionFor(roomId, createdInputId!);
          setMode({
            kind: 'error',
            message: 'Connection lost. Please try again.',
          });
        };

        const { location } =
          kind === 'camera'
            ? await startPublish(
                response.inputId,
                response.bearerToken,
                response.whipUrl,
                pcRef,
                streamRef,
                onDisconnected,
                isMobileDevice ? 'user' : undefined,
                false,
              )
            : await startScreensharePublish(
                response.inputId,
                response.bearerToken,
                response.whipUrl,
                pcRef,
                streamRef,
                onDisconnected,
              );

        saveWhipSession({
          roomId,
          inputId: response.inputId,
          bearerToken: response.bearerToken,
          location,
          ts: Date.now(),
        });
        saveLastWhipInputId(roomId, response.inputId);
        saveUserName(roomId, userName);
        saveDefaultMode(kind);

        activeInputIdRef.current = response.inputId;
        setRotation(0);
        setMode({ kind: 'active', source: kind, inputId: response.inputId });
      } catch (err: any) {
        console.error(`Guest ${kind} publish failed:`, err);
        teardownConnection();
        if (createdInputId) {
          try {
            await removeInput(roomId, createdInputId);
          } catch {}
          clearWhipSessionFor(roomId, createdInputId);
        }
        activeInputIdRef.current = null;
        const denied =
          err?.name === 'NotAllowedError' ||
          err?.name === 'SecurityError' ||
          /permission|denied/i.test(err?.message || '');
        const message = denied
          ? kind === 'camera'
            ? 'Camera permission was denied. You can try again or use screenshare instead.'
            : 'Screenshare was cancelled or blocked. You can try again or use your camera instead.'
          : `Failed to publish ${kind}: ${err?.message || err}`;
        setMode({ kind: 'error', message });
      }
    },
    [isMobileDevice, roomId, teardownConnection],
  );

  const disconnect = useCallback(async () => {
    const currentInputId = activeInputIdRef.current;
    activeInputIdRef.current = null;
    teardownConnection();
    if (currentInputId) {
      clearWhipSessionFor(roomId, currentInputId);
      try {
        await removeInput(roomId, currentInputId);
      } catch {}
    } else {
      clearWhipSession(roomId);
    }
    setMode({ kind: 'idle' });
  }, [roomId, teardownConnection]);

  const handleRotate = useCallback(async () => {
    try {
      const angle = await rotateBy90(pcRef, streamRef);
      setRotation(angle);
    } catch (err) {
      console.error('Guest rotate failed:', err);
      toast.error('Failed to rotate the stream.');
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (mode.kind === 'active' && streamRef.current) {
      video.srcObject = streamRef.current;
      video.play().catch(() => {});
    } else {
      video.srcObject = null;
    }
  }, [mode]);

  useEffect(() => {
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setMode({
        kind: 'error',
        message:
          'Your browser does not support camera capture. Please use a modern browser over HTTPS.',
      });
      return;
    }
    void connect(loadDefaultMode());
  }, [connect]);

  useEffect(() => {
    return () => {
      const currentInputId = activeInputIdRef.current;
      activeInputIdRef.current = null;
      stopCameraAndConnection(pcRef, streamRef);
      cleanupRotation();
      if (currentInputId) {
        clearWhipSessionFor(roomId, currentInputId);
        void removeInput(roomId, currentInputId).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isVertical = rotation % 180 !== 0;
  const activeSource = mode.kind === 'active' ? mode.source : null;

  return (
    <motion.div
      variants={staggerContainer}
      className='flex-1 flex flex-col min-h-0 h-full items-center justify-start overflow-hidden'>
      <div className='w-full max-w-xl flex flex-col gap-4 p-4'>
        {mode.kind === 'active' && (
          <div
            className='rounded-md overflow-hidden border border-neutral-800 bg-black mx-auto'
            style={{
              aspectRatio: isVertical ? '9/16' : '16/9',
              maxHeight: isVertical ? '70vh' : undefined,
              width: isVertical ? 'auto' : '100%',
            }}>
            <video
              ref={videoRef}
              muted
              playsInline
              autoPlay
              className='w-full h-full object-contain'
            />
          </div>
        )}

        {(mode.kind === 'initializing' || mode.kind === 'connecting') && (
          <div className='flex flex-col items-center justify-center gap-3 py-16'>
            <LoadingSpinner size='lg' variant='spinner' />
            <p className='text-sm text-neutral-400'>
              {mode.kind === 'connecting' && mode.source === 'screenshare'
                ? 'Waiting for screen selection...'
                : 'Requesting camera access...'}
            </p>
          </div>
        )}

        {mode.kind === 'error' && (
          <div className='flex flex-col items-center gap-3 py-10 text-center'>
            <p className='text-sm text-neutral-300'>{mode.message}</p>
            <div className='flex flex-wrap justify-center gap-2'>
              <Button
                size='sm'
                variant='default'
                onClick={() => void connect('camera')}
                className='cursor-pointer'>
                <Camera className='w-4 h-4 mr-1' />
                Try Camera
              </Button>
              <Button
                size='sm'
                variant='outline'
                onClick={() => void connect('screenshare')}
                className='cursor-pointer'>
                <Monitor className='w-4 h-4 mr-1' />
                Use Screenshare
              </Button>
            </div>
          </div>
        )}

        {mode.kind === 'idle' && (
          <div className='flex flex-col items-center gap-3 py-10 text-center'>
            <p className='text-sm text-neutral-300'>
              You are disconnected. Choose an input to join the room.
            </p>
            <div className='flex flex-wrap justify-center gap-2'>
              <Button
                size='sm'
                variant='default'
                onClick={() => void connect('camera')}
                className='cursor-pointer'>
                <Camera className='w-4 h-4 mr-1' />
                Connect Camera
              </Button>
              <Button
                size='sm'
                variant='outline'
                onClick={() => void connect('screenshare')}
                className='cursor-pointer'>
                <Monitor className='w-4 h-4 mr-1' />
                Share Screen
              </Button>
            </div>
          </div>
        )}

        {mode.kind === 'active' && (
          <div className='flex flex-wrap justify-center gap-2'>
            {activeSource === 'camera' && (
              <Button
                size='sm'
                variant='ghost'
                onClick={handleRotate}
                className='cursor-pointer text-neutral-300 hover:text-white border border-neutral-700'>
                <RotateCw className='w-4 h-4 mr-1' />
                Rotate 90°
              </Button>
            )}
            <Button
              size='sm'
              variant='outline'
              onClick={() =>
                void connect(
                  activeSource === 'camera' ? 'screenshare' : 'camera',
                )
              }
              className='cursor-pointer'>
              {activeSource === 'camera' ? (
                <>
                  <Monitor className='w-4 h-4 mr-1' />
                  Switch to Screenshare
                </>
              ) : (
                <>
                  <Camera className='w-4 h-4 mr-1' />
                  Switch to Camera
                </>
              )}
            </Button>
            <Button
              size='sm'
              variant='destructive'
              onClick={() => void disconnect()}
              className='cursor-pointer'>
              <PhoneOff className='w-4 h-4 mr-1' />
              Disconnect
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
