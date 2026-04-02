'use client';

import { useCallback, useRef, useMemo } from 'react';
import type { Clip, Keyframe } from '../../hooks/use-timeline-state';
import type { TimelineKeyframeInterpolationMode } from '@smelter-editor/types';
import { AUTOMATION_LANE_HEIGHT } from './timeline-utils';

const POINT_RADIUS = 5;
const PADDING_Y = 6;
const EFFECTIVE_HEIGHT = AUTOMATION_LANE_HEIGHT - PADDING_Y * 2;

type VolumeAutomationLaneProps = {
  trackId: string;
  clips: Clip[];
  pixelsPerSecond: number;
  interpolationMode: TimelineKeyframeInterpolationMode;
  timelineWidthPx: number;
  selectedKeyframeId: string | null;
  onAddKeyframe: (
    trackId: string,
    clipId: string,
    timeMs: number,
    volume: number,
  ) => void;
  onUpdateKeyframeVolume: (
    trackId: string,
    clipId: string,
    keyframeId: string,
    volume: number,
  ) => void;
  onMoveKeyframe: (
    trackId: string,
    clipId: string,
    keyframeId: string,
    timeMs: number,
  ) => void;
  onDeleteKeyframe: (
    trackId: string,
    clipId: string,
    keyframeId: string,
  ) => void;
  onSelectKeyframe: (
    trackId: string,
    clipId: string,
    keyframeId: string,
  ) => void;
};

function volumeToY(volume: number): number {
  return PADDING_Y + (1 - Math.max(0, Math.min(1, volume))) * EFFECTIVE_HEIGHT;
}

function yToVolume(y: number): number {
  const clamped = Math.max(
    PADDING_Y,
    Math.min(PADDING_Y + EFFECTIVE_HEIGHT, y),
  );
  return Math.round((1 - (clamped - PADDING_Y) / EFFECTIVE_HEIGHT) * 100) / 100;
}

type PointInfo = {
  xPx: number;
  volume: number;
  keyframeId: string;
  clipId: string;
  timeMs: number;
  isBase: boolean;
};

function getEffectiveInterpolation(
  keyframe: Keyframe,
  globalMode: TimelineKeyframeInterpolationMode,
): TimelineKeyframeInterpolationMode {
  return keyframe.blockSettings.forceInterpolation ?? globalMode;
}

