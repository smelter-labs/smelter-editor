'use client';

import { useCallback, useRef, useState } from 'react';
import { usePreviewSet } from '@/components/kettlebell-tournament/phone/use-preview';
import { useMicLevel } from '@/components/kettlebell-tournament/phone/use-mic-level';

export type Facing = 'user' | 'environment';

const CAMERA_BLOCKED_MSG =
  'CAMERA/MIC BLOCKED — allow camera and microphone access for this site (HTTPS required) and try again.';

/**
 * The camera phone's local media: one getUserMedia stream (rear camera by
 * default — it is a camera operator's phone), every self-preview <video>
 * following it, the mic level and mute. `onTrackEnded` fires when iOS
 * revokes the video track (backgrounding) so the caller can self-heal.
 */
export function useCamMedia(onTrackEnded: () => void) {
  const [camOn, setCamOn] = useState(false);
  const [camErr, setCamErr] = useState<string | null>(null);
  const [facing, setFacing] = useState<Facing>('environment');
  const [muted, setMuted] = useState(false);

  const camStreamRef = useRef<MediaStream | null>(null);
  const facingRef = useRef<Facing>('environment');
  facingRef.current = facing;
  const onTrackEndedRef = useRef(onTrackEnded);
  onTrackEndedRef.current = onTrackEnded;

  const { attachPreview, syncPreviews } = usePreviewSet(camStreamRef);
  const micLevel = useMicLevel(camStreamRef, camOn);

  /** Resolves true when a live video track is up. */
  const enableCamera = useCallback(
    async (nextFacing?: Facing): Promise<boolean> => {
      const facingMode = nextFacing ?? facingRef.current;
      try {
        camStreamRef.current?.getTracks().forEach((t) => t.stop());
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode,
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        camStreamRef.current = stream;
        // iOS revokes tracks on backgrounding — self-heal like a dead publish.
        stream.getVideoTracks()[0]?.addEventListener('ended', () => {
          if (camStreamRef.current === stream) onTrackEndedRef.current();
        });
        facingRef.current = facingMode;
        setFacing(facingMode);
        syncPreviews();
        setCamOn(true);
        setCamErr(null);
        setMuted(false);
        return stream.getVideoTracks()[0]?.readyState === 'live';
      } catch {
        setCamErr(CAMERA_BLOCKED_MSG);
        setCamOn(false);
        return false;
      }
    },
    [syncPreviews],
  );

  const flipCamera = useCallback(() => {
    void enableCamera(facingRef.current === 'user' ? 'environment' : 'user');
  }, [enableCamera]);

  const toggleMute = useCallback(() => {
    const track = camStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  }, []);

  const stopCamera = useCallback(() => {
    camStreamRef.current?.getTracks().forEach((t) => t.stop());
    camStreamRef.current = null;
    syncPreviews();
    setCamOn(false);
    setMuted(false);
  }, [syncPreviews]);

  /** Set the facing to use on the next enable (session resume). */
  const presetFacing = useCallback((next: Facing) => {
    facingRef.current = next;
    setFacing(next);
  }, []);

  const videoTrackLive = useCallback((): boolean => {
    const t = camStreamRef.current?.getVideoTracks()[0];
    return !!t && t.readyState === 'live';
  }, []);

  return {
    camOn,
    camErr,
    setCamErr,
    facing,
    facingRef,
    muted,
    micLevel,
    camStreamRef,
    attachPreview,
    enableCamera,
    flipCamera,
    toggleMute,
    stopCamera,
    presetFacing,
    videoTrackLive,
  };
}

export type CamMedia = ReturnType<typeof useCamMedia>;
