'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ACTION_FEEDBACK_EVENT,
  type ActionFeedbackDetail,
} from '@/lib/voice/feedbackEvents';
import {
  useFeedbackPositionSetting,
  useFeedbackEnabledSetting,
  useFeedbackSizeSetting,
  useFeedbackDurationSetting,
  type FeedbackPosition,
  type FeedbackSize,
} from '@/lib/voice/macroSettings';
import { cn } from '@/lib/utils';

type QueuedFeedback = ActionFeedbackDetail & { id: number };

const FADE_DURATION = 400;

let feedbackIdCounter = 0;

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

const ENTER_CLASSES: Record<FeedbackPosition, string> = {
  'top-left': 'opacity-0 -translate-y-4 scale-95',
  'top-center': 'opacity-0 -translate-y-4 scale-95',
  'top-right': 'opacity-0 -translate-y-4 scale-95',
  'center-left': 'opacity-0 -translate-x-4 scale-95',
  center: 'opacity-0 scale-90',
  'center-right': 'opacity-0 translate-x-4 scale-95',
  'bottom-left': 'opacity-0 translate-y-4 scale-95',
  'bottom-center': 'opacity-0 translate-y-4 scale-95',
  'bottom-right': 'opacity-0 translate-y-4 scale-95',
};

const EXIT_CLASSES: Record<FeedbackPosition, string> = {
  'top-left': 'opacity-0 -translate-y-2 scale-95',
  'top-center': 'opacity-0 -translate-y-2 scale-95',
  'top-right': 'opacity-0 -translate-y-2 scale-95',
  'center-left': 'opacity-0 -translate-x-2 scale-95',
  center: 'opacity-0 scale-90',
  'center-right': 'opacity-0 translate-x-2 scale-95',
  'bottom-left': 'opacity-0 translate-y-2 scale-95',
  'bottom-center': 'opacity-0 translate-y-2 scale-95',
  'bottom-right': 'opacity-0 translate-y-2 scale-95',
};

const SIZE_CLASSES: Record<FeedbackSize, string> = {
  s: 'px-6 py-4 min-w-[280px] max-w-[420px] text-sm',
  m: 'px-8 py-5 min-w-[340px] max-w-[500px] text-base',
  l: 'px-10 py-6 min-w-[400px] max-w-[580px] text-lg',
};

