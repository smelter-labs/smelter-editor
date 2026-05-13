'use client';

import { useEffect, useRef } from 'react';

type Options = {
  enabled: boolean;
  onClap: () => void;
  /** Absolute floor in dB in the 2–5 kHz band; peaks below this never trigger. Default -50. */
  peakThresholdDb?: number;
  /** Required rise in dB vs the rolling baseline to count as a transient. Default 10. */
  transientRiseDb?: number;
  /** Cooldown between detected claps, in ms. Default 600. */
  cooldownMs?: number;
};

const SAMPLE_RATE = 48000;
const FFT_SIZE = 1024;
const BAND_LOW_HZ = 2000;
const BAND_HIGH_HZ = 5000;
// Rolling history of frame peaks used to compute the baseline. ~30 frames at
// ~60fps ≈ 0.5s of audio.
const HISTORY_FRAMES = 30;
// How many of the most recent frames to exclude from baseline so a clap doesn't
// pollute its own baseline (claps last ~50–100ms = ~3–6 frames).
const SKIP_RECENT = 4;

export function useClapDetection({
  enabled,
  onClap,
  peakThresholdDb = -60,
  transientRiseDb = 10,
  cooldownMs = 600,
}: Options) {
  const onClapRef = useRef(onClap);
  useEffect(() => {
    onClapRef.current = onClap;
  }, [onClap]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;
    if (!navigator.mediaDevices?.getUserMedia) return;

    let cancelled = false;
    let audioCtx: AudioContext | null = null;
    let stream: MediaStream | null = null;
    let analyser: AnalyserNode | null = null;
    let rafId = 0;
    let lastClapAt = 0;
    const peakHistory: number[] = [];

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        audioCtx = new (
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext
        )({ sampleRate: SAMPLE_RATE });
        const source = audioCtx.createMediaStreamSource(stream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = FFT_SIZE;
        analyser.smoothingTimeConstant = 0;
        analyser.minDecibels = -90;
        analyser.maxDecibels = 0;
        source.connect(analyser);

        const binCount = analyser.frequencyBinCount;
        const sampleRate = audioCtx.sampleRate;
        const lowBin = Math.floor((BAND_LOW_HZ * FFT_SIZE) / sampleRate);
        const highBin = Math.min(
          Math.ceil((BAND_HIGH_HZ * FFT_SIZE) / sampleRate),
          binCount - 1,
        );

        const buf = new Float32Array(binCount);

        const frame = () => {
          if (!analyser) return;
          analyser.getFloatFrequencyData(buf);
          let peakDb = -Infinity;
          for (let i = lowBin; i <= highBin; i++) {
            const v = buf[i];
            if (v > peakDb) peakDb = v;
          }

          // Baseline = average of older frames in the history (skip the most
          // recent ones so a clap doesn't dilute its own baseline). Until we
          // have enough history, fall back to a very low baseline so the
          // spike check doesn't trip on the first few frames.
          const baselineLen = peakHistory.length - SKIP_RECENT;
          let baselineDb = -Infinity;
          if (baselineLen > 0) {
            let sum = 0;
            for (let i = 0; i < baselineLen; i++) sum += peakHistory[i];
            baselineDb = sum / baselineLen;
          }

          const now = performance.now();
          const cooled = now - lastClapAt > cooldownMs;
          const aboveFloor = peakDb >= peakThresholdDb;
          const spike =
            baselineDb > -Infinity && peakDb - baselineDb >= transientRiseDb;

          if (cooled && aboveFloor && spike) {
            lastClapAt = now;
            try {
              onClapRef.current();
            } catch {}
          }

          peakHistory.push(peakDb);
          if (peakHistory.length > HISTORY_FRAMES) peakHistory.shift();
          rafId = requestAnimationFrame(frame);
        };

        rafId = requestAnimationFrame(frame);
      } catch (err) {
        console.warn('[useClapDetection] getUserMedia failed:', err);
      }
    };

    start();

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (analyser) analyser.disconnect();
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (audioCtx && audioCtx.state !== 'closed')
        audioCtx.close().catch(() => {});
    };
  }, [enabled, peakThresholdDb, transientRiseDb, cooldownMs]);
}
