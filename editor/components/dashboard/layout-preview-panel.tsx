'use client';

import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import type { Input } from '@/lib/types';
import { useActions } from '@/components/control-panel/contexts/actions-context';
import {
  buildInputColorMap,
  type InputColorEntry,
} from '@/components/control-panel/components/timeline/timeline-utils';
import { hexToHsla } from '@/lib/color-utils';
import { defaultAbsoluteRect } from '@/lib/source-fit';

interface LayoutPreviewPanelProps {
  roomId: string;
  inputs: Input[];
  resolution: { width: number; height: number };
  timelineColorOverrides?: Record<string, string>;
  selectedInputId?: string | null;
  onSelectInput?: (id: string) => void;
}

const EASING_MAP: Record<string, string> = {
  linear: 'linear',
  bounce: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  cubic_bezier_ease_in_out: 'ease-in-out',
};

const HANDLE_SIZE = 7;
const SNAP_SCREEN_PX = 5;
const MIN_RECT_PX = 20;
const LONG_PRESS_MS = 1500;
const LONG_PRESS_MOVE_THRESHOLD = 3;

const LP_RING_R = 10;
const LP_RING_STROKE = 2.5;
const LP_RING_SIZE = (LP_RING_R + LP_RING_STROKE) * 2;
const LP_RING_CENTER = LP_RING_SIZE / 2;
const LP_RING_CIRCUMFERENCE = 2 * Math.PI * LP_RING_R;

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
  aspectRatio: number;
  origCropTop: number;
  origCropLeft: number;
  origCropRight: number;
  origCropBottom: number;
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
  timelineColorOverrides,
  selectedInputId,
  onSelectInput,
}: LayoutPreviewPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const dragRef = useRef<DragState | null>(null);
  const [dragInputId, setDragInputId] = useState<string | null>(null);
  const [override, setOverride] = useState<RectOverride | null>(null);
  const overrideRef = useRef<RectOverride | null>(null);
  overrideRef.current = override;

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const longPressInputRef = useRef<Input | null>(null);
  const [longPressActive, setLongPressActive] = useState(false);
  const [longPressInputId, setLongPressInputId] = useState<string | null>(null);
  const [forceGrabbedId, setForceGrabbedId] = useState<string | null>(null);

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

  const inputColorMap = useMemo(() => {
    const base = buildInputColorMap(inputs);
    if (!timelineColorOverrides) return base;
    const merged = new Map<string, InputColorEntry>(base);
    for (const [inputId, hex] of Object.entries(timelineColorOverrides)) {
      merged.set(inputId, {
        dot: hex,
        segBg: hexToHsla(hex, 0.18),
        segBorder: hexToHsla(hex, 0.35),
        ring: hexToHsla(hex, 0.7),
      });
    }
    return merged;
  }, [inputs, timelineColorOverrides]);

  const snapPos = useCallback(
    (
      top: number,
      left: number,
      width: number,
      height: number,
      cT: number,
      cL: number,
      cR: number,
      cB: number,
    ): { top: number; left: number } => {
      if (scale === 0) return { top, left };
      const threshold = SNAP_SCREEN_PX / scale;
      const visW = width - cL - cR;
      const visH = height - cT - cB;
      const visL = left + cL;
      const visT = top + cT;
      const leftTargets = [
        0,
        Math.round((resolution.width - visW) / 2),
        resolution.width - visW,
      ];
      const topTargets = [
        0,
        Math.round((resolution.height - visH) / 2),
        resolution.height - visH,
      ];
      const snappedVisL = snapAxis(visL, leftTargets, threshold);
      const snappedVisT = snapAxis(visT, topTargets, threshold);
      return {
        left: snappedVisL - cL,
        top: snappedVisT - cT,
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

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
    longPressInputRef.current = null;
    setLongPressActive(false);
    setLongPressInputId(null);
  }, []);

  const handleHiddenMouseDown = useCallback(
    (e: React.MouseEvent, input: Input) => {
      e.preventDefault();
      e.stopPropagation();
      onSelectInput?.(input.inputId);

      longPressStartRef.current = { x: e.clientX, y: e.clientY };
      longPressInputRef.current = input;
      setLongPressActive(true);
      setLongPressInputId(input.inputId);

      longPressTimerRef.current = setTimeout(() => {
        const start = longPressStartRef.current;
        const inp = longPressInputRef.current;
        if (!start || !inp) return;

        const absTop = inp.absoluteTop ?? 0;
        const absLeft = inp.absoluteLeft ?? 0;
        const def = defaultAbsoluteRect(inp, resolution);
        const absW = inp.absoluteWidth ?? def.width;
        const absH = inp.absoluteHeight ?? def.height;
        const cT = inp.cropTop ?? 0;
        const cL = inp.cropLeft ?? 0;
        const cR = inp.cropRight ?? 0;
        const cB = inp.cropBottom ?? 0;
        const visW = absW - cL - cR;
        const visH = absH - cT - cB;

        setForceGrabbedId(inp.inputId);
        setLongPressActive(false);
        setLongPressInputId(null);
        longPressStartRef.current = null;
        longPressInputRef.current = null;

        dragRef.current = {
          inputId: inp.inputId,
          dragType: 'move',
          startX: start.x,
          startY: start.y,
          origTop: absTop,
          origLeft: absLeft,
          origWidth: absW,
          origHeight: absH,
          aspectRatio: visW / visH,
          origCropTop: cT,
          origCropLeft: cL,
          origCropRight: cR,
          origCropBottom: cB,
        };
        setDragInputId(inp.inputId);
        setOverride({ top: absTop, left: absLeft, width: absW, height: absH });
      }, LONG_PRESS_MS);
    },
    [resolution, onSelectInput],
  );

  const handleRectMouseDown = useCallback(
    (e: React.MouseEvent, input: Input) => {
      e.preventDefault();
      e.stopPropagation();
      onSelectInput?.(input.inputId);
      const absTop = input.absoluteTop ?? 0;
      const absLeft = input.absoluteLeft ?? 0;
      const def = defaultAbsoluteRect(input, resolution);
      const absW = input.absoluteWidth ?? def.width;
      const absH = input.absoluteHeight ?? def.height;
      const cT = input.cropTop ?? 0;
      const cL = input.cropLeft ?? 0;
      const cR = input.cropRight ?? 0;
      const cB = input.cropBottom ?? 0;
      const visW = absW - cL - cR;
      const visH = absH - cT - cB;
      dragRef.current = {
        inputId: input.inputId,
        dragType: 'move',
        startX: e.clientX,
        startY: e.clientY,
        origTop: absTop,
        origLeft: absLeft,
        origWidth: absW,
        origHeight: absH,
        aspectRatio: visW / visH,
        origCropTop: cT,
        origCropLeft: cL,
        origCropRight: cR,
        origCropBottom: cB,
      };
      setDragInputId(input.inputId);
      setOverride({ top: absTop, left: absLeft, width: absW, height: absH });

      if (scale > 0 && containerRef.current) {
        const cr = containerRef.current.getBoundingClientRect();
        const cx = (e.clientX - cr.left) / scale;
        const cy = (e.clientY - cr.top) / scale;

        const underneath = inputs.find((inp) => {
          if (inp.inputId === input.inputId) return false;
          const t = inp.absoluteTop ?? 0;
          const l = inp.absoluteLeft ?? 0;
          const d = defaultAbsoluteRect(inp, resolution);
          const w = inp.absoluteWidth ?? d.width;
          const h = inp.absoluteHeight ?? d.height;
          return cx >= l && cx <= l + w && cy >= t && cy <= t + h;
        });

        if (underneath) {
          longPressStartRef.current = { x: e.clientX, y: e.clientY };
          longPressInputRef.current = underneath;
          setLongPressActive(true);
          setLongPressInputId(input.inputId);

          longPressTimerRef.current = setTimeout(() => {
            const nextInput = longPressInputRef.current;
            const lps = longPressStartRef.current;
            if (!nextInput || !lps) return;

            const nTop = nextInput.absoluteTop ?? 0;
            const nLeft = nextInput.absoluteLeft ?? 0;
            const nd = defaultAbsoluteRect(nextInput, resolution);
            const nW = nextInput.absoluteWidth ?? nd.width;
            const nH = nextInput.absoluteHeight ?? nd.height;
            const nCT = nextInput.cropTop ?? 0;
            const nCL = nextInput.cropLeft ?? 0;
            const nCR = nextInput.cropRight ?? 0;
            const nCB = nextInput.cropBottom ?? 0;
            const nVisW = nW - nCL - nCR;
            const nVisH = nH - nCT - nCB;

            if (nextInput.hidden) setForceGrabbedId(nextInput.inputId);

            cancelLongPress();
            onSelectInput?.(nextInput.inputId);

            dragRef.current = {
              inputId: nextInput.inputId,
              dragType: 'move',
              startX: lps.x,
              startY: lps.y,
              origTop: nTop,
              origLeft: nLeft,
              origWidth: nW,
              origHeight: nH,
              aspectRatio: nVisW / nVisH,
              origCropTop: nCT,
              origCropLeft: nCL,
              origCropRight: nCR,
              origCropBottom: nCB,
            };
            setDragInputId(nextInput.inputId);
            setOverride({ top: nTop, left: nLeft, width: nW, height: nH });
          }, LONG_PRESS_MS);
        }
      }
    },
    [resolution, onSelectInput, scale, inputs, cancelLongPress],
  );

  const handleCornerMouseDown = useCallback(
    (e: React.MouseEvent, input: Input, corner: string) => {
      e.preventDefault();
      e.stopPropagation();
      onSelectInput?.(input.inputId);
      const absTop = input.absoluteTop ?? 0;
      const absLeft = input.absoluteLeft ?? 0;
      const def = defaultAbsoluteRect(input, resolution);
      const absW = input.absoluteWidth ?? def.width;
      const absH = input.absoluteHeight ?? def.height;
      const cT = input.cropTop ?? 0;
      const cL = input.cropLeft ?? 0;
      const cR = input.cropRight ?? 0;
      const cB = input.cropBottom ?? 0;
      const visW = absW - cL - cR;
      const visH = absH - cT - cB;
      dragRef.current = {
        inputId: input.inputId,
        dragType: `resize-${corner}` as DragType,
        startX: e.clientX,
        startY: e.clientY,
        origTop: absTop,
        origLeft: absLeft,
        origWidth: absW,
        origHeight: absH,
        aspectRatio: visW / visH,
        origCropTop: cT,
        origCropLeft: cL,
        origCropRight: cR,
        origCropBottom: cB,
      };
      setDragInputId(input.inputId);
      setOverride({ top: absTop, left: absLeft, width: absW, height: absH });
    },
    [resolution, onSelectInput],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (longPressStartRef.current) {
        const lpDx = Math.abs(e.clientX - longPressStartRef.current.x);
        const lpDy = Math.abs(e.clientY - longPressStartRef.current.y);
        if (lpDx > LONG_PRESS_MOVE_THRESHOLD || lpDy > LONG_PRESS_MOVE_THRESHOLD) {
          cancelLongPress();
        }
      }

      const drag = dragRef.current;
      if (!drag || scale === 0) return;

      const dx = (e.clientX - drag.startX) / scale;
      const dy = (e.clientY - drag.startY) / scale;

      let newTop = drag.origTop;
      let newLeft = drag.origLeft;
      let newWidth = drag.origWidth;
      let newHeight = drag.origHeight;

      const { origCropTop: cT, origCropLeft: cL, origCropRight: cR, origCropBottom: cB } = drag;

      if (drag.dragType === 'move') {
        newLeft = drag.origLeft + dx;
        newTop = drag.origTop + dy;
        const snapped = snapPos(newTop, newLeft, newWidth, newHeight, cT, cL, cR, cB);
        newTop = snapped.top;
        newLeft = snapped.left;
      } else if (drag.dragType === 'resize-se') {
        const origVisW = drag.origWidth - cL - cR;
        const newVisW = Math.max(MIN_RECT_PX, origVisW + dx);
        const newVisH = newVisW / drag.aspectRatio;
        newWidth = newVisW + cL + cR;
        newHeight = newVisH + cT + cB;
      } else if (drag.dragType === 'resize-sw') {
        const origVisW = drag.origWidth - cL - cR;
        const newVisW = Math.max(MIN_RECT_PX, origVisW - dx);
        const newVisH = newVisW / drag.aspectRatio;
        newWidth = newVisW + cL + cR;
        newHeight = newVisH + cT + cB;
        newLeft = drag.origLeft + drag.origWidth - newWidth;
      } else if (drag.dragType === 'resize-ne') {
        const origVisW = drag.origWidth - cL - cR;
        const newVisW = Math.max(MIN_RECT_PX, origVisW + dx);
        const newVisH = newVisW / drag.aspectRatio;
        newWidth = newVisW + cL + cR;
        newHeight = newVisH + cT + cB;
        newTop = drag.origTop + drag.origHeight - newHeight;
      } else if (drag.dragType === 'resize-nw') {
        const origVisW = drag.origWidth - cL - cR;
        const newVisW = Math.max(MIN_RECT_PX, origVisW - dx);
        const newVisH = newVisW / drag.aspectRatio;
        newWidth = newVisW + cL + cR;
        newHeight = newVisH + cT + cB;
        newLeft = drag.origLeft + drag.origWidth - newWidth;
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
      cancelLongPress();
      const drag = dragRef.current;
      if (!drag) {
        setForceGrabbedId(null);
        return;
      }
      dragRef.current = null;
      const final = overrideRef.current;
      if (final) {
        commitPosition(drag.inputId, final);
      }
      setDragInputId(null);
      setOverride(null);
      setForceGrabbedId(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [scale, snapPos, commitPosition, cancelLongPress]);

  const getInputRect = useCallback(
    (input: Input) => {
      if (dragInputId === input.inputId && override) {
        return override;
      }
      const def = defaultAbsoluteRect(input, resolution);
      return {
        top: input.absoluteTop ?? 0,
        left: input.absoluteLeft ?? 0,
        width: input.absoluteWidth ?? def.width,
        height: input.absoluteHeight ?? def.height,
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
          {longPressActive && (
            <style>{`@keyframes lp-map-ring{to{stroke-dashoffset:0}}`}</style>
          )}

          {scale > 0 &&
            inputs.map((input, index) => {
              const colors = inputColorMap.get(input.inputId);
              const rect = getInputRect(input);
              const isDragging = dragInputId === input.inputId;
              const iCT = input.cropTop ?? 0;
              const iCL = input.cropLeft ?? 0;
              const iCR = input.cropRight ?? 0;
              const iCB = input.cropBottom ?? 0;
              const top = (rect.top + iCT) * scale;
              const left = (rect.left + iCL) * scale;
              const width = Math.max(0, rect.width - iCL - iCR) * scale;
              const height = Math.max(0, rect.height - iCT - iCB) * scale;
              const isHidden = !!input.hidden;
              const isForceGrabbed = forceGrabbedId === input.inputId;
              const isLongPressing = longPressActive && longPressInputId === input.inputId;
              const effectivelyHidden = isHidden && !isForceGrabbed;
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

              const handleMouseDown = isHidden && !isForceGrabbed
                ? (e: React.MouseEvent) => handleHiddenMouseDown(e, input)
                : (e: React.MouseEvent) => handleRectMouseDown(e, input);

              return (
                <div
                  key={input.inputId}
                  className='absolute overflow-visible'
                  style={{
                    top,
                    left,
                    width,
                    height,
                    zIndex: isDragging ? 1000 : selectedInputId === input.inputId ? 500 : index,
                    transition: durationMs > 0
                      ? `top ${durationMs}ms ${easing}, left ${durationMs}ms ${easing}, width ${durationMs}ms ${easing}, height ${durationMs}ms ${easing}, opacity ${durationMs}ms ${easing}`
                      : 'none',
                  }}>
                  <div
                    className='absolute inset-0 flex items-end'
                    style={{
                      backgroundColor: colors?.segBorder,
                      border: isDragging
                        ? `2px solid ${colors?.dot ?? '#737373'}`
                        : `1px solid ${colors?.dot ?? '#737373'}`,
                      borderStyle: effectivelyHidden ? 'dashed' : 'solid',
                      opacity: effectivelyHidden ? (isLongPressing ? 0.4 : 0.15) : 1,
                      cursor: effectivelyHidden ? 'default' : 'grab',
                    }}
                    onMouseDown={handleMouseDown}>
                    <span
                      className='block w-full truncate px-0.5 text-white font-mono leading-tight pointer-events-none'
                      style={{
                        fontSize: Math.max(8, Math.min(11, width * 0.08)),
                        backgroundColor: colors?.ring,
                      }}>
                      {input.title || input.inputId}
                    </span>
                  </div>

                  {isLongPressing && (
                    <svg
                      className='absolute z-20 pointer-events-none'
                      width={LP_RING_SIZE}
                      height={LP_RING_SIZE}
                      style={{
                        left: width / 2 - LP_RING_SIZE / 2,
                        top: height / 2 - LP_RING_SIZE / 2,
                      }}>
                      <circle
                        cx={LP_RING_CENTER}
                        cy={LP_RING_CENTER}
                        r={LP_RING_R}
                        fill='none'
                        stroke='rgba(255,255,255,0.12)'
                        strokeWidth={LP_RING_STROKE}
                      />
                      <circle
                        cx={LP_RING_CENTER}
                        cy={LP_RING_CENTER}
                        r={LP_RING_R}
                        fill='none'
                        stroke={colors?.dot ?? '#737373'}
                        strokeWidth={LP_RING_STROKE}
                        strokeLinecap='round'
                        strokeDasharray={LP_RING_CIRCUMFERENCE}
                        strokeDashoffset={LP_RING_CIRCUMFERENCE}
                        style={{
                          animation: `lp-map-ring ${LONG_PRESS_MS}ms linear forwards`,
                          transformOrigin: 'center',
                          transform: 'rotate(-90deg)',
                        }}
                      />
                    </svg>
                  )}

                  {!isHidden &&
                    corners.map((c) => (
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
                          opacity: 0.8,
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
