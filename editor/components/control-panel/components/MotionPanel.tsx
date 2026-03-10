'use client';

import { Activity } from 'lucide-react';
import { MotionChart } from '../input-entry/motion-chart';
import type { MotionHistory } from '@/hooks/use-motion-history';
import type { Input } from '@/lib/types';

interface MotionPanelProps {
  selectedInputId: string | null;
  inputs: Input[];
  motionHistoryMap: Map<string, MotionHistory>;
}

export function MotionPanel({
  selectedInputId,
  inputs,
  motionHistoryMap,
}: MotionPanelProps) {
  if (!selectedInputId) {
    return (
      <div className='flex flex-col items-center justify-center h-full text-neutral-500 gap-2 p-4'>
        <Activity className='size-6' />
        <span className='text-sm text-center'>
          Select a timeline clip to see motion
        </span>
      </div>
    );
  }

  const input = inputs.find((i) => i.inputId === selectedInputId);
  const motionHistory = motionHistoryMap.get(selectedInputId);

  if (!motionHistory) {
    return (
      <div className='flex flex-col items-center justify-center h-full text-neutral-500 gap-2 p-4'>
        <Activity className='size-6' />
        <span className='text-sm text-center'>
          No motion data for this input
        </span>
      </div>
    );
  }

  const label = input?.title || input?.channelId || selectedInputId;
  const isEnabled = input?.motionEnabled !== false;

  if (!isEnabled) {
    return (
      <div className='flex flex-col items-center justify-center h-full text-neutral-500 gap-2 p-4'>
        <Activity className='size-6' />
        <span className='text-sm text-center'>
          Motion detection disabled for{' '}
          <span className='text-neutral-300'>{label}</span>
        </span>
      </div>
    );
  }

  return (
    <div className='flex flex-col h-full p-3 gap-2'>
      <div className='flex items-center gap-2 text-xs text-neutral-400 shrink-0'>
        <Activity className='size-3.5 text-green-500' />
        <span className='truncate font-medium text-neutral-300'>{label}</span>
      </div>
      <div className='flex-1 min-h-0'>
        <MotionChart
          history={motionHistory.history}
          peak={motionHistory.peak}
          current={motionHistory.current}
        />
      </div>
    </div>
  );
}
