'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { LONG_PRESS_MS } from './timeline-utils';

export function ColorSwatch({
  color,
  onQuickClick,
  onLongPress,
}: {
  color: string;
  onQuickClick: (c: string) => void;
  onLongPress: (c: string) => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);
  const [pressing, setPressing] = useState(false);

  const cancel = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setPressing(false);
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      firedRef.current = false;
      setPressing(true);
      timerRef.current = setTimeout(() => {
        firedRef.current = true;
        setPressing(false);
        onLongPress(color);
      }, LONG_PRESS_MS);
    },
    [color, onLongPress],
  );

  const handlePointerUp = useCallback(() => {
    cancel();
    if (!firedRef.current) onQuickClick(color);
  }, [cancel, color, onQuickClick]);

  const handlePointerLeave = useCallback(() => {
    cancel();
  }, [cancel]);

  useEffect(() => () => cancel(), [cancel]);

  const circumference = 2 * Math.PI * 8;

  return (
    <Button
      variant='ghost'
      size='icon'
      className='relative w-5 h-5 rounded-sm border border-border hover:scale-125 transition-transform cursor-pointer p-0'
      style={{ backgroundColor: color }}
      title={`Click to apply, hold for shades`}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}>
      {pressing && (
        <svg
          className='absolute inset-[-3px] w-[calc(100%+6px)] h-[calc(100%+6px)] pointer-events-none'
          viewBox='0 0 26 26'>
          <circle
            cx='13'
            cy='13'
            r='8'
            fill='none'
            stroke='rgba(255,255,255,0.6)'
            strokeWidth='2.5'
            strokeDasharray={circumference}
            strokeDashoffset={circumference}
            strokeLinecap='round'
            style={{
              animation: `swatch-ring ${LONG_PRESS_MS}ms linear forwards`,
            }}
          />
        </svg>
      )}
      <style>{`
        @keyframes swatch-ring {
          from { stroke-dashoffset: ${circumference}; }
          to   { stroke-dashoffset: 0; }
        }
      `}</style>
    </Button>
  );
}
