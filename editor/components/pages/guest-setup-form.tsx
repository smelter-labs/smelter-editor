'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Monitor, Play, RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  acquireUserMediaForSettings,
  detectDefaultOrientation,
  detectStreamOrientation,
  listVideoInputDevices,
  RESOLUTION_PRESETS,
  type GuestCameraSettings,
  type ResolutionPreset,
} from '@/components/control-panel/whip-input/utils/camera-setup';

interface GuestSetupFormProps {
  initialSettings: GuestCameraSettings;
  onStart: (settings: GuestCameraSettings) => void;
  onCancel?: () => void;
  onUseScreenshare?: () => void;
}

const RESOLUTIONS: ResolutionPreset[] = ['480p', '720p', '1080p'];

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => {
    try {
      t.stop();
    } catch {}
  });
}

export default function GuestSetupForm({
  initialSettings,
  onStart,
  onCancel,
  onUseScreenshare,
}: GuestSetupFormProps) {
  const [settings, setSettings] =
    useState<GuestCameraSettings>(initialSettings);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isAcquiring, setIsAcquiring] = useState(false);
  const [streamOrientation, setStreamOrientation] = useState<
    GuestCameraSettings['orientation'] | null
  >(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setIsAcquiring(true);
    setStreamOrientation(null);

    (async () => {
      try {
        const stream = await acquireUserMediaForSettings(settings);
        if (cancelled) {
          stopStream(stream);
          return;
        }
        stopStream(streamRef.current);
        streamRef.current = stream;
        setStreamOrientation(detectStreamOrientation(stream));
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }

        const list = await listVideoInputDevices();
        if (!cancelled) setDevices(list);
      } catch (err: any) {
        if (cancelled) return;
        const denied =
          err?.name === 'NotAllowedError' ||
          err?.name === 'SecurityError' ||
          /permission|denied/i.test(err?.message || '');
        setError(
          denied
            ? 'Camera permission denied. Grant access in browser settings and try again.'
            : `Failed to access camera: ${err?.message || err}`,
        );
      } finally {
        if (!cancelled) setIsAcquiring(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [settings]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncOrientation = () => {
      const orientation = detectDefaultOrientation();
      setSettings((s) =>
        s.orientation === orientation ? s : { ...s, orientation },
      );
    };

    window.screen?.orientation?.addEventListener?.('change', syncOrientation);
    window.addEventListener('orientationchange', syncOrientation);

    return () => {
      window.screen?.orientation?.removeEventListener?.(
        'change',
        syncOrientation,
      );
      window.removeEventListener('orientationchange', syncOrientation);
    };
  }, []);

  useEffect(() => {
    return () => {
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  const handleStart = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    onStart(settings);
  }, [onStart, settings]);

  const swapOrientation = useCallback(() => {
    setSettings((s) => ({
      ...s,
      orientation: s.orientation === 'portrait' ? 'landscape' : 'portrait',
    }));
  }, []);

  const toggleFacing = useCallback(() => {
    setSettings((s) => ({
      ...s,
      deviceId: undefined,
      facingMode: s.facingMode === 'user' ? 'environment' : 'user',
    }));
  }, []);

  const labeledDevices = devices.filter((d) => d.label);
  const hasMultipleLabeledDevices = labeledDevices.length > 1;
  const portrait = settings.orientation === 'portrait';
  const previewPortrait =
    (streamOrientation ?? settings.orientation) === 'portrait';
  const previewAspect = previewPortrait ? '9/16' : '16/9';

  return (
    <div className='flex w-full max-w-xl flex-col gap-4'>
      <div
        className='mx-auto overflow-hidden rounded-md border border-neutral-800 bg-black'
        style={{
          aspectRatio: previewAspect,
          maxHeight: previewPortrait ? '50vh' : undefined,
          width: previewPortrait ? 'auto' : '100%',
        }}>
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          className='h-full w-full object-contain'
          style={{
            transform: settings.mirror ? 'scaleX(-1)' : undefined,
          }}
        />
      </div>

      {error && (
        <div className='rounded border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-300'>
          {error}
        </div>
      )}

      <div className='flex flex-col gap-3 rounded-md border border-neutral-800 bg-neutral-950/60 p-3'>
        {hasMultipleLabeledDevices ? (
          <div className='flex flex-col gap-1'>
            <Label className='text-xs text-neutral-400'>Camera</Label>
            <Select
              value={settings.deviceId ?? '__default__'}
              onValueChange={(value) =>
                setSettings((s) => ({
                  ...s,
                  deviceId: value === '__default__' ? undefined : value,
                }))
              }>
              <SelectTrigger>
                <SelectValue placeholder='Default camera' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='__default__'>
                  Default ({settings.facingMode === 'user' ? 'front' : 'back'})
                </SelectItem>
                {labeledDevices.map((d) => (
                  <SelectItem key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className='flex items-center justify-between'>
            <Label className='text-xs text-neutral-400'>Camera</Label>
            <Button
              size='sm'
              variant='outline'
              onClick={toggleFacing}
              className='cursor-pointer'>
              <Camera className='mr-1 h-4 w-4' />
              {settings.facingMode === 'user' ? 'Front' : 'Back'}
            </Button>
          </div>
        )}

        <div className='flex flex-col gap-1'>
          <Label className='text-xs text-neutral-400'>Resolution</Label>
          <div className='grid grid-cols-3 gap-1'>
            {RESOLUTIONS.map((res) => {
              const isActive = settings.resolution === res;
              const { width, height } = RESOLUTION_PRESETS[res];
              return (
                <Button
                  key={res}
                  size='sm'
                  variant={isActive ? 'default' : 'outline'}
                  onClick={() =>
                    setSettings((s) => ({ ...s, resolution: res }))
                  }
                  className='cursor-pointer flex-col h-auto py-1'>
                  <span className='text-xs font-semibold'>{res}</span>
                  <span className='text-[10px] text-neutral-400'>
                    {width}×{height}
                  </span>
                </Button>
              );
            })}
          </div>
        </div>

        <div className='flex items-center justify-between'>
          <Label className='text-xs text-neutral-400'>Orientation</Label>
          <Button
            size='sm'
            variant='outline'
            onClick={swapOrientation}
            className='cursor-pointer'>
            <RotateCw className='mr-1 h-4 w-4' />
            {portrait ? 'Portrait' : 'Landscape'}
          </Button>
        </div>

        <div className='flex items-center justify-between'>
          <Label htmlFor='mirror-toggle' className='text-xs text-neutral-400'>
            Mirror preview
          </Label>
          <Switch
            id='mirror-toggle'
            checked={settings.mirror}
            onCheckedChange={(checked) =>
              setSettings((s) => ({ ...s, mirror: checked }))
            }
          />
        </div>
      </div>

      <div className='flex flex-wrap justify-center gap-2'>
        {onCancel && (
          <Button
            size='sm'
            variant='outline'
            onClick={onCancel}
            className='cursor-pointer'>
            Cancel
          </Button>
        )}
        {onUseScreenshare && (
          <Button
            size='sm'
            variant='outline'
            onClick={() => {
              stopStream(streamRef.current);
              streamRef.current = null;
              if (videoRef.current) videoRef.current.srcObject = null;
              onUseScreenshare();
            }}
            className='cursor-pointer'>
            <Monitor className='mr-1 h-4 w-4' />
            Share screen instead
          </Button>
        )}
        <Button
          size='sm'
          variant='default'
          onClick={handleStart}
          disabled={isAcquiring || !!error}
          className='cursor-pointer'>
          <Play className='mr-1 h-4 w-4' />
          Start streaming
        </Button>
      </div>
    </div>
  );
}
