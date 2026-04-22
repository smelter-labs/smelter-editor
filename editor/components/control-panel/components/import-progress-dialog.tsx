'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { FxCanvas, FX_PRESET_IMPORT } from '@/lib/fx';

export type ImportProgressState = {
  phase: string;
  current: number;
  total: number;
};

type ImportProgressDialogProps = {
  progress: ImportProgressState | null;
};

type ImportMetricConfig = {
  label: string;
  multiplier: number;
  continuous?: boolean;
  accentClassName: string;
  borderClassName: string;
  badgeClassName: string;
  barClassName: string;
};

type ImportMetricPlan = ImportMetricConfig & {
  total: number;
  current: number;
  currentDisplayValue: number;
  totalDisplayValue: number;
  percent: number;
  delayMs: number;
};

const IMPORT_METRICS: ImportMetricConfig[] = [
  {
    label: 'keyframes stitched',
    multiplier: 1,
    accentClassName: 'text-cyan-200',
    borderClassName: 'border-cyan-400/30',
    badgeClassName: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-100',
    barClassName: 'from-cyan-400 via-sky-300 to-fuchsia-400',
  },
  {
    label: 'chroma ghosts purged',
    multiplier: 1,
    accentClassName: 'text-fuchsia-200',
    borderClassName: 'border-fuchsia-400/30',
    badgeClassName: 'border-fuchsia-400/25 bg-fuchsia-400/10 text-fuchsia-100',
    barClassName: 'from-fuchsia-400 via-pink-300 to-cyan-300',
  },
  {
    label: 'gpu fan rotations',
    multiplier: 100,
    continuous: true,
    accentClassName: 'text-emerald-200',
    borderClassName: 'border-emerald-400/30',
    badgeClassName: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-100',
    barClassName: 'from-emerald-400 via-cyan-300 to-blue-300',
  },
  {
    label: 'scanlines stabilized',
    multiplier: 1,
    accentClassName: 'text-amber-100',
    borderClassName: 'border-amber-300/25',
    badgeClassName: 'border-amber-300/20 bg-amber-300/10 text-amber-100',
    barClassName: 'from-amber-300 via-fuchsia-300 to-cyan-300',
  },
];

const zeroMetricValues = IMPORT_METRICS.map(() => 0);

const CONTINUOUS_METRIC_INDEX = IMPORT_METRICS.findIndex(
  (metric) => metric.continuous,
);
const CONTINUOUS_DECAY_RATE = 3.0;
const CONTINUOUS_MIN_VELOCITY = 12;
const CONTINUOUS_BOOST_FACTOR = 3.5;
const CONTINUOUS_MAX_VELOCITY = 800;
const MIN_IMPORT_DIALOG_VISIBLE_MS = 3000;
const MAX_IMPORT_DIALOG_VISIBLE_MS = 5000;

