'use client';

import { useEffect, useRef } from 'react';
import type { FxConfig } from './types';
import {
  createFxState,
  updateFx,
  drawFx,
  makeCircuits,
  makeDotPattern,
} from './fx-engine';

export type FxCanvasProps = {
  config: FxConfig;
  isActive: boolean;
  intensity?: number;
  hues?: number[];
  className?: string;
};

export function FxCanvas({
  config,
  isActive,
  intensity,
  hues,
  className,
}: FxCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const configRef = useRef(config);
  const intensityRef = useRef(intensity);
  const huesRef = useRef(hues);

  configRef.current = config;
  intensityRef.current = intensity;
  huesRef.current = hues;

  useEffect(() => {
    if (!isActive) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }

    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = parent.getBoundingClientRect();
    canvas.width = Math.ceil(rect.width * dpr);
    canvas.height = Math.ceil(rect.height * dpr);

    const cfg = configRef.current;
    const st = createFxState(rect.width, rect.height, dpr, cfg);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width: rw, height: rh } = entry.contentRect;
      canvas.width = Math.ceil(rw * dpr);
      canvas.height = Math.ceil(rh * dpr);
      st.w = rw;
      st.h = rh;
      if (configRef.current.layers.circuits) {
        st.circuits = makeCircuits(rw, rh, configRef.current.circuitCount);
      }
      if (configRef.current.layers.dots) {
        st.dots = makeDotPattern(rw, rh, dpr);
      }
    });
    observer.observe(parent);

    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;

      const liveCfg: FxConfig = {
        ...configRef.current,
        ...(intensityRef.current !== undefined && {
          intensity: intensityRef.current,
        }),
        ...(huesRef.current !== undefined && { hues: huesRef.current }),
      };

      updateFx(st, dt, liveCfg);
      drawFx(ctx, st, liveCfg);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      observer.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [isActive]);

  if (!isActive) return null;

  return (
    <canvas
      ref={canvasRef}
      className={className ?? 'absolute inset-0 pointer-events-none'}
      style={{ borderRadius: 'inherit' }}
    />
  );
}
