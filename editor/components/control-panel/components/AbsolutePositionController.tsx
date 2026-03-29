'use client';

import { useCallback, useRef, useState, useEffect } from 'react';
import { NumberInput } from '@/components/ui/number-input';

type Position = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type CropValues = {
  cropTop: number;
  cropLeft: number;
  cropRight: number;
  cropBottom: number;
};

type AbsolutePositionControllerProps = {
  resolution: { width: number; height: number };
  top: number;
  left: number;
  width: number;
  height: number;
  cropTop?: number;
  cropLeft?: number;
  cropRight?: number;
  cropBottom?: number;
  onChange: (pos: Position) => void;
  onCropChange: (crop: CropValues) => void;
};

type DragState =
  | { type: 'idle' }
  | {
      type: 'move';
      startX: number;
      startY: number;
      origLeft: number;
      origTop: number;
    }
  | {
      type: 'resize';
      corner: string;
      startX: number;
      startY: number;
      origPos: Position;
      aspectRatio: number;
      cropAtStart: CropValues;
    }
  | {
      type: 'crop-drag';
      edge: 'top' | 'left' | 'right' | 'bottom';
      startX: number;
      startY: number;
      origCrop: CropValues;
    };

type ControllerMode = 'position' | 'crop';

const HANDLE_SIZE = 8;
const LONG_PRESS_MS = 1500;
const LONG_PRESS_MOVE_THRESHOLD = 3;
const CROP_HANDLE_LONG = 20;
const CROP_HANDLE_SHORT = 6;
const MIN_VISIBLE = 20;
const SNAP_SCREEN_PX = 6;

const RING_R = 10;
const RING_STROKE = 2.5;
const RING_SIZE = (RING_R + RING_STROKE) * 2;
const RING_CENTER = RING_SIZE / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R;

function snapAxis(
  value: number,
  targets: number[],
  threshold: number,
): number {
  for (const t of targets) {
    if (Math.abs(value - t) <= threshold) return t;
  }
  return value;
}

