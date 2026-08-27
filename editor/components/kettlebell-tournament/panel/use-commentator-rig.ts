'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KbtCamOfferEvent } from '@smelter-editor/types';
import { startPublish } from '@/components/control-panel/whip-input/utils/whip-publisher';
import { useWhipHeartbeat } from '@/components/control-panel/whip-input/hooks/use-whip-heartbeat';
import { resolveMediaUrl } from '@/lib/server-url';
import { usePreviewSet } from '../phone/use-preview';
import { useMicLevel } from '../phone/use-mic-level';
import { usePublishWatchdog } from '../phone/use-publish-watchdog';

export type CommentatorRig = {
  camOn: boolean;
  camErr: string | null;
  publishing: boolean;
  live: boolean;
  muted: boolean;
  camInputId: string | null;
  /** Live mic level 0..1 (proof the mic hears you). */
  micLevel: number;
  /** Available inputs — populated after the first permission grant. */
  videoDevices: MediaDeviceInfo[];
  audioDevices: MediaDeviceInfo[];
  videoDeviceId: string | null;
  audioDeviceId: string | null;
  /** Ref-callback for self-preview <video> elements (any number of them). */
  attachPreview: (el: HTMLVideoElement | null) => void;
  enableCamera: () => Promise<void>;
  /** Swap the webcam/mic — live tracks are replaced in-flight. */
  selectDevices: (sel: {
    videoId?: string | null;
    audioId?: string | null;
  }) => Promise<void>;
  toggleMute: () => void;
  /** Real track dimensions for the cam request (aspect-true server tile). */
  getCamDims: () => { width: number; height: number } | null;
  /** Wire into the socket's kbt_cam_offer. */
  handleCamOffer: (ev: KbtCamOfferEvent) => void;
  /** The panel asked for a cam slot — show CONNECTING until publish lands. */
  markPublishing: () => void;
  hasStream: () => boolean;
  /** The publish peer connection exists (not necessarily healthy). */
  hasActivePc: () => boolean;
  /** The current video track is capturing (readyState 'live'). */
  hasLiveTrack: () => boolean;
  /** Tear down the publish without firing onPublishDead (caller-initiated). */
  closePublish: () => void;
  /** One listener for "the publish died" (pc failed/closed, publish POST
   * failed, or the camera track ended) — recovery hooks in here. */
  setOnPublishDead: (cb: (() => void) | null) => void;
  dispose: () => void;
};

/**
 * Desktop camera + microphone rig for the commentator panel: getUserMedia
 * with optional device pinning (laptops pick a webcam/mic, not a facing),
 * WHIP publish on the server's offer, mic mute toggle, ack heartbeat.
 * The phone commentate page keeps its own copy of this flow — the shared
 * parts (startPublish, useWhipHeartbeat, preview/mic/watchdog hooks) are
 * shared utils.
 */
