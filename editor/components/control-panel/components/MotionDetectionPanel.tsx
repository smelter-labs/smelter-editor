'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Eye, EyeOff, Power } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MotionChart } from '../input-entry/motion-chart';
import type { MotionHistory } from '@/hooks/use-motion-history';
import type { Input } from '@/lib/types';
import { toggleMotionDetection } from '@/app/actions/actions';

interface MotionDetectionPanelProps {
  roomId: string;
  inputs: Input[];
  motionHistoryMap: Map<string, MotionHistory>;
  motionScores: Record<string, number>;
  refreshState: () => Promise<void>;
}

function getMotionTextColor(score: number): string {
  if (score < 0.02) return 'text-neutral-500';
  if (score < 0.05) return 'text-green-500';
  if (score < 0.15) return 'text-yellow-500';
  return 'text-red-500';
}

function getMotionDotColor(score: number): string {
  if (score < 0.02) return 'bg-neutral-500';
  if (score < 0.05) return 'bg-green-500';
  if (score < 0.15) return 'bg-yellow-500';
  return 'bg-red-500';
}

export function MotionDetectionPanel({
  roomId,
  inputs,
  motionHistoryMap,
  motionScores,
  refreshState,
}: MotionDetectionPanelProps) {
  const [expandedInputIds, setExpandedInputIds] = useState<Set<string>>(
    () =>
      new Set(
        inputs
          .filter((input) => input.motionEnabled === true)
          .map((input) => input.inputId),
      ),
  );
  const [pendingInputIds, setPendingInputIds] = useState<Set<string>>(
    new Set(),
  );

  useEffect(() => {
    const inputIds = new Set(inputs.map((input) => input.inputId));
    setExpandedInputIds((prev) => {
      const next = new Set<string>();
      for (const inputId of prev) {
        if (inputIds.has(inputId)) {
          next.add(inputId);
        }
      }
      return next;
    });
  }, [inputs]);

  const toggleChartVisibility = useCallback((inputId: string) => {
    setExpandedInputIds((prev) => {
      const next = new Set(prev);
      if (next.has(inputId)) {
        next.delete(inputId);
      } else {
        next.add(inputId);
      }
      return next;
    });
  }, []);

  const handleToggleMotion = useCallback(
    async (inputId: string, enabled: boolean) => {
      setPendingInputIds((prev) => new Set(prev).add(inputId));
      if (enabled) {
        setExpandedInputIds((prev) => new Set(prev).add(inputId));
      } else {
        setExpandedInputIds((prev) => {
          const next = new Set(prev);
          next.delete(inputId);
          return next;
        });
      }

      try {
        await toggleMotionDetection(roomId, inputId, enabled);
        await refreshState();
      } finally {
        setPendingInputIds((prev) => {
          const next = new Set(prev);
          next.delete(inputId);
          return next;
        });
      }
    },
    [refreshState, roomId],
  );

  const inputPanels = useMemo(
    () =>
      inputs.map((input) => {
        const label = input.title || input.inputId;
        const history = motionHistoryMap.get(input.inputId) ?? null;
        const isEnabled = input.motionEnabled === true;
        const isExpanded = expandedInputIds.has(input.inputId);
        const isPending = pendingInputIds.has(input.inputId);
        const currentScore =
          history?.current ?? motionScores[input.inputId] ?? 0;
        const hasChartData = (history?.history.length ?? 0) >= 2;

        return (
          <div
            key={input.inputId}
            className='rounded-md border border-neutral-800 bg-neutral-950/60'>
            <div className='flex items-center gap-2 p-3'>
              <Activity
                className={`size-4 shrink-0 ${
                  isEnabled ? 'text-green-500' : 'text-neutral-600'
                }`}
              />
              <div className='min-w-0 flex-1'>
                <div className='truncate text-sm font-medium text-neutral-200'>
                  {label}
                </div>
                <div className='text-[11px] text-neutral-500'>
                  {input.inputId}
                </div>
              </div>
              <div className='flex items-center gap-2 shrink-0'>
                <div className='flex items-center gap-1.5 rounded-sm border border-neutral-800 px-2 py-1'>
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${getMotionDotColor(currentScore)}`}
                  />
                  <span
                    className={`text-xs font-mono ${getMotionTextColor(currentScore)}`}>
                    {(currentScore * 100).toFixed(0)}%
                  </span>
                </div>
                <Button
                  size='sm'
                  variant='ghost'
                  onClick={() => toggleChartVisibility(input.inputId)}
                  disabled={!isEnabled}
                  className='h-7 w-7 p-0 cursor-pointer'
                  title={
                    isEnabled
                      ? isExpanded
                        ? 'Hide chart'
                        : 'Show chart'
                      : 'Enable motion detection to show chart'
                  }>
                  {isExpanded ? (
                    <EyeOff className='size-3.5' />
                  ) : (
                    <Eye className='size-3.5' />
                  )}
                </Button>
                <Button
                  size='sm'
                  variant={isEnabled ? 'default' : 'outline'}
                  onClick={() => handleToggleMotion(input.inputId, !isEnabled)}
                  disabled={isPending}
                  className='h-7 cursor-pointer gap-1.5 px-2 text-xs'>
                  <Power className='size-3.5' />
                  {isEnabled ? 'Disable' : 'Enable'}
                </Button>
              </div>
            </div>

            {!isEnabled ? (
              <div className='border-t border-neutral-800 px-3 py-2 text-xs text-neutral-500'>
                Motion detection disabled
              </div>
            ) : isExpanded ? (
              <div className='border-t border-neutral-800 p-3'>
                {hasChartData ? (
                  <div className='h-24'>
                    <MotionChart
                      history={history?.history ?? []}
                      peak={history?.peak ?? currentScore}
                      current={currentScore}
                    />
                  </div>
                ) : (
                  <div className='flex h-24 items-center justify-center text-xs text-neutral-500'>
                    Collecting data...
                  </div>
                )}
              </div>
            ) : null}
          </div>
        );
      }),
    [
      expandedInputIds,
      handleToggleMotion,
      inputs,
      motionHistoryMap,
      motionScores,
      pendingInputIds,
      toggleChartVisibility,
    ],
  );

  if (inputs.length === 0) {
    return (
      <div className='flex h-full items-center justify-center p-4 text-sm text-neutral-500'>
        No video inputs available for motion detection.
      </div>
    );
  }

  return (
    <div className='flex h-full flex-col gap-3 overflow-y-auto p-3'>
      {inputPanels}
    </div>
  );
}
