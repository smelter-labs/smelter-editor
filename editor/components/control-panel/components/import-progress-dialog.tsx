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

function createSeededRandom(seed: number) {
  let state = (seed ^ 0xa5a5a5a5) >>> 0;

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function splitWeightedTotal(total: number, weights: number[]) {
  if (total <= 0) {
    return IMPORT_METRICS.map(() => 0);
  }

  const minimumPerMetric = total >= weights.length ? 1 : 0;
  const base = weights.map(() => minimumPerMetric);
  const guaranteedTotal = minimumPerMetric * weights.length;
  const distributable = Math.max(total - guaranteedTotal, 0);
  const sumOfWeights = weights.reduce((sum, value) => sum + value, 0) || 1;
  const rawShares = weights.map(
    (weight) => (weight / sumOfWeights) * distributable,
  );
  const totals = rawShares.map(
    (share, index) => base[index] + Math.floor(share),
  );
  const remainder = total - totals.reduce((sum, value) => sum + value, 0);

  if (remainder > 0) {
    rawShares
      .map((share, index) => ({
        index,
        fraction: share - Math.floor(share),
      }))
      .sort((left, right) => right.fraction - left.fraction)
      .slice(0, remainder)
      .forEach(({ index }) => {
        totals[index] += 1;
      });
  }

  return totals;
}

function formatMetricValue(value: number) {
  return value.toLocaleString('en-US');
}

export function ImportProgressDialog({ progress }: ImportProgressDialogProps) {
  const total = progress?.total ?? 0;
  const current = progress ? Math.min(progress.current, total) : 0;
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  const [sessionSeed, setSessionSeed] = useState(0);
  const [displayValues, setDisplayValues] =
    useState<number[]>(zeroMetricValues);
  const wasOpenRef = useRef(false);
  const animatedValuesRef = useRef<number[]>(zeroMetricValues);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const isOpen = progress !== null;

    if (isOpen && !wasOpenRef.current) {
      setSessionSeed((previous) => previous + 1);
      setDisplayValues(zeroMetricValues);
      animatedValuesRef.current = zeroMetricValues;
    }

    if (!isOpen && wasOpenRef.current) {
      setDisplayValues(zeroMetricValues);
      animatedValuesRef.current = zeroMetricValues;
    }

    wasOpenRef.current = isOpen;
  }, [progress]);

  const metricPlans = useMemo<ImportMetricPlan[]>(() => {
    const random = createSeededRandom(Math.max(sessionSeed, 1));
    const weights = IMPORT_METRICS.map(
      (_, index) => 0.8 + random() * 1.35 + (index === 2 ? 0.22 : 0),
    );
    const totals = splitWeightedTotal(Math.max(total, 1), weights);

    return IMPORT_METRICS.map((metric, index) => {
      const metricTotal = totals[index] ?? 0;
      const phaseOffset = random() * 0.75;
      const preciseCurrent =
        total > 0 ? ((current + phaseOffset) / total) * metricTotal : 0;
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
  }, [current, sessionSeed, total]);

  const targetValuesKey = metricPlans
    .map((metric) => metric.currentDisplayValue)
    .join(':');

  useEffect(() => {
    if (progress === null) {
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
        const targetValue = targetValues[index] ?? value;
        return Math.round(value + (targetValue - value) * easedRatio);
      });

      animatedValuesRef.current = nextValues;
      setDisplayValues(nextValues);

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
  }, [metricPlans, progress, targetValuesKey]);

  return (
    <Dialog open={progress !== null} onOpenChange={() => {}}>
      <DialogContent
        className='max-w-md border-cyan-400/20 bg-neutral-950/95 shadow-[0_0_60px_rgba(8,145,178,0.12)] [&>button]:hidden'
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}>
        <DialogHeader className='relative'>
          <DialogTitle>Importing Configuration</DialogTitle>
          <DialogDescription className='text-neutral-400'>
            Applying the saved room setup. This dialog will close automatically
            when the import finishes.
          </DialogDescription>
        </DialogHeader>

        <div className='relative overflow-hidden rounded-xl border border-cyan-400/15 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.14),_transparent_34%),linear-gradient(180deg,_rgba(3,7,18,0.96),_rgba(2,6,23,0.82))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'>
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
                  {progress?.phase}
                </p>
              </div>
              <p className='text-sm text-cyan-100 tabular-nums drop-shadow-[0_0_10px_rgba(34,211,238,0.45)]'>
                {percent}%
              </p>
            </div>

            <div className='space-y-2'>
              <Progress
                value={percent}
                className='h-2.5 bg-white/8 shadow-[0_0_18px_rgba(34,211,238,0.12)]'
              />
              <div className='flex items-center justify-between text-[10px] uppercase tracking-[0.26em] text-neutral-500'>
                <span>telemetry sync</span>
                <span className='tabular-nums'>
                  {current} / {total}
                </span>
              </div>
            </div>

            <div className='grid gap-2'>
              {metricPlans.map((metric, index) => {
                const animatedValue = displayValues[index] ?? 0;

                return (
                  <div
                    key={metric.label}
                    className={cn(
                      'group relative overflow-hidden rounded-lg border bg-black/35 p-3 backdrop-blur-sm transition-colors duration-300',
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
                        {metric.percent}%
                      </span>
                    </div>

                    <div className='relative mt-3 h-1.5 overflow-hidden rounded-full bg-white/6'>
                      <div
                        className={cn(
                          'absolute inset-y-0 left-0 rounded-full bg-gradient-to-r transition-[width] duration-300 ease-out',
                          metric.barClassName,
                        )}
                        style={{ width: `${metric.percent}%` }}
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