function createSeededRandom(seed: number) {
  let state = (seed ^ 0xa5a5a5a5) >>> 0;

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function formatMetricValue(value: number) {
  return value.toLocaleString('en-US');
}

export function ImportProgressDialog({ progress }: ImportProgressDialogProps) {
  const [visibleProgress, setVisibleProgress] =
    useState<ImportProgressState | null>(progress);
  const openedAtRef = useRef<number | null>(progress ? Date.now() : null);
  const sessionMinVisibleMsRef = useRef(MIN_IMPORT_DIALOG_VISIBLE_MS);
  const closeTimeoutRef = useRef<number | null>(null);
  const [, setDisplayTick] = useState(0);
  const total = visibleProgress?.total ?? 0;
  const current = visibleProgress
    ? Math.min(visibleProgress.current, total)
    : 0;
  const elapsedMs =
    openedAtRef.current === null
      ? 0
      : Math.max(Date.now() - openedAtRef.current, 0);
  const sessionProgressRatio =
    sessionMinVisibleMsRef.current > 0
      ? Math.min(elapsedMs / sessionMinVisibleMsRef.current, 1)
      : 1;
  const sessionCurrentCap =
    total > 0 ? Math.floor(total * sessionProgressRatio) : 0;
  const displayedCurrent = visibleProgress
    ? Math.min(current, sessionCurrentCap)
    : 0;
  const rawPercent =
    total > 0 ? Math.round((displayedCurrent / total) * 100) : 0;
  const fakeMinPercent = Math.round(Math.min(sessionProgressRatio, 0.15) * 100);
  const percent = Math.max(rawPercent, fakeMinPercent);
  const [sessionSeed, setSessionSeed] = useState(0);
  const [displayValues, setDisplayValues] =
    useState<number[]>(zeroMetricValues);
  const wasOpenRef = useRef(false);
  const animatedValuesRef = useRef<number[]>(zeroMetricValues);
  const animationFrameRef = useRef<number | null>(null);
  const continuousVelocityRef = useRef(0);
  const continuousValueRef = useRef(0);
  const continuousPrevTargetRef = useRef(0);
  const continuousRafRef = useRef<number | null>(null);
  const continuousLastTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (visibleProgress === null) return;

    const intervalId = window.setInterval(() => {
      setDisplayTick((previous) => previous + 1);
    }, 50);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [visibleProgress]);

  useEffect(() => {
    if (progress !== null) {
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
      if (openedAtRef.current === null) {
        openedAtRef.current = Date.now();
        const range =
          MAX_IMPORT_DIALOG_VISIBLE_MS - MIN_IMPORT_DIALOG_VISIBLE_MS;
        sessionMinVisibleMsRef.current =
          MIN_IMPORT_DIALOG_VISIBLE_MS +
          Math.floor(Math.random() * (range + 1));
      }
      setVisibleProgress(progress);
      return;
    }

    if (visibleProgress === null) {
      openedAtRef.current = null;
      return;
    }

    const openedAt = openedAtRef.current ?? Date.now();
    const elapsed = Date.now() - openedAt;
    const delayMs = Math.max(sessionMinVisibleMsRef.current - elapsed, 0);

    closeTimeoutRef.current = window.setTimeout(() => {
      setVisibleProgress(null);
      openedAtRef.current = null;
      closeTimeoutRef.current = null;
    }, delayMs);

    return () => {
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
    };
  }, [progress, visibleProgress]);

  useEffect(() => {
    const isOpen = visibleProgress !== null;

    if (isOpen && !wasOpenRef.current) {
      setSessionSeed((previous) => previous + 1);
      setDisplayValues(zeroMetricValues);
      animatedValuesRef.current = zeroMetricValues;
      continuousVelocityRef.current = 0;
      continuousValueRef.current = 0;
      continuousPrevTargetRef.current = 0;
      continuousLastTimeRef.current = null;
      if (continuousRafRef.current !== null) {
        cancelAnimationFrame(continuousRafRef.current);
        continuousRafRef.current = null;
      }
    }

    if (!isOpen && wasOpenRef.current) {
      setDisplayValues(zeroMetricValues);
      animatedValuesRef.current = zeroMetricValues;
      continuousVelocityRef.current = 0;
      continuousValueRef.current = 0;
      continuousPrevTargetRef.current = 0;
      continuousLastTimeRef.current = null;
      if (continuousRafRef.current !== null) {
        cancelAnimationFrame(continuousRafRef.current);
        continuousRafRef.current = null;
      }
    }

    wasOpenRef.current = isOpen;
  }, [visibleProgress]);

  const metricPlans = useMemo<ImportMetricPlan[]>(() => {
    const random = createSeededRandom(Math.max(sessionSeed, 1));
    const baseTotal = Math.max(total, 1);
    const ratioFromProgress = total > 0 ? displayedCurrent / total : 0;
    const ratio = Math.max(ratioFromProgress, sessionProgressRatio);

    return IMPORT_METRICS.map((metric, index) => {
      const targetScale = 7 + random() * 16 + (index === 2 ? 8 : 0);
      const metricTotal = Math.max(1, Math.round(baseTotal * targetScale));
      const paceBias = 0.8 + random() * 0.45;
      const preciseCurrent =
        Math.min(1, Math.pow(ratio, paceBias)) * metricTotal;
      const metricCurrent = Math.min(metricTotal, Math.floor(preciseCurrent));
      const currentDisplayValue = metricCurrent * metric.multiplier;
      const totalDisplayValue = metricTotal * metric.multiplier;
      const metricPercent =
        totalDisplayValue > 0
          ? Math.round((currentDisplayValue / totalDisplayValue) * 100)
          : 0;

      return {
        ...metric,
        total: metricTotal,
        current: metricCurrent,
        currentDisplayValue,
        totalDisplayValue,
        percent: metricPercent,
        delayMs: 140 + Math.round(random() * 800),
      };
    });
  }, [displayedCurrent, sessionProgressRatio, sessionSeed, total]);

  const targetValuesKey = metricPlans
    .map((metric) => metric.currentDisplayValue)
    .join(':');

  useEffect(() => {
    if (visibleProgress === null) {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    const targetValues = metricPlans.map(
      (metric) => metric.currentDisplayValue,
    );
    const startValues = animatedValuesRef.current;
    const durationMs = 280;
    let startedAt: number | null = null;

    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const tick = (timestamp: number) => {
      if (startedAt === null) {
        startedAt = timestamp;
      }

      const progressRatio = Math.min((timestamp - startedAt) / durationMs, 1);
      const easedRatio = 1 - Math.pow(1 - progressRatio, 3);
      const nextValues = startValues.map((value, index) => {
        if (index === CONTINUOUS_METRIC_INDEX) return value;
        const targetValue = targetValues[index] ?? value;
        return Math.round(value + (targetValue - value) * easedRatio);
      });

      animatedValuesRef.current = nextValues;
      setDisplayValues((prev) => {
        if (CONTINUOUS_METRIC_INDEX >= 0) {
          const result = [...nextValues];
          result[CONTINUOUS_METRIC_INDEX] = prev[CONTINUOUS_METRIC_INDEX] ?? 0;
          return result;
        }
        return nextValues;
      });

      if (progressRatio < 1) {
        animationFrameRef.current = requestAnimationFrame(tick);
      } else {
        animationFrameRef.current = null;
      }
    };

    animationFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [metricPlans, visibleProgress, targetValuesKey]);

  useEffect(() => {
    if (visibleProgress === null || CONTINUOUS_METRIC_INDEX < 0) {
      if (continuousRafRef.current !== null) {
        cancelAnimationFrame(continuousRafRef.current);
        continuousRafRef.current = null;
      }
      continuousLastTimeRef.current = null;
      return;
    }

    const continuousMetric = metricPlans[CONTINUOUS_METRIC_INDEX];
    if (!continuousMetric) return;

    const newTarget = continuousMetric.currentDisplayValue;
    const prevTarget = continuousPrevTargetRef.current;
    if (newTarget > prevTarget) {
      const delta = newTarget - prevTarget;
      continuousVelocityRef.current = Math.min(
        continuousVelocityRef.current + CONTINUOUS_BOOST_FACTOR * delta,
        CONTINUOUS_MAX_VELOCITY,
      );
    }
    continuousPrevTargetRef.current = newTarget;

    const totalDisplay = continuousMetric.totalDisplayValue;
    const isComplete = current >= total && total > 0;

    if (continuousRafRef.current !== null) {
      cancelAnimationFrame(continuousRafRef.current);
    }
    continuousLastTimeRef.current = null;

    const tick = (timestamp: number) => {
      if (continuousLastTimeRef.current === null) {
        continuousLastTimeRef.current = timestamp;
        continuousRafRef.current = requestAnimationFrame(tick);
        return;
      }

      const dt = Math.min(
        (timestamp - continuousLastTimeRef.current) / 1000,
        0.1,
      );
      continuousLastTimeRef.current = timestamp;

      let velocity = continuousVelocityRef.current;
      velocity *= Math.exp(-CONTINUOUS_DECAY_RATE * dt);

      const reachedTotal =
        totalDisplay > 0 && continuousValueRef.current >= totalDisplay;
      if (!(reachedTotal && isComplete)) {
        velocity = Math.max(velocity, CONTINUOUS_MIN_VELOCITY);
      }
      continuousVelocityRef.current = velocity;

      let nextValue = continuousValueRef.current + velocity * dt;
      if (totalDisplay > 0) {
        nextValue = Math.min(nextValue, totalDisplay);
      }
      continuousValueRef.current = nextValue;

      const rounded = Math.round(nextValue);
      setDisplayValues((prev) => {
        if (prev[CONTINUOUS_METRIC_INDEX] === rounded) return prev;
        const next = [...prev];
        next[CONTINUOUS_METRIC_INDEX] = rounded;
        return next;
      });

      const finished =
        totalDisplay > 0 && nextValue >= totalDisplay && isComplete;
      if (!finished) {
        continuousRafRef.current = requestAnimationFrame(tick);
      } else {
        continuousRafRef.current = null;
        continuousLastTimeRef.current = null;
      }
    };

    continuousRafRef.current = requestAnimationFrame(tick);

    return () => {
      if (continuousRafRef.current !== null) {
        cancelAnimationFrame(continuousRafRef.current);
        continuousRafRef.current = null;
      }
    };
  }, [metricPlans, visibleProgress, displayedCurrent, total]);

  return (
    <Dialog open={visibleProgress !== null} onOpenChange={() => {}}>
      <DialogContent
        className='max-w-md overflow-hidden border-cyan-400/20 bg-neutral-950/70 shadow-[0_0_60px_rgba(8,145,178,0.12)] [&>button]:hidden'
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}>
        <FxCanvas
          config={FX_PRESET_IMPORT}
          isActive={visibleProgress !== null}
          intensity={percent / 100}
        />
        <DialogHeader className='relative'>
          <DialogTitle>Importing Configuration</DialogTitle>
          <DialogDescription className='text-neutral-400'>
            Applying the saved room setup. This dialog will close automatically
            when the import finishes.
          </DialogDescription>
        </DialogHeader>

        <div className='relative overflow-hidden rounded-xl border border-cyan-400/15 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.10),_transparent_34%),linear-gradient(180deg,_rgba(3,7,18,0.55),_rgba(2,6,23,0.40))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'>
          <div className='pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(6,182,212,0.08),transparent)] opacity-70 import-progress-scanline' />
          <div className='pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[length:100%_8px] opacity-20' />
          <div className='pointer-events-none absolute -inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/70 to-transparent import-progress-sweep' />

          <div className='relative space-y-4'>
            <div className='flex items-center justify-between gap-3'>
              <div className='space-y-1'>
                <p className='text-[11px] uppercase tracking-[0.32em] text-cyan-300/70'>
                  Render pipeline
                </p>
                <p className='text-sm font-medium text-white'>
                  {visibleProgress?.phase}
                </p>
              </div>
              <p className='text-sm text-cyan-100 tabular-nums drop-shadow-[0_0_10px_rgba(34,211,238,0.45)]'>
                {percent}%
              </p>
            </div>

            <div className='space-y-2'>
              <Progress
                value={percent}
                className='h-2.5 bg-white/5 shadow-[0_0_18px_rgba(34,211,238,0.12)]'
              />
              <div className='flex items-center justify-between text-[10px] uppercase tracking-[0.26em] text-neutral-500'>
                <span>telemetry sync</span>
                <span className='tabular-nums'>
                  {displayedCurrent} / {total}
                </span>
              </div>
            </div>

            <div className='grid gap-2'>
              {metricPlans.map((metric, index) => {
                const animatedValue = displayValues[index] ?? 0;
                const animatedPercent =
                  metric.totalDisplayValue > 0
                    ? Math.round(
                        (animatedValue / metric.totalDisplayValue) * 100,
                      )
                    : 0;

                return (
                  <div
                    key={metric.label}
                    className={cn(
                      'group relative overflow-hidden rounded-lg border bg-black/15 p-3 backdrop-blur-[2px] transition-colors duration-300',
                      metric.borderClassName,
                    )}>
                    <div
                      className='pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 import-progress-glow'
                      style={{
                        background:
                          'radial-gradient(circle at top left, rgba(255,255,255,0.12), transparent 40%)',
                      }}
                    />
                    <div
                      className='pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/10 to-transparent import-progress-metric-sweep'
                      style={{ animationDelay: `${metric.delayMs}ms` }}
                    />

                    <div className='relative flex items-start justify-between gap-3'>
                      <div className='min-w-0'>
                        <p
                          className={cn(
                            'text-[10px] uppercase tracking-[0.3em] text-neutral-400',
                            metric.accentClassName,
                          )}>
                          {metric.label}
                        </p>
                        <p className='mt-1 font-mono text-sm text-white tabular-nums drop-shadow-[0_0_8px_rgba(255,255,255,0.12)]'>
                          {formatMetricValue(animatedValue)} /{' '}
                          {formatMetricValue(metric.totalDisplayValue)}
                        </p>
                      </div>

                      <span
                        className={cn(
                          'rounded-full border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.24em] tabular-nums',
                          metric.badgeClassName,
                        )}>
                        {animatedPercent}%
                      </span>
                    </div>

                    <div className='relative mt-3 h-1.5 overflow-hidden rounded-full bg-white/4'>
                      <div
                        className={cn(
                          'absolute inset-y-0 left-0 rounded-full bg-gradient-to-r transition-[width] duration-300 ease-out',
                          metric.barClassName,
                        )}
                        style={{ width: `${animatedPercent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <style jsx>{`
          .import-progress-scanline {
            animation: importProgressScanline 3.4s linear infinite;
          }

          .import-progress-sweep {
            animation: importProgressSweep 2.8s ease-in-out infinite;
          }

          .import-progress-metric-sweep {
            animation: importProgressMetricSweep 2.4s linear infinite;
          }

          .import-progress-glow {
            animation: importProgressGlow 1.8s ease-in-out infinite;
          }

          @keyframes importProgressScanline {
            0% {
              transform: translateY(-110%);
            }
            100% {
              transform: translateY(110%);
            }
          }

          @keyframes importProgressSweep {
            0%,
            100% {
              transform: translateX(-12%);
              opacity: 0.22;
            }
            50% {
              transform: translateX(12%);
              opacity: 0.78;
            }
          }

          @keyframes importProgressMetricSweep {
            0% {
              transform: translateX(-160%);
              opacity: 0;
            }
            18% {
              opacity: 0.42;
            }
            52% {
              opacity: 0.1;
            }
            100% {
              transform: translateX(440%);
              opacity: 0;
            }
          }

          @keyframes importProgressGlow {
            0%,
            100% {
              opacity: 0.1;
            }
            50% {
              opacity: 0.28;
            }
          }
        `}</style>
      </DialogContent>
    </Dialog>
  );
}