export function VolumeAutomationLane({
  trackId,
  clips,
  pixelsPerSecond,
  interpolationMode,
  timelineWidthPx,
  selectedKeyframeId,
  onAddKeyframe,
  onUpdateKeyframeVolume,
  onMoveKeyframe,
  onDeleteKeyframe,
  onSelectKeyframe,
}: VolumeAutomationLaneProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{
    pointInfo: PointInfo;
    originX: number;
    originY: number;
    startTimeMs: number;
    startVolume: number;
    moved: boolean;
  } | null>(null);

  const points = useMemo(() => {
    const result: PointInfo[] = [];
    for (const clip of clips) {
      const sorted = [...clip.keyframes].sort((a, b) => a.timeMs - b.timeMs);
      for (const kf of sorted) {
        const xPx = ((clip.startMs + kf.timeMs) / 1000) * pixelsPerSecond;
        result.push({
          xPx,
          volume: kf.blockSettings.volume ?? 1,
          keyframeId: kf.id,
          clipId: clip.id,
          timeMs: kf.timeMs,
          isBase: kf.timeMs === 0,
        });
      }
    }
    return result;
  }, [clips, pixelsPerSecond]);

  const clipPaths = useMemo(() => {
    const paths: { pathD: string; areaD: string; clipId: string }[] = [];

    for (const clip of clips) {
      const sorted = [...clip.keyframes].sort((a, b) => a.timeMs - b.timeMs);
      if (sorted.length === 0) continue;

      const clipEndPx = (clip.endMs / 1000) * pixelsPerSecond;
      const clipBottomY = PADDING_Y + EFFECTIVE_HEIGHT;

      const lineSegments: string[] = [];
      const areaSegments: string[] = [];

      for (let i = 0; i < sorted.length; i++) {
        const kf = sorted[i];
        const x = ((clip.startMs + kf.timeMs) / 1000) * pixelsPerSecond;
        const y = volumeToY(kf.blockSettings.volume ?? 1);

        if (i === 0) {
          lineSegments.push(`M ${x} ${y}`);
          areaSegments.push(`M ${x} ${clipBottomY} L ${x} ${y}`);
        } else {
          const effectiveMode = getEffectiveInterpolation(
            kf,
            interpolationMode,
          );
          if (effectiveMode === 'step') {
            const prevY = volumeToY(sorted[i - 1].blockSettings.volume ?? 1);
            lineSegments.push(`L ${x} ${prevY}`);
            lineSegments.push(`L ${x} ${y}`);
            areaSegments.push(`L ${x} ${prevY}`);
            areaSegments.push(`L ${x} ${y}`);
          } else {
            lineSegments.push(`L ${x} ${y}`);
            areaSegments.push(`L ${x} ${y}`);
          }
        }

        if (i === sorted.length - 1 && x < clipEndPx) {
          lineSegments.push(`L ${clipEndPx} ${y}`);
          areaSegments.push(`L ${clipEndPx} ${y}`);
        }
      }

      areaSegments.push(`L ${clipEndPx} ${clipBottomY} Z`);

      paths.push({
        pathD: lineSegments.join(' '),
        areaD: areaSegments.join(' '),
        clipId: clip.id,
      });
    }
    return paths;
  }, [clips, pixelsPerSecond, interpolationMode]);

  const getSvgPoint = useCallback((e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const handlePointPointerDown = useCallback(
    (e: React.PointerEvent, point: PointInfo) => {
      e.preventDefault();
      e.stopPropagation();
      onSelectKeyframe(trackId, point.clipId, point.keyframeId);
      dragRef.current = {
        pointInfo: point,
        originX: e.clientX,
        originY: e.clientY,
        startTimeMs: point.timeMs,
        startVolume: point.volume,
        moved: false,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [trackId, onSelectKeyframe],
  );

  const handlePointPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      const deltaX = e.clientX - drag.originX;
      const deltaY = e.clientY - drag.originY;
      if (!drag.moved && Math.abs(deltaX) < 3 && Math.abs(deltaY) < 3) return;
      drag.moved = true;

      const svgPt = getSvgPoint(e);
      if (!svgPt) return;

      const newVolume = yToVolume(svgPt.y);
      if (Math.abs(newVolume - drag.pointInfo.volume) > 0.001) {
        onUpdateKeyframeVolume(
          trackId,
          drag.pointInfo.clipId,
          drag.pointInfo.keyframeId,
          newVolume,
        );
        drag.pointInfo = { ...drag.pointInfo, volume: newVolume };
      }

      if (!drag.pointInfo.isBase) {
        const deltaMs = (deltaX / pixelsPerSecond) * 1000;
        const newTimeMs = Math.max(1, Math.round(drag.startTimeMs + deltaMs));
        if (newTimeMs !== drag.pointInfo.timeMs) {
          onMoveKeyframe(
            trackId,
            drag.pointInfo.clipId,
            drag.pointInfo.keyframeId,
            newTimeMs,
          );
          drag.pointInfo = { ...drag.pointInfo, timeMs: newTimeMs };
        }
      }
    },
    [
      trackId,
      pixelsPerSecond,
      getSvgPoint,
      onUpdateKeyframeVolume,
      onMoveKeyframe,
    ],
  );

  const handlePointPointerUp = useCallback((e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    dragRef.current = null;
  }, []);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const svgPt = getSvgPoint(e);
      if (!svgPt) return;

      const clickTimeMs = (svgPt.x / pixelsPerSecond) * 1000;
      const volume = yToVolume(svgPt.y);

      let targetClip: Clip | null = null;
      for (const clip of clips) {
        if (clickTimeMs >= clip.startMs && clickTimeMs <= clip.endMs) {
          targetClip = clip;
          break;
        }
      }
      if (!targetClip) return;

      const relativeTimeMs = Math.max(
        0,
        Math.round(clickTimeMs - targetClip.startMs),
      );
      onAddKeyframe(trackId, targetClip.id, relativeTimeMs, volume);
    },
    [trackId, clips, pixelsPerSecond, getSvgPoint, onAddKeyframe],
  );

  const handlePointContextMenu = useCallback(
    (e: React.MouseEvent, point: PointInfo) => {
      e.preventDefault();
      e.stopPropagation();
      if (!point.isBase) {
        onDeleteKeyframe(trackId, point.clipId, point.keyframeId);
      }
    },
    [trackId, onDeleteKeyframe],
  );

  return (
    <svg
      ref={svgRef}
      width={timelineWidthPx}
      height={AUTOMATION_LANE_HEIGHT}
      className='absolute top-0 left-0'
      style={{ overflow: 'visible' }}
      onDoubleClick={handleDoubleClick}>
      {/* Horizontal guides */}
      <line
        x1={0}
        y1={PADDING_Y}
        x2={timelineWidthPx}
        y2={PADDING_Y}
        stroke='rgba(255,255,255,0.06)'
        strokeWidth={0.5}
      />
      <line
        x1={0}
        y1={PADDING_Y + EFFECTIVE_HEIGHT / 2}
        x2={timelineWidthPx}
        y2={PADDING_Y + EFFECTIVE_HEIGHT / 2}
        stroke='rgba(255,255,255,0.06)'
        strokeWidth={0.5}
      />
      <line
        x1={0}
        y1={PADDING_Y + EFFECTIVE_HEIGHT}
        x2={timelineWidthPx}
        y2={PADDING_Y + EFFECTIVE_HEIGHT}
        stroke='rgba(255,255,255,0.06)'
        strokeWidth={0.5}
      />

      {/* Clip boundaries */}
      {clips.map((clip) => {
        const leftPx = (clip.startMs / 1000) * pixelsPerSecond;
        const widthPx = ((clip.endMs - clip.startMs) / 1000) * pixelsPerSecond;
        return (
          <rect
            key={`bg-${clip.id}`}
            x={leftPx}
            y={0}
            width={widthPx}
            height={AUTOMATION_LANE_HEIGHT}
            fill='rgba(255,255,255,0.02)'
            stroke='rgba(255,255,255,0.06)'
            strokeWidth={0.5}
          />
        );
      })}

      {/* Area fills */}
      {clipPaths.map(({ areaD, clipId }) => (
        <path
          key={`area-${clipId}`}
          d={areaD}
          fill='rgba(0, 243, 255, 0.1)'
          strokeWidth={0}
        />
      ))}

      {/* Lines */}
      {clipPaths.map(({ pathD, clipId }) => (
        <path
          key={`line-${clipId}`}
          d={pathD}
          fill='none'
          stroke='rgba(0, 243, 255, 0.7)'
          strokeWidth={1.5}
        />
      ))}

      {/* Control points */}
      {points.map((pt) => {
        const y = volumeToY(pt.volume);
        const isSelected = selectedKeyframeId === pt.keyframeId;
        return (
          <circle
            key={`${pt.clipId}:${pt.keyframeId}`}
            cx={pt.xPx}
            cy={y}
            r={isSelected ? POINT_RADIUS + 1 : POINT_RADIUS}
            fill={isSelected ? '#f87171' : '#00f3ff'}
            stroke={isSelected ? '#f87171' : '#000'}
            strokeWidth={1}
            style={{
              cursor: pt.isBase ? 'ns-resize' : 'move',
              filter: isSelected
                ? 'drop-shadow(0 0 4px rgba(248,113,113,0.6))'
                : 'drop-shadow(0 0 3px rgba(0,243,255,0.4))',
            }}
            onPointerDown={(e) => handlePointPointerDown(e, pt)}
            onPointerMove={handlePointPointerMove}
            onPointerUp={handlePointPointerUp}
            onContextMenu={(e) => handlePointContextMenu(e, pt)}
          />
        );
      })}
    </svg>
  );
}