export function VoiceActionFeedback() {
  const [queue, setQueue] = useState<QueuedFeedback[]>([]);
  const [active, setActive] = useState<QueuedFeedback | null>(null);
  const [phase, setPhase] = useState<'enter' | 'visible' | 'exit'>('enter');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [position] = useFeedbackPositionSetting();
  const [enabled] = useFeedbackEnabledSetting();
  const [size] = useFeedbackSizeSetting();
  const [durationSec] = useFeedbackDurationSetting();
  const durationMsRef = useRef(durationSec * 1000);

  useEffect(() => {
    durationMsRef.current = durationSec * 1000;
  }, [durationSec]);

  const showItem = useCallback((item: QueuedFeedback) => {
    setActive(item);
    setPhase('enter');

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setPhase('visible');
      });
    });

    timerRef.current = setTimeout(() => {
      setPhase('exit');
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setActive(null);
      }, FADE_DURATION);
    }, durationMsRef.current);
  }, []);

  useEffect(() => {
    const handler = (e: CustomEvent<ActionFeedbackDetail>) => {
      const item: QueuedFeedback = {
        ...e.detail,
        id: ++feedbackIdCounter,
      };
      setQueue((prev) => [...prev, item]);
    };

    window.addEventListener(ACTION_FEEDBACK_EVENT, handler as EventListener);
    return () => {
      window.removeEventListener(
        ACTION_FEEDBACK_EVENT,
        handler as EventListener,
      );
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // When nothing is showing and queue has items, show next
  useEffect(() => {
    if (!active && queue.length > 0 && !timerRef.current) {
      const [next, ...rest] = queue;
      setQueue(rest);
      showItem(next);
    }
  }, [active, queue, showItem]);

  if (!active || !enabled) return null;

  return (
    <div
      className={cn(
        'fixed z-[9999] pointer-events-none',
        POSITION_CLASSES[position],
      )}>
      <div
        className={cn(
          'pointer-events-auto rounded-xl border border-neutral-700 bg-neutral-900/95 backdrop-blur-sm shadow-2xl',
          SIZE_CLASSES[size],
          'transition-all duration-[400ms] ease-out',
          phase === 'enter' && ENTER_CLASSES[position],
          phase === 'visible' && 'opacity-100 translate-0 scale-100',
          phase === 'exit' && EXIT_CLASSES[position],
        )}>
        <FeedbackContent detail={active} size={size} />
      </div>
    </div>
  );
}

function FeedbackContent({
  detail,
  size,
}: {
  detail: ActionFeedbackDetail;
  size: FeedbackSize;
}) {
  switch (detail.type) {
    case 'toggle':
      return (
        <ToggleVisual label={detail.label} value={detail.value} size={size} />
      );
    case 'value':
      return (
        <ValueVisual
          label={detail.label}
          from={detail.from}
          to={detail.to}
          unit={detail.unit}
          size={size}
        />
      );
    case 'select':
      return (
        <SelectVisual label={detail.label} value={detail.value} size={size} />
      );
    case 'action':
      return (
        <ActionVisual
          label={detail.label}
          description={detail.description}
          size={size}
        />
      );
    case 'mode':
      return (
        <ModeVisual label={detail.label} active={detail.active} size={size} />
      );
  }
}

const LABEL_SIZE: Record<FeedbackSize, string> = {
  s: 'text-xs',
  m: 'text-sm',
  l: 'text-base',
};

const TEXT_SIZE: Record<FeedbackSize, string> = {
  s: 'text-sm',
  m: 'text-base',
  l: 'text-lg',
};

const VALUE_SIZE: Record<FeedbackSize, string> = {
  s: 'text-lg',
  m: 'text-xl',
  l: 'text-2xl',
};

const ICON_SIZE: Record<FeedbackSize, string> = {
  s: 'w-8 h-8 text-sm',
  m: 'w-10 h-10 text-base',
  l: 'w-12 h-12 text-lg',
};

const TOGGLE_SIZE: Record<
  FeedbackSize,
  { track: string; thumb: string; onPos: string }
> = {
  s: { track: 'w-11 h-6', thumb: 'w-5 h-5', onPos: 'left-[22px]' },
  m: { track: 'w-14 h-7', thumb: 'w-6 h-6', onPos: 'left-[30px]' },
  l: { track: 'w-16 h-8', thumb: 'w-7 h-7', onPos: 'left-[34px]' },
};

function ToggleVisual({
  label,
  value,
  size,
}: {
  label: string;
  value: boolean;
  size: FeedbackSize;
}) {
  const [animated, setAnimated] = useState(!value);

  useEffect(() => {
    const timer = setTimeout(() => setAnimated(value), 300);
    return () => clearTimeout(timer);
  }, [value]);

  const toggle = TOGGLE_SIZE[size];

  return (
    <div className='flex items-center gap-4'>
      <div className='flex-1'>
        <p
          className={cn(
            'text-neutral-500 uppercase tracking-wider mb-1',
            LABEL_SIZE[size],
          )}>
          Setting
        </p>
        <p className={cn('text-neutral-200 font-medium', TEXT_SIZE[size])}>
          {label}
        </p>
      </div>
      <div
        className={cn(
          'relative rounded-full transition-colors duration-300',
          toggle.track,
          animated ? 'bg-green-500' : 'bg-neutral-600',
        )}>
        <div
          className={cn(
            'absolute top-0.5 rounded-full bg-white shadow-md transition-all duration-300',
            toggle.thumb,
            animated ? toggle.onPos : 'left-0.5',
          )}
        />
      </div>
    </div>
  );
}

function ValueVisual({
  label,
  from,
  to,
  unit,
  size,
}: {
  label: string;
  from?: string | number;
  to: string | number;
  unit?: string;
  size: FeedbackSize;
}) {
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowNew(true), 400);
    return () => clearTimeout(timer);
  }, []);

  const formatVal = (v: string | number) => (unit ? `${v}${unit}` : String(v));

  return (
    <div>
      <p
        className={cn(
          'text-neutral-500 uppercase tracking-wider mb-2',
          LABEL_SIZE[size],
        )}>
        {label}
      </p>
      <div className='flex items-center gap-3'>
        {from !== undefined && (
          <>
            <span
              className={cn(
                'font-mono transition-all duration-300',
                VALUE_SIZE[size],
                showNew ? 'text-neutral-600 line-through' : 'text-neutral-200',
              )}>
              {formatVal(from)}
            </span>
            <span className='text-neutral-500'>→</span>
          </>
        )}
        <span
          className={cn(
            'font-mono font-bold transition-all duration-300',
            VALUE_SIZE[size],
            showNew ? 'text-green-400 scale-110' : 'text-neutral-400 scale-100',
          )}>
          {formatVal(to)}
        </span>
      </div>
    </div>
  );
}

