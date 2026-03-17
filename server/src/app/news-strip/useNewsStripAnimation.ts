import { useEffect, useState } from 'react';

export function useNewsStripAnimation(width: number) {
  const [waveAmpPx, setWaveAmpPx] = useState(0);
  const [waveSpeed, setWaveSpeed] = useState(0);
  const [marqueeLeft, setMarqueeLeft] = useState(width);
  useEffect(() => {
    let mounted = true;
    let tweenId: ReturnType<typeof setInterval> | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let marqueeId: ReturnType<typeof setInterval> | null = null;
    const tween = (from: number, to: number, ms: number) => {
      if (tweenId) {
        clearInterval(tweenId);
        tweenId = null;
      }
      const start = Date.now();
      tweenId = setInterval(() => {
        const t = Math.min(1, (Date.now() - start) / Math.max(1, ms));
        const val = from + (to - from) * t;
        if (!mounted) {
          return;
        }
        setWaveAmpPx(Math.max(0, val));
        if (t >= 1) {
          if (tweenId) {
            clearInterval(tweenId);
            tweenId = null;
          }
        }
      }, 16);
    };
    const runCycle = () => {
      if (!mounted) {
        return;
      }
      setWaveSpeed(0);
      setWaveAmpPx(0);
      if (!marqueeId) {
        const pxPerSec = 240;
        const intervalMs = 10;
        const step = (pxPerSec * intervalMs) / 1000;
        const resetRight = width;
        const minLeft = -width * 2.2;
        marqueeId = setInterval(() => {
          if (!mounted) {
            return;
          }
          setMarqueeLeft((prev) => {
            const next = prev - step;
            return next < minLeft ? resetRight : next;
          });
        }, intervalMs);
      }
      timerId = setTimeout(() => {
        if (!mounted) {
          return;
        }
        setWaveSpeed(6);
        tween(0, 25, 500);
        timerId = setTimeout(() => {
          if (!mounted) {
            return;
          }
          tween(25, 0, 500);
          timerId = setTimeout(() => {
            if (!mounted) {
              return;
            }
            runCycle();
          }, 4000);
        }, 2000);
      }, 3000);
    };
    runCycle();
    return () => {
      mounted = false;
      if (tweenId) {
        clearInterval(tweenId);
      }
      if (timerId) {
        clearTimeout(timerId);
      }
    };
  }, [width]);

  return { waveAmpPx, waveSpeed, marqueeLeft };
}
