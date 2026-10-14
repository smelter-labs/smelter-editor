'use client';

import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { ObCamHandFrameMessage } from '@smelter-editor/types';
import { FrameTracker, type Hand, type Quad } from '@/lib/ob-van/finger-frame';

// In-browser finger-frame detection: MediaPipe HandLandmarker on the local
// camera stream, the same quad geometry as the server's Python worker
// (lib/ob-van/finger-frame.ts), results shipped to the server (the cam
// socket on the phone page; REST from the editor's WHIP publish tab). Runs
// only while the operator has FRAME on and this camera publishes — the
// server holds each quad for the side-channel delay, so it lands on the
// program in sync with the picture.

const DETECT_INTERVAL_MS = 50; // ~20 Hz — HandLandmarker is ~10 ms a pass
const WASM_PATH = '/hand-tracking/wasm';
const MODEL_PATH = '/hand-tracking/hand_landmarker.task';

export type HandFrameStatus = 'off' | 'loading' | 'running' | 'unavailable';

type Landmarker = {
  detectForVideo: (
    video: HTMLVideoElement,
    tsMs: number,
  ) => { landmarks?: { x: number; y: number }[][] };
  close: () => void;
};

type SendHandFrame = (msg: Omit<ObCamHandFrameMessage, 'type'>) => void;

/**
 * Detect the finger-frame quad on the phone and stream it to the server.
 * Returns the latest quad (normalised to the captured frame — the raw,
 * unmirrored picture the server receives) for the preview overlay, and a
 * status for the HUD. The landmarker is created once on first use and kept
 * across FRAME toggles (re-creating it costs ~a second).
 */
export function useHandFrame(
  enabled: boolean,
  media: { camStreamRef: MutableRefObject<MediaStream | null> },
  sendHandFrame: SendHandFrame,
): {
  quad: Quad | null;
  status: HandFrameStatus;
  /** Wall time of the last pinch switch — the HUD flashes on changes. */
  lastSwitchAt: number | null;
} {
  const [quad, setQuad] = useState<Quad | null>(null);
  const [status, setStatus] = useState<HandFrameStatus>('off');
  const [lastSwitchAt, setLastSwitchAt] = useState<number | null>(null);
  const landmarkerRef = useRef<Landmarker | null>(null);
  const failedRef = useRef(false);
  const sendRef = useRef<SendHandFrame>(sendHandFrame);
  sendRef.current = sendHandFrame;
  const { camStreamRef } = media;

  useEffect(() => {
    if (!enabled) {
      setStatus((s) => (s === 'unavailable' ? s : 'off'));
      setQuad(null);
      return;
    }
    if (failedRef.current) {
      setStatus('unavailable');
      return;
    }
    let cancelled = false;
    let timer: number | null = null;
    const tracker = new FrameTracker();
    let lastTsMs = 0;

    // The detector gets its own hidden <video>: the preview elements belong
    // to usePreviewSet, and the stream object is swapped on flip/self-heal,
    // so every tick re-points srcObject whenever the ref moved on. It lives
    // in the DOM, tiny and invisible — some browsers stop decoding video
    // for detached or display:none elements, which would starve detection.
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.style.cssText =
      'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
    document.body.appendChild(video);

    // Keep the hidden element fed with the latest stream (also called per
    // tick — a flip / self-heal replaces the MediaStream object silently).
    const syncStream = () => {
      const stream = camStreamRef.current;
      if (video.srcObject !== stream) {
        video.srcObject = stream;
        if (stream) void video.play().catch(() => {});
      }
    };

    const stop = () => {
      if (timer != null) window.clearInterval(timer);
      video.srcObject = null;
      video.remove();
    };

    const tick = () => {
      if (cancelled) return;
      const now = performance.now();
      syncStream();
      const lm = landmarkerRef.current;
      const stream = camStreamRef.current;
      if (!lm || !stream || video.readyState < 2 || video.videoWidth === 0) {
        return;
      }
      // VIDEO mode needs strictly increasing timestamps.
      const ts = Math.max(Math.round(now), lastTsMs + 1);
      lastTsMs = ts;
      let hands: Hand[] = [];
      try {
        const result = lm.detectForVideo(video, ts);
        hands = (result.landmarks ?? []).map((hand) =>
          hand.map((p) => [p.x, p.y] as [number, number]),
        );
      } catch {
        // A single failed pass (e.g. mid-resize) is a miss, not a crash.
      }
      // Diagnostic heartbeat: `window.__obHandFrameTicks` growing in the
      // console proves the loop is consuming camera frames.
      const w = window as Window & { __obHandFrameTicks?: number };
      w.__obHandFrameTicks = (w.__obHandFrameTicks ?? 0) + 1;
      const res = tracker.update(hands, now);
      const procMs = Math.round(performance.now() - now);
      if (res.switch) {
        sendRef.current({ quad: null, switch: true });
        setLastSwitchAt(Date.now());
      }
      if (res.send) {
        sendRef.current({
          quad: res.send.quad,
          frameW: video.videoWidth,
          frameH: video.videoHeight,
          procMs,
        });
      }
      setQuad((prev) => (prev === res.quad ? prev : res.quad));
    };

    const start = async () => {
      if (!landmarkerRef.current) {
        setStatus('loading');
        try {
          const vision = await import('@mediapipe/tasks-vision');
          const fileset =
            await vision.FilesetResolver.forVisionTasks(WASM_PATH);
          const make = (delegate: 'GPU' | 'CPU') =>
            vision.HandLandmarker.createFromOptions(fileset, {
              baseOptions: { modelAssetPath: MODEL_PATH, delegate },
              runningMode: 'VIDEO',
              numHands: 2,
              // Matches the Python worker. Low on purpose: desk webcams in
              // dim rooms drop hands at higher bars, and the geometric pose
              // gates filter whatever slips through.
              minHandDetectionConfidence: 0.3,
              minHandPresenceConfidence: 0.3,
              minTrackingConfidence: 0.3,
            });
          landmarkerRef.current = await make('GPU').catch(() => make('CPU'));
        } catch (err) {
          console.warn('[ob] hand landmarker unavailable', err);
          failedRef.current = true;
          if (!cancelled) setStatus('unavailable');
          return;
        }
      }
      if (cancelled) return;
      setStatus('running');
      syncStream();
      timer = window.setInterval(tick, DETECT_INTERVAL_MS);
    };

    void start();

    return () => {
      cancelled = true;
      stop();
      const release = tracker.reset();
      if (release) sendRef.current({ quad: null });
      setQuad(null);
    };
  }, [enabled, camStreamRef]);

  // The landmarker survives toggles; free it when the page goes away.
  useEffect(
    () => () => {
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    },
    [],
  );

  return { quad, status, lastSwitchAt };
}
