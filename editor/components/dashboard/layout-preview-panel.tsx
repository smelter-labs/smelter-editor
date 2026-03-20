'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import type { Input } from '@/lib/types';

interface LayoutPreviewPanelProps {
  inputs: Input[];
  resolution: { width: number; height: number };
}

const INPUT_COLORS = [
  { bg: 'rgba(59,130,246,0.30)', border: '#3b82f6' },
  { bg: 'rgba(168,85,247,0.30)', border: '#a855f7' },
  { bg: 'rgba(34,197,94,0.30)', border: '#22c55e' },
  { bg: 'rgba(234,179,8,0.30)', border: '#eab308' },
  { bg: 'rgba(239,68,68,0.30)', border: '#ef4444' },
  { bg: 'rgba(6,182,212,0.30)', border: '#06b6d4' },
  { bg: 'rgba(249,115,22,0.30)', border: '#f97316' },
  { bg: 'rgba(236,72,153,0.30)', border: '#ec4899' },
];

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

  const getColor = useCallback(
    (index: number) => INPUT_COLORS[index % INPUT_COLORS.length],
    [],
  );

  return (
    <div className='flex flex-col h-full bg-[#080808] overflow-hidden'>
      <div className='flex justify-between items-center px-3 py-1.5 text-[#b9cacb] border-b border-[#3a494b]/20 shrink-0 font-mono text-[10px]'>
        <span className='tracking-widest uppercase'>Layout_Map</span>
        <span className='text-[#849495]'>
          {resolution.width}x{resolution.height}
        </span>
      </div>

      <div className='flex-1 flex items-center justify-center p-3 min-h-0'>
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
              const color = getColor(index);
              const top = (input.absoluteTop ?? 0) * scale;
              const left = (input.absoluteLeft ?? 0) * scale;
              const width =
                (input.absoluteWidth ?? Math.round(resolution.width * 0.5)) *
                scale;
              const height =
                (input.absoluteHeight ?? Math.round(resolution.height * 0.5)) *
                scale;
              const isHidden = !!input.hidden;

              return (
                <div
                  key={input.inputId}
                  className='absolute overflow-hidden flex items-end'
                  style={{
                    top,
                    left,
                    width,
                    height,
                    backgroundColor: color.bg,
                    border: `1px solid ${color.border}`,
                    borderStyle: isHidden ? 'dashed' : 'solid',
                    opacity: isHidden ? 0.4 : 1,
                    zIndex: index,
                  }}>
                  <span
                    className='block w-full truncate px-0.5 text-white font-mono leading-tight'
                    style={{
                      fontSize: Math.max(8, Math.min(11, width * 0.08)),
                      backgroundColor: `${color.border}88`,
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
          {inputs.map((input, index) => {
            const color = getColor(index);
            return (
              <span
                key={input.inputId}
                className='flex items-center gap-1 truncate max-w-[120px]'
                style={{ opacity: input.hidden ? 0.4 : 1 }}>
                <span
                  className='inline-block w-2 h-2 shrink-0 rounded-sm'
                  style={{
                    backgroundColor: color.border,
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