function SelectVisual({
  label,
  value,
  size,
}: {
  label: string;
  value: string;
  size: FeedbackSize;
}) {
  const [highlighted, setHighlighted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setHighlighted(true), 300);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div>
      <p
        className={cn(
          'text-neutral-500 uppercase tracking-wider mb-2',
          LABEL_SIZE[size],
        )}>
        {label}
      </p>
      <div
        className={cn(
          'inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all duration-300',
          highlighted
            ? 'border-cyan-500 bg-cyan-500/10 text-cyan-300'
            : 'border-neutral-700 bg-neutral-800 text-neutral-400',
        )}>
        <span className={cn('font-mono font-medium', TEXT_SIZE[size])}>
          {value}
        </span>
        {highlighted && (
          <span className={cn('text-green-400', LABEL_SIZE[size])}>✓</span>
        )}
      </div>
    </div>
  );
}

function ActionVisual({
  label,
  description,
  size,
}: {
  label: string;
  description?: string;
  size: FeedbackSize;
}) {
  return (
    <div className='flex items-center gap-3'>
      <div
        className={cn(
          'flex items-center justify-center rounded-full bg-green-500/20 text-green-400 shrink-0',
          ICON_SIZE[size],
        )}>
        ✓
      </div>
      <div>
        <p className={cn('text-neutral-200 font-medium', TEXT_SIZE[size])}>
          {label}
        </p>
        {description && (
          <p className={cn('text-neutral-500 mt-0.5', LABEL_SIZE[size])}>
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

function ModeVisual({
  label,
  active,
  size,
}: {
  label: string;
  active: boolean;
  size: FeedbackSize;
}) {
  const [animated, setAnimated] = useState(!active);

  useEffect(() => {
    const timer = setTimeout(() => setAnimated(active), 300);
    return () => clearTimeout(timer);
  }, [active]);

  return (
    <div className='flex items-center gap-3'>
      <div
        className={cn(
          'w-2.5 h-2.5 rounded-full transition-all duration-300',
          animated
            ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]'
            : 'bg-neutral-600',
        )}
      />
      <p className={cn('text-neutral-200 font-medium', TEXT_SIZE[size])}>
        {label}
      </p>
      <span
        className={cn(
          'px-2 py-0.5 rounded-full font-medium transition-all duration-300',
          LABEL_SIZE[size],
          animated
            ? 'bg-green-500/20 text-green-400'
            : 'bg-neutral-700 text-neutral-400',
        )}>
        {animated ? 'ON' : 'OFF'}
      </span>
    </div>
  );
}
