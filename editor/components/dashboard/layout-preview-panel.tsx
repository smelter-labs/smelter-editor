'use client';

import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import type { Input } from '@/lib/types';
import { useActions } from '@/components/control-panel/contexts/actions-context';
import { buildInputColorMap } from '@/components/control-panel/components/timeline/timeline-utils';

interface LayoutPreviewPanelProps {
  roomId: string;
  inputs: Input[];
  resolution: { width: number; height: number };
}

const EASING_MAP: Record<string, string> = {
  linear: 'linear',
  bounce: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  cubic_bezier_ease_in_out: 'ease-in-out',
};

const HANDLE_SIZE = 7;
const SNAP_SCREEN_PX = 5;
const MIN_RECT_PX = 20;

type DragType = 'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se';

type DragState = {
  inputId: string;
  dragType: DragType;
  startX: number;
  startY: number;
  origTop: number;
  origLeft: number;
  origWidth: number;
  origHeight: number;
};

type RectOverride = {
  top: number;
  left: number;
  width: number;
  height: number;
};

function snapAxis(value: number, targets: number[], threshold: number): number {
  for (const t of targets) {
    if (Math.abs(value - t) <= threshold) return t;
  }
  return value;
}

export function LayoutPreviewPanel({
  roomId,
  inputs,
  resolution,
}: LayoutPreviewPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const dragRef = useRef<DragState | null>(null);
  const [dragInputId, setDragInputId] = useState<string | null>(null);
  const [override, setOverride] = useState<RectOverride | null>(null);
  const overrideRef = useRef<RectOverride | null>(null);
  overrideRef.current = override;

  const { updateInput } = useActions();

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

  const snapPos = useCallback(
    (
      top: number,
      left: number,
      width: number,
      height: number,
    ): { top: number; left: number } => {
      if (scale === 0) return { top, left };
      const threshold = SNAP_SCREEN_PX / scale;
      const leftTargets = [
        0,
        Math.round((resolution.width - width) / 2),
        resolution.width - width,
      ];
      const topTargets = [
        0,
        Math.round((resolution.height - height) / 2),
        resolution.height - height,
      ];
      return {
        left: snapAxis(left, leftTargets, threshold),
        top: snapAxis(top, topTargets, threshold),
      };
    },
    [resolution, scale],
  );

  const commitPosition = useCallback(
    (inputId: string, rect: RectOverride) => {
      const pos = {
        absoluteTop: Math.round(rect.top),
        absoluteLeft: Math.round(rect.left),
        absoluteWidth: Math.round(Math.max(MIN_RECT_PX, rect.width)),
        absoluteHeight: Math.round(Math.max(MIN_RECT_PX, rect.height)),
      };

      void updateInput(roomId, inputId, pos);

      window.dispatchEvent(
        new CustomEvent('smelter:layout-map:input-moved', {
          detail: { inputId, ...pos },
        }),
      );
    },
    [roomId, updateInput],
  );

  const handleRectMouseDown = useCallback(
    (e: React.MouseEvent, input: Input) => {
      e.preventDefault();
      e.stopPropagation();
      const absTop = input.absoluteTop ?? 0;
      const absLeft = input.absoluteLeft ?? 0;
      const absW = input.absoluteWidth ?? Math.round(resolution.width * 0.5);
      const absH = input.absoluteHeight ?? Math.round(resolution.height * 0.5);
      dragRef.current = {
        inputId: input.inputId,
        dragType: 'move',
        startX: e.clientX,
        startY: e.clientY,
        origTop: absTop,
        origLeft: absLeft,
        origWidth: absW,
        origHeight: absH,
      };
      setDragInputId(input.inputId);
      setOverride({ top: absTop, left: absLeft, width: absW, height: absH });
    },
    [resolution],
  );

  const handleCornerMouseDown = useCallback(
    (e: React.MouseEvent, input: Input, corner: string) => {
      e.preventDefault();
      e.stopPropagation();
      const absTop = input.absoluteTop ?? 0;
      const absLeft = input.absoluteLeft ?? 0;
      const absW = input.absoluteWidth ?? Math.round(resolution.width * 0.5);
      const absH = input.absoluteHeight ?? Math.round(resolution.height * 0.5);
      dragRef.current = {
        inputId: input.inputId,
        dragType: `resize-${corner}` as DragType,
        startX: e.clientX,
        startY: e.clientY,
        origTop: absTop,
        origLeft: absLeft,
        origWidth: absW,
        origHeight: absH,
      };
      setDragInputId(input.inputId);
      setOverride({ top: absTop, left: absLeft, width: absW, height: absH });
    },
    [resolution],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag || scale === 0) return;

      const dx = (e.clientX - drag.startX) / scale;
      const dy = (e.clientY - drag.startY) / scale;

      let newTop = drag.origTop;
      let newLeft = drag.origLeft;
      let newWidth = drag.origWidth;
      let newHeight = drag.origHeight;

      if (drag.dragType === 'move') {
        newLeft = drag.origLeft + dx;
        newTop = drag.origTop + dy;
        const snapped = snapPos(newTop, newLeft, newWidth, newHeight);
        newTop = snapped.top;
        newLeft = snapped.left;
      } else if (drag.dragType === 'resize-se') {
        newWidth = Math.max(MIN_RECT_PX / scale, drag.origWidth + dx);
        newHeight = Math.max(MIN_RECT_PX / scale, drag.origHeight + dy);
      } else if (drag.dragType === 'resize-sw') {
        const dw = drag.origWidth - dx;
        newWidth = Math.max(MIN_RECT_PX / scale, dw);
        newLeft = drag.origLeft + drag.origWidth - newWidth;
        newHeight = Math.max(MIN_RECT_PX / scale, drag.origHeight + dy);
      } else if (drag.dragType === 'resize-ne') {
        newWidth = Math.max(MIN_RECT_PX / scale, drag.origWidth + dx);
        const dh = drag.origHeight - dy;
        newHeight = Math.max(MIN_RECT_PX / scale, dh);
        newTop = drag.origTop + drag.origHeight - newHeight;
      } else if (drag.dragType === 'resize-nw') {
        const dw = drag.origWidth - dx;
        newWidth = Math.max(MIN_RECT_PX / scale, dw);
        newLeft = drag.origLeft + drag.origWidth - newWidth;
        const dh = drag.origHeight - dy;
        newHeight = Math.max(MIN_RECT_PX / scale, dh);
        newTop = drag.origTop + drag.origHeight - newHeight;
      }

      setOverride({
        top: newTop,
        left: newLeft,
        width: newWidth,
        height: newHeight,
      });
    };

    const handleMouseUp = () => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      const final = overrideRef.current;
      if (final) {
        commitPosition(drag.inputId, final);
      }
      setDragInputId(null);
      setOverride(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [scale, snapPos, commitPosition]);

  const getInputRect = useCallback(
    (input: Input) => {
      if (dragInputId === input.inputId && override) {
        return override;
      }
      return {
        top: input.absoluteTop ?? 0,
        left: input.absoluteLeft ?? 0,
        width:
          input.absoluteWidth ?? Math.round(resolution.width * 0.5),
        height:
          input.absoluteHeight ?? Math.round(resolution.height * 0.5),
      };
    },
    [dragInputId, override, resolution],
  );

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
          className='relative w-full border border-[#3a494b]/40 bg-black select-none'
          style={{
            height: canvasHeight || 'auto',
            aspectRatio: canvasHeight
              ? undefined
              : `${resolution.width}/${resolution.height}`,
          }}>
          {scale > 0 &&
            inputs.map((input, index) => {
              const colors = inputColorMap.get(input.inputId);
              const rect = getInputRect(input);
              const isDragging = dragInputId === input.inputId;
              const top = rect.top * scale;
              const left = rect.left * scale;
              const width = rect.width * scale;
              const height = rect.height * scale;
              const isHidden = !!input.hidden;
              const durationMs = isDragging
                ? 0
                : (input.absoluteTransitionDurationMs ?? 300);
              const easing = isDragging
                ? 'linear'
                : (EASING_MAP[input.absoluteTransitionEasing ?? 'linear'] ??
                  'linear');

              const corners = [
                { id: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
                { id: 'ne', x: width, y: 0, cursor: 'nesw-resize' },
                { id: 'sw', x: 0, y: height, cursor: 'nesw-resize' },
                { id: 'se', x: width, y: height, cursor: 'nwse-resize' },
              ];

              return (
                <div
                  key={input.inputId}
                  className='absolute overflow-visible'
                  style={{
                    top,
                    left,
                    width,
                    height,
                    zIndex: isDragging ? 1000 : index,
                    transition: durationMs > 0
                      ? `top ${durationMs}ms ${easing}, left ${durationMs}ms ${easing}, width ${durationMs}ms ${easing}, height ${durationMs}ms ${easing}, opacity ${durationMs}ms ${easing}`
                      : 'none',
                  }}>
                  {/* Main draggable area */}
                  <div
                    className='absolute inset-0 flex items-end'
                    style={{
                      backgroundColor: colors?.segBorder,
                      border: isDragging
                        ? `2px solid ${colors?.dot ?? '#737373'}`
                        : `1px solid ${colors?.dot ?? '#737373'}`,
                      borderStyle: isHidden ? 'dashed' : 'solid',
                      opacity: isHidden ? 0.15 : 1,
                      cursor: 'grab',
                    }}
                    onMouseDown={(e) => handleRectMouseDown(e, input)}>
                    <span
                      className='block w-full truncate px-0.5 text-white font-mono leading-tight pointer-events-none'
                      style={{
                        fontSize: Math.max(8, Math.min(11, width * 0.08)),
                        backgroundColor: colors?.ring,
                      }}>
                      {input.title || input.inputId}
                    </span>
                  </div>

                  {/* Corner resize handles */}
                  {corners.map((c) => (
                    <div
                      key={c.id}
                      className='absolute z-10'
                      style={{
                        left: c.x - HANDLE_SIZE / 2,
                        top: c.y - HANDLE_SIZE / 2,
                        width: HANDLE_SIZE,
                        height: HANDLE_SIZE,
                        backgroundColor: colors?.dot ?? '#737373',
                        border: '1px solid rgba(255,255,255,0.5)',
                        cursor: c.cursor,
                        opacity: isHidden ? 0.15 : 0.8,
                      }}
                      onMouseDown={(e) =>
                        handleCornerMouseDown(e, input, c.id)
                      }
                    />
                  ))}
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
