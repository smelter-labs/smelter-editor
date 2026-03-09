'use client';

import { useCallback, useRef, useState, useEffect } from 'react';

type Position = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type AbsolutePositionControllerProps = {
  resolution: { width: number; height: number };
  top: number;
  left: number;
  width: number;
  height: number;
  onChange: (pos: Position) => void;
};

type DragState =
  | { type: 'idle' }
  | { type: 'move'; startX: number; startY: number; origLeft: number; origTop: number }
  | { type: 'resize'; corner: string; startX: number; startY: number; origPos: Position; aspectRatio: number };

const HANDLE_SIZE = 8;

export function AbsolutePositionController({
  resolution,
  top,
  left,
  width,
  height,
  onChange,
}: AbsolutePositionControllerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState>({ type: 'idle' });
  const [localPos, setLocalPos] = useState<Position | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const pos = localPos ?? { top, left, width, height };

  const containerWidth = 280;
  const scale = containerWidth / resolution.width;
  const containerHeight = Math.round(resolution.height * scale);

  const toCanvas = useCallback(
    (p: Position) => ({
      x: p.left * scale,
      y: p.top * scale,
      w: p.width * scale,
      h: p.height * scale,
    }),
    [scale],
  );

  const clampPos = useCallback(
    (p: Position): Position => ({
      top: Math.round(Math.max(0, Math.min(p.top, resolution.height - p.height))),
      left: Math.round(Math.max(0, Math.min(p.left, resolution.width - p.width))),
      width: Math.round(Math.max(20, Math.min(p.width, resolution.width))),
      height: Math.round(Math.max(20, Math.min(p.height, resolution.height))),
    }),
    [resolution],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, type: 'move' | string) => {
      e.preventDefault();
      e.stopPropagation();
      if (type === 'move') {
        dragRef.current = {
          type: 'move',
          startX: e.clientX,
          startY: e.clientY,
          origLeft: pos.left,
          origTop: pos.top,
        };
      } else {
        const aspectRatio = pos.width / pos.height;
        dragRef.current = {
          type: 'resize',
          corner: type,
          startX: e.clientX,
          startY: e.clientY,
          origPos: { ...pos },
          aspectRatio,
        };
      }
    },
    [pos],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (drag.type === 'idle') return;

      if (drag.type === 'move') {
        const dx = (e.clientX - drag.startX) / scale;
        const dy = (e.clientY - drag.startY) / scale;
        const newPos = clampPos({
          ...pos,
          left: drag.origLeft + dx,
          top: drag.origTop + dy,
        });
        setLocalPos(newPos);
      } else if (drag.type === 'resize') {
        const dx = (e.clientX - drag.startX) / scale;
        const dy = (e.clientY - drag.startY) / scale;
        const { origPos, corner, aspectRatio } = drag;
        let newPos = { ...origPos };

        if (corner === 'se') {
          const newW = Math.max(40, origPos.width + dx);
          const newH = newW / aspectRatio;
          newPos = { ...origPos, width: newW, height: newH };
        } else if (corner === 'sw') {
          const newW = Math.max(40, origPos.width - dx);
          const newH = newW / aspectRatio;
          newPos = {
            ...origPos,
            left: origPos.left + origPos.width - newW,
            width: newW,
            height: newH,
          };
        } else if (corner === 'ne') {
          const newW = Math.max(40, origPos.width + dx);
          const newH = newW / aspectRatio;
          newPos = {
            ...origPos,
            top: origPos.top + origPos.height - newH,
            width: newW,
            height: newH,
          };
        } else if (corner === 'nw') {
          const newW = Math.max(40, origPos.width - dx);
          const newH = newW / aspectRatio;
          newPos = {
            ...origPos,
            left: origPos.left + origPos.width - newW,
            top: origPos.top + origPos.height - newH,
            width: newW,
            height: newH,
          };
        }
        setLocalPos(clampPos(newPos));
      }
    };

    const handleMouseUp = () => {
      if (dragRef.current.type !== 'idle') {
        dragRef.current = { type: 'idle' };
        setLocalPos((current) => {
          if (current) {
            onChangeRef.current(current);
          }
          return null;
        });
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [scale, clampPos, pos]);

  const canvasRect = toCanvas(pos);

  const corners = [
    { id: 'nw', x: canvasRect.x, y: canvasRect.y, cursor: 'nwse-resize' },
    { id: 'ne', x: canvasRect.x + canvasRect.w, y: canvasRect.y, cursor: 'nesw-resize' },
    { id: 'sw', x: canvasRect.x, y: canvasRect.y + canvasRect.h, cursor: 'nesw-resize' },
    { id: 'se', x: canvasRect.x + canvasRect.w, y: canvasRect.y + canvasRect.h, cursor: 'nwse-resize' },
  ];

  return (
    <div className='mb-3'>
      <div
        ref={containerRef}
        className='relative border border-neutral-600 bg-neutral-900 mx-auto select-none'
        style={{ width: containerWidth, height: containerHeight }}>
        <div
          className='absolute bg-blue-500/30 border border-blue-400'
          style={{
            left: canvasRect.x,
            top: canvasRect.y,
            width: canvasRect.w,
            height: canvasRect.h,
            cursor: 'move',
          }}
          onMouseDown={(e) => handleMouseDown(e, 'move')}
        />
        {corners.map((c) => (
          <div
            key={c.id}
            className='absolute bg-blue-400 border border-blue-300'
            style={{
              left: c.x - HANDLE_SIZE / 2,
              top: c.y - HANDLE_SIZE / 2,
              width: HANDLE_SIZE,
              height: HANDLE_SIZE,
              cursor: c.cursor,
            }}
            onMouseDown={(e) => handleMouseDown(e, c.id)}
          />
        ))}
      </div>
      <div className='grid grid-cols-4 gap-1 mt-2'>
        {(['left', 'top', 'width', 'height'] as const).map((field) => (
          <div key={field}>
            <label className='text-[10px] text-neutral-500 block'>
              {field[0].toUpperCase() + field.slice(1)}
            </label>
            <input
              type='number'
              className='w-full bg-neutral-800 border border-neutral-700 text-white text-xs px-1 py-0.5'
              value={pos[field]}
              onChange={(e) => {
                const val = Number(e.target.value) || 0;
                const newPos = clampPos({ ...pos, [field]: val });
                onChange(newPos);
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