export function AbsolutePositionController({
  resolution,
  top,
  left,
  width,
  height,
  cropTop: propCropTop = 0,
  cropLeft: propCropLeft = 0,
  cropRight: propCropRight = 0,
  cropBottom: propCropBottom = 0,
  onChange,
  onCropChange,
}: AbsolutePositionControllerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState>({ type: 'idle' });
  const [localPos, setLocalPos] = useState<Position | null>(null);
  const [localCrop, setLocalCrop] = useState<CropValues | null>(null);
  const localPosRef = useRef<Position | null>(null);
  const localCropRef = useRef<CropValues | null>(null);
  localPosRef.current = localPos;
  localCropRef.current = localCrop;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onCropChangeRef = useRef(onCropChange);
  onCropChangeRef.current = onCropChange;

  const [mode, setMode] = useState<ControllerMode>('position');
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const [longPressActive, setLongPressActive] = useState(false);

  useEffect(() => {
    if (localPos && dragRef.current.type === 'idle') {
      setLocalPos(null);
    }
  }, [top, left, width, height]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (localCrop && dragRef.current.type === 'idle') {
      setLocalCrop(null);
    }
  }, [propCropTop, propCropLeft, propCropRight, propCropBottom]); // eslint-disable-line react-hooks/exhaustive-deps

  const pos = localPos ?? { top, left, width, height };
  const crop = localCrop ?? {
    cropTop: propCropTop,
    cropLeft: propCropLeft,
    cropRight: propCropRight,
    cropBottom: propCropBottom,
  };
  const cropValuesRef = useRef(crop);
  cropValuesRef.current = crop;

  const containerWidth = 280;
  const scale = containerWidth / resolution.width;
  const containerHeight = Math.round(resolution.height * scale);

  const clampPos = useCallback(
    (p: Position): Position => ({
      top: Math.round(p.top),
      left: Math.round(p.left),
      width: Math.round(Math.max(20, p.width)),
      height: Math.round(Math.max(20, p.height)),
    }),
    [],
  );

  const snapPos = useCallback(
    (p: Position, c: CropValues): Position => {
      const threshold = SNAP_SCREEN_PX / scale;
      const visW = p.width - c.cropLeft - c.cropRight;
      const visH = p.height - c.cropTop - c.cropBottom;
      const visL = p.left + c.cropLeft;
      const visT = p.top + c.cropTop;
      const leftTargets = [
        0,
        Math.round((resolution.width - visW) / 2),
        resolution.width - visW,
        Math.round(-visW / 2),
        Math.round(resolution.width - visW / 2),
      ];
      const topTargets = [
        0,
        Math.round((resolution.height - visH) / 2),
        resolution.height - visH,
        Math.round(-visH / 2),
        Math.round(resolution.height - visH / 2),
      ];
      return {
        ...p,
        left: snapAxis(visL, leftTargets, threshold) - c.cropLeft,
        top: snapAxis(visT, topTargets, threshold) - c.cropTop,
      };
    },
    [resolution, scale],
  );

  const clampCrop = useCallback(
    (c: CropValues, w: number, h: number): CropValues => ({
      cropTop: Math.round(
        Math.max(0, Math.min(c.cropTop, h - c.cropBottom - MIN_VISIBLE)),
      ),
      cropLeft: Math.round(
        Math.max(0, Math.min(c.cropLeft, w - c.cropRight - MIN_VISIBLE)),
      ),
      cropRight: Math.round(
        Math.max(0, Math.min(c.cropRight, w - c.cropLeft - MIN_VISIBLE)),
      ),
      cropBottom: Math.round(
        Math.max(0, Math.min(c.cropBottom, h - c.cropTop - MIN_VISIBLE)),
      ),
    }),
    [],
  );

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
    setLongPressActive(false);
  }, []);

  const startLongPress = useCallback(
    (x: number, y: number, nextMode: ControllerMode) => {
      longPressStartRef.current = { x, y };
      setLongPressActive(true);
      longPressTimerRef.current = setTimeout(() => {
        dragRef.current = { type: 'idle' };
        longPressStartRef.current = null;
        setLongPressActive(false);
        setMode(nextMode);
      }, LONG_PRESS_MS);
    },
    [],
  );

  const handleRectMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (mode === 'position') {
        dragRef.current = {
          type: 'move',
          startX: e.clientX,
          startY: e.clientY,
          origLeft: pos.left,
          origTop: pos.top,
        };
        startLongPress(e.clientX, e.clientY, 'crop');
      } else {
        startLongPress(e.clientX, e.clientY, 'position');
      }
    },
    [mode, pos, startLongPress],
  );

  const handleCornerMouseDown = useCallback(
    (e: React.MouseEvent, corner: string) => {
      e.preventDefault();
      e.stopPropagation();
      cancelLongPress();
      const c = cropValuesRef.current;
      const visW = pos.width - c.cropLeft - c.cropRight;
      const visH = pos.height - c.cropTop - c.cropBottom;
      const aspectRatio = visW / visH;
      dragRef.current = {
        type: 'resize',
        corner,
        startX: e.clientX,
        startY: e.clientY,
        origPos: { ...pos },
        aspectRatio,
        cropAtStart: { ...c },
      };
    },
    [pos, cancelLongPress],
  );

  const handleCropEdgeMouseDown = useCallback(
    (e: React.MouseEvent, edge: 'top' | 'left' | 'right' | 'bottom') => {
      e.preventDefault();
      e.stopPropagation();
      cancelLongPress();
      dragRef.current = {
        type: 'crop-drag',
        edge,
        startX: e.clientX,
        startY: e.clientY,
        origCrop: { ...crop },
      };
    },
    [crop, cancelLongPress],
  );

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (mode !== 'crop') return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      const fullX = pos.left * scale;
      const fullY = pos.top * scale;
      const fullW = pos.width * scale;
      const fullH = pos.height * scale;

      const insideRect =
        clickX >= fullX &&
        clickX <= fullX + fullW &&
        clickY >= fullY &&
        clickY <= fullY + fullH;

      if (!insideRect) {
        setMode('position');
      }
    },
    [mode, pos, crop, scale],
  );

  useEffect(() => {
    if (mode !== 'crop') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMode('position');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (longPressStartRef.current) {
        const dx = Math.abs(e.clientX - longPressStartRef.current.x);
        const dy = Math.abs(e.clientY - longPressStartRef.current.y);
        if (dx > LONG_PRESS_MOVE_THRESHOLD || dy > LONG_PRESS_MOVE_THRESHOLD) {
          cancelLongPress();
        }
      }

      const drag = dragRef.current;
      if (drag.type === 'idle') return;

      if (drag.type === 'move') {
        const dx = (e.clientX - drag.startX) / scale;
        const dy = (e.clientY - drag.startY) / scale;
        const newPos = snapPos(
          clampPos({
            ...pos,
            left: drag.origLeft + dx,
            top: drag.origTop + dy,
          }),
          cropValuesRef.current,
        );
        setLocalPos(newPos);
      } else if (drag.type === 'resize') {
        const dx = (e.clientX - drag.startX) / scale;
        const { origPos, corner, aspectRatio, cropAtStart: c } = drag;
        const origVisW = origPos.width - c.cropLeft - c.cropRight;
        let newPos = { ...origPos };

        if (corner === 'se') {
          const newVisW = Math.max(40, origVisW + dx);
          const newVisH = newVisW / aspectRatio;
          newPos = {
            ...origPos,
            width: newVisW + c.cropLeft + c.cropRight,
            height: newVisH + c.cropTop + c.cropBottom,
          };
        } else if (corner === 'sw') {
          const newVisW = Math.max(40, origVisW - dx);
          const newVisH = newVisW / aspectRatio;
          const newAbsW = newVisW + c.cropLeft + c.cropRight;
          newPos = {
            ...origPos,
            left: origPos.left + origPos.width - newAbsW,
            width: newAbsW,
            height: newVisH + c.cropTop + c.cropBottom,
          };
        } else if (corner === 'ne') {
          const newVisW = Math.max(40, origVisW + dx);
          const newVisH = newVisW / aspectRatio;
          const newAbsH = newVisH + c.cropTop + c.cropBottom;
          newPos = {
            ...origPos,
            top: origPos.top + origPos.height - newAbsH,
            width: newVisW + c.cropLeft + c.cropRight,
            height: newAbsH,
          };
        } else if (corner === 'nw') {
          const newVisW = Math.max(40, origVisW - dx);
          const newVisH = newVisW / aspectRatio;
          const newAbsW = newVisW + c.cropLeft + c.cropRight;
          const newAbsH = newVisH + c.cropTop + c.cropBottom;
          newPos = {
            ...origPos,
            left: origPos.left + origPos.width - newAbsW,
            top: origPos.top + origPos.height - newAbsH,
            width: newAbsW,
            height: newAbsH,
          };
        }
        setLocalPos(clampPos(newPos));
      } else if (drag.type === 'crop-drag') {
        const dx = (e.clientX - drag.startX) / scale;
        const dy = (e.clientY - drag.startY) / scale;
        const { origCrop, edge } = drag;
        let newCrop = { ...origCrop };

        if (edge === 'top') newCrop.cropTop = origCrop.cropTop + dy;
        else if (edge === 'bottom')
          newCrop.cropBottom = origCrop.cropBottom - dy;
        else if (edge === 'left') newCrop.cropLeft = origCrop.cropLeft + dx;
        else if (edge === 'right')
          newCrop.cropRight = origCrop.cropRight - dx;

        setLocalCrop(clampCrop(newCrop, pos.width, pos.height));
      }
    };

    const handleMouseUp = () => {
      cancelLongPress();
      const drag = dragRef.current;
      if (drag.type !== 'idle') {
        dragRef.current = { type: 'idle' };
        if (drag.type === 'crop-drag') {
          const current = localCropRef.current;
          if (current) {
            onCropChangeRef.current(current);
          }
        } else {
          const current = localPosRef.current;
          if (current) {
            onChangeRef.current(current);
          }
        }
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [scale, clampPos, snapPos, clampCrop, pos, cancelLongPress]);

  const visWidth = Math.max(0, pos.width - crop.cropLeft - crop.cropRight);
  const visHeight = Math.max(0, pos.height - crop.cropTop - crop.cropBottom);
  const canvasRect = {
    x: pos.left * scale,
    y: pos.top * scale,
    w: pos.width * scale,
    h: pos.height * scale,
  };
  const visRect = {
    x: (pos.left + crop.cropLeft) * scale,
    y: (pos.top + crop.cropTop) * scale,
    w: visWidth * scale,
    h: visHeight * scale,
  };

  const cropCanvasTop = crop.cropTop * scale;
  const cropCanvasLeft = crop.cropLeft * scale;
  const cropCanvasRight = crop.cropRight * scale;
  const cropCanvasBottom = crop.cropBottom * scale;

  const corners = [
    { id: 'nw', x: visRect.x, y: visRect.y, cursor: 'nwse-resize' },
    {
      id: 'ne',
      x: visRect.x + visRect.w,
      y: visRect.y,
      cursor: 'nesw-resize',
    },
    {
      id: 'sw',
      x: visRect.x,
      y: visRect.y + visRect.h,
      cursor: 'nesw-resize',
    },
    {
      id: 'se',
      x: visRect.x + visRect.w,
      y: visRect.y + visRect.h,
      cursor: 'nwse-resize',
    },
  ];

  const hasCrop =
    crop.cropTop > 0 ||
    crop.cropLeft > 0 ||
    crop.cropRight > 0 ||
    crop.cropBottom > 0;

  const ringColor = mode === 'position' ? '#22c55e' : '#3b82f6';

  return (
    <div className='mb-3'>
      {/* Keyframes for the long-press ring animation */}
      {longPressActive && (
        <style>{`@keyframes lp-ring{to{stroke-dashoffset:0}}`}</style>
      )}

      <div
        ref={containerRef}
        className='relative border border-neutral-600 bg-neutral-900 mx-auto select-none'
        style={{ width: containerWidth, height: containerHeight }}
        onMouseDown={handleCanvasClick}>
        {/* Main rectangle — always shows full (uncropped) video area */}
        <div
          className={`absolute ${
            mode === 'crop'
              ? 'border-2 border-dashed border-green-500 bg-green-500/15'
              : 'bg-blue-500/30 border border-blue-400'
          }`}
          style={{
            left: canvasRect.x,
            top: canvasRect.y,
            width: canvasRect.w,
            height: canvasRect.h,
            cursor: 'move',
          }}
          onMouseDown={(e) => handleRectMouseDown(e)}>
          {/* Darkened cropped areas */}
          {hasCrop && (
            <>
              {cropCanvasTop > 0 && (
                <div
                  className='absolute left-0 right-0 top-0 bg-black/40'
                  style={{ height: cropCanvasTop }}
                />
              )}
              {cropCanvasBottom > 0 && (
                <div
                  className='absolute left-0 right-0 bottom-0 bg-black/40'
                  style={{ height: cropCanvasBottom }}
                />
              )}
              {cropCanvasLeft > 0 && (
                <div
                  className='absolute left-0 bg-black/40'
                  style={{
                    top: cropCanvasTop,
                    width: cropCanvasLeft,
                    height: canvasRect.h - cropCanvasTop - cropCanvasBottom,
                  }}
                />
              )}
              {cropCanvasRight > 0 && (
                <div
                  className='absolute right-0 bg-black/40'
                  style={{
                    top: cropCanvasTop,
                    width: cropCanvasRight,
                    height: canvasRect.h - cropCanvasTop - cropCanvasBottom,
                  }}
                />
              )}
            </>
          )}
        </div>

        {/* Crop visible area dashed border */}
        {hasCrop && (
          <div
            className={`absolute border border-dashed pointer-events-none z-10 ${
              mode === 'crop'
                ? 'border-green-300/80'
                : 'border-blue-300/80'
            }`}
            style={{
              left: canvasRect.x + cropCanvasLeft,
              top: canvasRect.y + cropCanvasTop,
              width: canvasRect.w - cropCanvasLeft - cropCanvasRight,
              height: canvasRect.h - cropCanvasTop - cropCanvasBottom,
            }}
          />
        )}

        {/* Long-press progress ring */}
        {longPressActive && (
          <svg
            className='absolute z-20 pointer-events-none'
            width={RING_SIZE}
            height={RING_SIZE}
            style={{
              left: canvasRect.x + canvasRect.w / 2 - RING_SIZE / 2,
              top: canvasRect.y + canvasRect.h / 2 - RING_SIZE / 2,
            }}>
            <circle
              cx={RING_CENTER}
              cy={RING_CENTER}
              r={RING_R}
              fill='none'
              stroke='rgba(255,255,255,0.12)'
              strokeWidth={RING_STROKE}
            />
            <circle
              cx={RING_CENTER}
              cy={RING_CENTER}
              r={RING_R}
              fill='none'
              stroke={ringColor}
              strokeWidth={RING_STROKE}
              strokeLinecap='round'
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={RING_CIRCUMFERENCE}
              style={{
                animation: `lp-ring ${LONG_PRESS_MS}ms linear forwards`,
                transformOrigin: 'center',
                transform: 'rotate(-90deg)',
              }}
            />
          </svg>
        )}

        {/* Position mode: corner resize handles */}
        {mode === 'position' &&
          corners.map((c) => (
            <div
              key={c.id}
              className='absolute bg-blue-400 border border-blue-300 z-10'
              style={{
                left: c.x - HANDLE_SIZE / 2,
                top: c.y - HANDLE_SIZE / 2,
                width: HANDLE_SIZE,
                height: HANDLE_SIZE,
                cursor: c.cursor,
              }}
              onMouseDown={(e) => handleCornerMouseDown(e, c.id)}
            />
          ))}

        {/* Crop mode: edge handles */}
        {mode === 'crop' && (
          <>
            <div
              className='absolute bg-green-500 rounded-sm z-10'
              style={{
                left:
                  canvasRect.x + canvasRect.w / 2 - CROP_HANDLE_LONG / 2,
                top: canvasRect.y + cropCanvasTop - CROP_HANDLE_SHORT / 2,
                width: CROP_HANDLE_LONG,
                height: CROP_HANDLE_SHORT,
                cursor: 'ns-resize',
              }}
              onMouseDown={(e) => handleCropEdgeMouseDown(e, 'top')}
            />
            <div
              className='absolute bg-green-500 rounded-sm z-10'
              style={{
                left:
                  canvasRect.x + canvasRect.w / 2 - CROP_HANDLE_LONG / 2,
                top:
                  canvasRect.y +
                  canvasRect.h -
                  cropCanvasBottom -
                  CROP_HANDLE_SHORT / 2,
                width: CROP_HANDLE_LONG,
                height: CROP_HANDLE_SHORT,
                cursor: 'ns-resize',
              }}
              onMouseDown={(e) => handleCropEdgeMouseDown(e, 'bottom')}
            />
            <div
              className='absolute bg-green-500 rounded-sm z-10'
              style={{
                left:
                  canvasRect.x + cropCanvasLeft - CROP_HANDLE_SHORT / 2,
                top:
                  canvasRect.y + canvasRect.h / 2 - CROP_HANDLE_LONG / 2,
                width: CROP_HANDLE_SHORT,
                height: CROP_HANDLE_LONG,
                cursor: 'ew-resize',
              }}
              onMouseDown={(e) => handleCropEdgeMouseDown(e, 'left')}
            />
            <div
              className='absolute bg-green-500 rounded-sm z-10'
              style={{
                left:
                  canvasRect.x +
                  canvasRect.w -
                  cropCanvasRight -
                  CROP_HANDLE_SHORT / 2,
                top:
                  canvasRect.y + canvasRect.h / 2 - CROP_HANDLE_LONG / 2,
                width: CROP_HANDLE_SHORT,
                height: CROP_HANDLE_LONG,
                cursor: 'ew-resize',
              }}
              onMouseDown={(e) => handleCropEdgeMouseDown(e, 'right')}
            />
          </>
        )}
      </div>

      {mode === 'crop' && (
        <div className='text-[10px] text-green-400 mt-1 text-center'>
          Crop mode — hold 1.5s / Esc / click outside to exit
        </div>
      )}
      {mode === 'position' && (
        <div className='text-[10px] text-neutral-500 mt-1 text-center'>
          Hold 1.5s on rect to enter crop mode
        </div>
      )}

      <div className='grid grid-cols-4 gap-1 mt-2'>
        {(['left', 'top', 'width', 'height'] as const).map((field) => {
          const isCropped =
            (field === 'width' &&
              (crop.cropLeft > 0 || crop.cropRight > 0)) ||
            (field === 'height' &&
              (crop.cropTop > 0 || crop.cropBottom > 0));
          const croppedValue =
            field === 'width'
              ? visWidth
              : field === 'height'
                ? visHeight
                : 0;
          return (
            <div key={field}>
              <label className='text-[10px] text-neutral-500 block'>
                {field[0].toUpperCase() + field.slice(1)}
              </label>
              <NumberInput
                className='w-full bg-neutral-800 border border-neutral-700 text-white text-xs px-1 py-0.5'
                value={Math.round(pos[field])}
                onChange={(e) => {
                  const val = Number(e.target.value) || 0;
                  const newPos = clampPos({ ...pos, [field]: val });
                  onChange(newPos);
                }}
              />
              {isCropped && (
                <span className='text-[9px] text-green-400/70'>
                  → {Math.round(croppedValue)}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className='grid grid-cols-4 gap-1 mt-2'>
        {(
          [
            ['cropTop', 'Crop T'],
            ['cropLeft', 'Crop L'],
            ['cropRight', 'Crop R'],
            ['cropBottom', 'Crop B'],
          ] as const
        ).map(([field, label]) => (
          <div key={field}>
            <label className='text-[10px] text-green-400/70 block'>
              {label}
            </label>
            <NumberInput
              min={0}
              className='w-full bg-neutral-800 border border-neutral-700 text-white text-xs px-1 py-0.5'
              value={crop[field]}
              onChange={(e) => {
                const val = Math.max(0, Number(e.target.value) || 0);
                const newCrop = clampCrop(
                  { ...crop, [field]: val },
                  pos.width,
                  pos.height,
                );
                onCropChange(newCrop);
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
