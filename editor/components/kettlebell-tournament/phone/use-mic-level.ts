'use client';

import { useEffect, useRef, useState } from 'react';

const POLL_MS = 100;
// Speech RMS on a normalized signal is small (~0.05–0.25) — scale so a
// normal talking voice fills most of the bar.
const GAIN = 4;

/**
 * Live microphone level (0..1) off the rig stream — proof the mic is picking
 * up the voice before it goes on air. Rebuilds its source node whenever the
 * stream in the ref is swapped (camera flip, device switch), so callers just
 * keep the ref current. The AudioContext is created lazily on the first
 * active poll — by then a user gesture (ENABLE CAMERA) has already happened.
 */
export function useMicLevel(
  streamRef: React.MutableRefObject<MediaStream | null>,
  active: boolean,
): number {
  const [level, setLevel] = useState(0);
  const smoothedRef = useRef(0);

  useEffect(() => {
    if (!active) {
      smoothedRef.current = 0;
      setLevel(0);
      return;
    }
    let ctx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let sourceStream: MediaStream | null = null;
    let buf: Uint8Array<ArrayBuffer> | null = null;

    const timer = window.setInterval(() => {
      const stream = streamRef.current;
      if (!stream || stream.getAudioTracks().length === 0) {
        smoothedRef.current = 0;
        setLevel(0);
        return;
      }
      try {
        ctx ??= new AudioContext();
        if (ctx.state === 'suspended') void ctx.resume();
        if (!analyser) {
          analyser = ctx.createAnalyser();
          analyser.fftSize = 1024;
          buf = new Uint8Array(analyser.fftSize);
        }
        if (!source || sourceStream !== stream) {
          source?.disconnect();
          source = ctx.createMediaStreamSource(stream);
          source.connect(analyser);
          sourceStream = stream;
        }
        analyser.getByteTimeDomainData(buf!);
        let sum = 0;
        for (let i = 0; i < buf!.length; i++) {
          const v = (buf![i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf!.length);
        // Fast attack, slow release — flickers less than raw RMS.
        const target = Math.min(1, rms * GAIN);
        smoothedRef.current =
          target > smoothedRef.current
            ? target
            : smoothedRef.current * 0.7 + target * 0.3;
        setLevel(smoothedRef.current);
      } catch {
        setLevel(0);
      }
    }, POLL_MS);

    return () => {
      window.clearInterval(timer);
      source?.disconnect();
      void ctx?.close().catch(() => {});
    };
  }, [active, streamRef]);

  return level;
}
