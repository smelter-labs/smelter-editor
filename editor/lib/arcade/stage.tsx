'use client';

import { useEffect, useState } from 'react';

export const STAGE_W = 1280;
export const STAGE_H = 720;

/**
 * Fullscreen wrapper that letterboxes and scales a fixed 1280×720 design
 * space to the viewport — the shared canvas contract of the arcade games
 * (duck-hunter, kettlebell-tournament), so fullscreen video and panel
 * overlays always line up. Each game's kit re-exports this bound to its own
 * background token.
 */
export function ArcadeStage({
  children,
  background,
}: {
  children: React.ReactNode;
  background: string;
}) {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const update = () =>
      setScale(
        Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H),
      );
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}>
      <div
        style={{
          width: STAGE_W,
          height: STAGE_H,
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
          position: 'relative',
          flexShrink: 0,
        }}>
        {children}
      </div>
    </div>
  );
}
