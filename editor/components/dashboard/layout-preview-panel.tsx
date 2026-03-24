'use client';

import { useRef, useState, useEffect, useMemo } from 'react';
import type { Input } from '@/lib/types';
import { buildInputColorMap } from '@/components/control-panel/components/timeline/timeline-utils';

interface LayoutPreviewPanelProps {
  inputs: Input[];
  resolution: { width: number; height: number };
}

const EASING_MAP: Record<string, string> = {
  linear: 'linear',
  bounce: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  cubic_bezier_ease_in_out: 'ease-in-out',
};

export function LayoutPreviewPanel({
  inputs,
  resolution,
}: LayoutPreviewPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scale = containerWidth > 0 ? containerWidth / resolution.width : 0;
  const canvasHeight = Math.round(resolution.height * scale);

  const inputColorMap = useMemo(() => buildInputColorMap(inputs), [inputs]);

  return (
    <div className='flex flex-col h-full bg-[#080808]'>
      <div className='flex justify-between items-center px-3 py-1.5 text-[#b9cacb] border-b border-[#3a494b]/20 shrink-0 font-mono text-[10px]'>
        <span className='tracking-widest uppercase'>Layout_Map</span>
        <span className='text-[#849495]'>
          {resolution.width}x{resolution.height}
        </span>
      </div>

      <div className='flex-1 flex items-center justify-center px-10 py-3 min-h-0'>
        <div
          ref={containerRef}
          className='relative w-full border border-[#3a494b]/40 bg-black'
          style={{
            height: canvasHeight || 'auto',
            aspectRatio: canvasHeight
              ? undefined
              : `${resolution.width}/${resolution.height}`,
          }}>
          {scale > 0 &&
            inputs.map((input, index) => {
              const colors = inputColorMap.get(input.inputId);
              const top = (input.absoluteTop ?? 0) * scale;
              const left = (input.absoluteLeft ?? 0) * scale;
              const width =
                (input.absoluteWidth ?? Math.round(resolution.width * 0.5)) *
                scale;
              const height =
                (input.absoluteHeight ?? Math.round(resolution.height * 0.5)) *
                scale;
              const isHidden = !!input.hidden;
              const durationMs =
                input.absoluteTransitionDurationMs ?? 300;
              const easing =
                EASING_MAP[input.absoluteTransitionEasing ?? 'linear'] ??
                'linear';

              return (
                <div
                  key={input.inputId}
                  className='absolute overflow-hidden flex items-end'
                  style={{
                    top,
                    left,
                    width,
                    height,
                    backgroundColor: colors?.segBorder,
                    border: `1px solid ${colors?.dot ?? '#737373'}`,
                    borderStyle: isHidden ? 'dashed' : 'solid',
                    opacity: isHidden ? 0.15 : 1,
                    zIndex: index,
                    transition: `top ${durationMs}ms ${easing}, left ${durationMs}ms ${easing}, width ${durationMs}ms ${easing}, height ${durationMs}ms ${easing}, opacity ${durationMs}ms ${easing}`,
                  }}>
                  <span
                    className='block w-full truncate px-0.5 text-white font-mono leading-tight'
                    style={{
                      fontSize: Math.max(8, Math.min(11, width * 0.08)),
                      backgroundColor: colors?.ring,
                    }}>
                    {input.title || input.inputId}
                  </span>
                </div>
              );
            })}
        </div>
      </div>

      {inputs.length > 0 && (
        <div className='flex flex-wrap gap-x-3 gap-y-0.5 px-3 pb-2 font-mono text-[9px] text-[#b9cacb] shrink-0'>
          {inputs.map((input) => {
            const colors = inputColorMap.get(input.inputId);
            return (
              <span
                key={input.inputId}
                className='flex items-center gap-1 truncate max-w-[120px]'
                style={{ opacity: input.hidden ? 0.15 : 1 }}>
                <span
                  className='inline-block w-2 h-2 shrink-0 rounded-sm'
                  style={{
                    backgroundColor: colors?.dot ?? '#737373',
                  }}
                />
                <span className='truncate'>{input.title || input.inputId}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