export function useCommentatorRig(roomId: string): CommentatorRig {
  const [camOn, setCamOn] = useState(false);
  const [camErr, setCamErr] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [live, setLive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [camInputId, setCamInputId] = useState<string | null>(null);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoDeviceId, setVideoDeviceId] = useState<string | null>(null);
  const [audioDeviceId, setAudioDeviceId] = useState<string | null>(null);

  const camStreamRef = useRef<MediaStream | null>(null);
  const camPcRef = useRef<RTCPeerConnection | null>(null);
  const mutedRef = useRef(false);
  mutedRef.current = muted;
  const onPublishDeadRef = useRef<(() => void) | null>(null);

  // Gated on `live` so a dead publish stops acking (server-side liveness).
  useWhipHeartbeat(roomId, camInputId, camOn && live);
  const { attachPreview, syncPreviews } = usePreviewSet(camStreamRef);
  const micLevel = useMicLevel(camStreamRef, camOn);
  usePublishWatchdog(live, camPcRef, setCamErr);

  // Labels only populate after a permission grant — call post-getUserMedia.
  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setVideoDevices(all.filter((d) => d.kind === 'videoinput'));
      setAudioDevices(all.filter((d) => d.kind === 'audioinput'));
    } catch {
      /* device list is a convenience — the rig works without it */
    }
  }, []);

  useEffect(() => {
    const md = navigator?.mediaDevices;
    if (!md?.addEventListener) return;
    const onChange = () => void refreshDevices();
    md.addEventListener('devicechange', onChange);
    return () => md.removeEventListener('devicechange', onChange);
  }, [refreshDevices]);

  const acquire = useCallback(
    async (sel?: { videoId?: string | null; audioId?: string | null }) => {
      try {
        const hadStream = camStreamRef.current != null;
        const keepMuted = hadStream && mutedRef.current;
        camStreamRef.current?.getTracks().forEach((t) => t.stop());
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            ...(sel?.videoId ? { deviceId: { exact: sel.videoId } } : {}),
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: {
            ...(sel?.audioId ? { deviceId: { exact: sel.audioId } } : {}),
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        camStreamRef.current = stream;
        // OS-level camera loss (sleep/unplug) ends the track without any
        // peer-connection event — surface it so recovery can republish.
        // (`stop()` on device swaps does NOT fire 'ended', so no false
        // positives; the stream guard covers swapped-out streams anyway.)
        const videoTrack = stream.getVideoTracks()[0];
        videoTrack?.addEventListener('ended', () => {
          if (camStreamRef.current === stream) {
            setLive(false);
            onPublishDeadRef.current?.();
          }
        });
        // A device swap mid-show must not blip the publish: swap the tracks
        // on the live peer connection instead of renegotiating.
        const pc = camPcRef.current;
        if (pc) {
          for (const track of stream.getTracks()) {
            const sender = pc
              .getSenders()
              .find((s) => s.track?.kind === track.kind);
            void sender?.replaceTrack(track).catch(() => {});
          }
        }
        if (keepMuted) {
          const audio = stream.getAudioTracks()[0];
          if (audio) audio.enabled = false;
        } else {
          setMuted(false);
        }
        setVideoDeviceId(
          stream.getVideoTracks()[0]?.getSettings().deviceId ?? null,
        );
        setAudioDeviceId(
          stream.getAudioTracks()[0]?.getSettings().deviceId ?? null,
        );
        syncPreviews();
        setCamOn(true);
        setCamErr(null);
        void refreshDevices();
      } catch {
        setCamErr(
          'CAMERA/MIC BLOCKED — allow camera and microphone access for this site (HTTPS required) and try again.',
        );
        setCamOn(false);
      }
    },
    [syncPreviews, refreshDevices],
  );

  const enableCamera = useCallback(() => acquire(), [acquire]);
  const selectDevices = useCallback(
    (sel: { videoId?: string | null; audioId?: string | null }) =>
      acquire({
        videoId: sel.videoId ?? videoDeviceId,
        audioId: sel.audioId ?? audioDeviceId,
      }),
    [acquire, videoDeviceId, audioDeviceId],
  );

  const toggleMute = useCallback(() => {
    const track = camStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  }, []);

  const getCamDims = useCallback(() => {
    const s = camStreamRef.current?.getVideoTracks()[0]?.getSettings();
    return s?.width && s?.height ? { width: s.width, height: s.height } : null;
  }, []);

  const handleCamOffer = useCallback((ev: KbtCamOfferEvent) => {
    if (!camStreamRef.current) return;
    camPcRef.current?.close();
    camPcRef.current = null;
    setCamInputId(ev.inputId);
    void startPublish(
      ev.inputId,
      ev.bearerToken,
      resolveMediaUrl(ev.whipUrl),
      camPcRef,
      camStreamRef,
      () => {
        camPcRef.current = null;
        setLive(false);
        onPublishDeadRef.current?.();
      },
      undefined,
      false,
      camStreamRef.current,
      'h264',
    )
      .then(() => {
        setLive(true);
        setPublishing(false);
        setCamErr(null);
      })
      .catch(() => {
        camPcRef.current = null;
        setLive(false);
        setPublishing(false);
        setCamErr('PUBLISH FAILED — check the connection and try again.');
        onPublishDeadRef.current?.();
      });
  }, []);

  const markPublishing = useCallback(() => setPublishing(true), []);
  const hasStream = useCallback(() => camStreamRef.current != null, []);
  const hasActivePc = useCallback(() => camPcRef.current != null, []);
  const hasLiveTrack = useCallback(
    () => camStreamRef.current?.getVideoTracks()[0]?.readyState === 'live',
    [],
  );
  const closePublish = useCallback(() => {
    camPcRef.current?.close();
    camPcRef.current = null;
    setLive(false);
  }, []);
  const setOnPublishDead = useCallback((cb: (() => void) | null) => {
    onPublishDeadRef.current = cb;
  }, []);

  const dispose = useCallback(() => {
    camPcRef.current?.close();
    camPcRef.current = null;
    camStreamRef.current?.getTracks().forEach((t) => t.stop());
    camStreamRef.current = null;
  }, []);

  return {
    camOn,
    camErr,
    publishing,
    live,
    muted,
    camInputId,
    micLevel,
    videoDevices,
    audioDevices,
    videoDeviceId,
    audioDeviceId,
    attachPreview,
    enableCamera,
    selectDevices,
    toggleMute,
    getCamDims,
    handleCamOffer,
    markPublishing,
    hasStream,
    hasActivePc,
    hasLiveTrack,
    closePublish,
    setOnPublishDead,
    dispose,
  };
}
