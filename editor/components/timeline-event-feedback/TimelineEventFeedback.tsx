'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { Play, Square, Diamond, Move, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FxCanvas, FX_PRESET_MINI, extractHue } from '@/lib/fx';
import {
  useTimelineEventsEnabledSetting,
  useTimelineEventsPositionSetting,
  useTimelineEventsSizeSetting,
  useTimelineEventsDurationSetting,
} from '@/lib/timeline-event-settings';
import {
  TIMELINE_EVENT_NOTIFICATION,
  type TimelineEventNotification,
  type TimelineEventType,
} from '@/lib/timeline-event-notifications';
import type { FeedbackPosition, FeedbackSize } from '@/lib/voice/macroSettings';

const POSITION_CLASSES: Record<FeedbackPosition, string> = {
  'top-left': 'top-8 left-8',
  'top-center': 'top-8 left-1/2 -translate-x-1/2',
  'top-right': 'top-8 right-8',
  'center-left': 'top-1/2 left-8 -translate-y-1/2',
  center: 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
  'center-right': 'top-1/2 right-8 -translate-y-1/2',
  'bottom-left': 'bottom-8 left-8',
  'bottom-center': 'bottom-8 left-1/2 -translate-x-1/2',
  'bottom-right': 'bottom-8 right-8',
};

const SIZE_CLASSES: Record<FeedbackSize, string> = {
  s: 'min-w-[260px] max-w-[360px]',
  m: 'min-w-[320px] max-w-[440px]',
  l: 'min-w-[380px] max-w-[520px]',
};

const EVENT_ICONS: Record<TimelineEventType, LucideIcon> = {
  'block-enter': Play,
  'block-exit': Square,
  keyframe: Diamond,
  'position-change': Move,
};

const EVENT_LABELS: Record<TimelineEventType, string> = {
  'block-enter': 'Block Started',
  'block-exit': 'Block Ended',
  keyframe: 'Keyframe',
  'position-change': 'Position Changed',
};

// ── Toast Card ───────────────────────────────────────────────────────

type QueuedEvent = TimelineEventNotification & {
  id: number;
  phase: 'enter' | 'visible' | 'exit';
};

function TimelineEventCard({
  item,
  size,
  position,
}: {
  item: QueuedEvent;
  size: FeedbackSize;
  position: FeedbackPosition;
}) {
  const { type, inputLabel, color, detail, phase } = item;
  const IconComponent = EVENT_ICONS[type];
  const isTop = position.startsWith('top');
  const hues = useMemo(() => [extractHue(color)], [color]);

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl backdrop-blur-sm shadow-2xl transition-all duration-[400ms] ease-out',
        SIZE_CLASSES[size],
        phase === 'enter' && 'opacity-0 scale-95',
        phase === 'enter' && (isTop ? '-translate-y-2' : 'translate-y-2'),
        phase === 'visible' && 'opacity-100 scale-100 translate-y-0',
        phase === 'exit' && 'opacity-0 scale-95 translate-y-1',
      )}
      style={{
        border: `1px solid ${color}33`,
        background: `linear-gradient(135deg, ${color}12 0%, rgba(10,10,10,0.95) 100%)`,
      }}>
      <FxCanvas
        config={FX_PRESET_MINI}
        isActive={phase === 'enter' || phase === 'visible'}
        hues={hues}
      />

      <div
        className='pointer-events-none absolute inset-0 opacity-40 tl-event-scanline'
        style={{
          background: `linear-gradient(180deg, transparent, ${color}15, transparent)`,
        }}
      />

      <div
        className='pointer-events-none absolute -inset-x-8 top-0 h-px tl-event-sweep'
        style={{
          background: `linear-gradient(to right, transparent, ${color}aa, transparent)`,
        }}
      />

      <div className='relative flex items-center gap-3 px-4 py-3'>
        <div
          className='absolute left-0 top-2 bottom-2 w-1 rounded-r-full'
          style={{ background: color }}
        />

        <div
          className='flex items-center justify-center w-8 h-8 rounded-lg shrink-0'
          style={{ background: `${color}22` }}>
          <IconComponent className='w-4 h-4' style={{ color }} />
        </div>

        <div className='min-w-0 flex-1'>
          <p className='text-sm font-medium text-white truncate'>
            {inputLabel}
          </p>
          <p className='text-xs text-neutral-400'>
            {detail || EVENT_LABELS[type]}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────

let idCounter = 0;

export function TimelineEventFeedback() {
  const [items, setItems] = useState<QueuedEvent[]>([]);
  const [enabled] = useTimelineEventsEnabledSetting();
  const [position] = useTimelineEventsPositionSetting();
  const [size] = useTimelineEventsSizeSetting();
  const [durationSec] = useTimelineEventsDurationSetting();
  const durationRef = useRef(durationSec * 1000);

  useEffect(() => {
    durationRef.current = durationSec * 1000;
  }, [durationSec]);

  useEffect(() => {
    const handler = (e: CustomEvent<TimelineEventNotification>) => {
      const item: QueuedEvent = {
        ...e.detail,
        id: ++idCounter,
        phase: 'enter',
      };
      setItems((prev) => {
        const next = [...prev, item];
        return next.slice(-5);
      });

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setItems((prev) =>
            prev.map((i) =>
              i.id === item.id ? { ...i, phase: 'visible' } : i,
            ),
          );
        });
      });

      setTimeout(() => {
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, phase: 'exit' } : i)),
        );
        setTimeout(() => {
          setItems((prev) => prev.filter((i) => i.id !== item.id));
        }, 400);
      }, durationRef.current);
    };

    window.addEventListener(
      TIMELINE_EVENT_NOTIFICATION,
      handler as EventListener,
    );
    return () =>
      window.removeEventListener(
        TIMELINE_EVENT_NOTIFICATION,
        handler as EventListener,
      );
  }, []);

  if (!enabled || items.length === 0) return null;

  const isBottom = position.startsWith('bottom');

  return (
    <div
      className={cn(
        'fixed z-[9998] pointer-events-none',
        POSITION_CLASSES[position],
      )}>
      <div
        className={cn(
          'flex gap-2 pointer-events-auto',
          isBottom ? 'flex-col-reverse' : 'flex-col',
        )}>
        {items.map((item) => (
          <TimelineEventCard
            key={item.id}
            item={item}
            size={size}
            position={position}
          />
        ))}
      </div>

      <style jsx>{`
        .tl-event-scanline {
          animation: tlEventScanline 3s linear infinite;
        }
        .tl-event-sweep {
          animation: tlEventSweep 2.4s ease-in-out infinite;
        }
        @keyframes tlEventScanline {
          0% {
            transform: translateY(-110%);
          }
          100% {
            transform: translateY(110%);
          }
        }
        @keyframes tlEventSweep {
          0%,
          100% {
            transform: translateX(-14%);
            opacity: 0.2;
          }
          50% {
            transform: translateX(14%);
            opacity: 0.8;
          }
        }
      `}</style>
    </div>
  );
}
