'use client';

import { useCallback } from 'react';
import { Activity, Power } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MotionChart } from '../input-entry/motion-chart';
import type { MotionHistory } from '@/hooks/use-motion-history';
import type { Input } from '@/lib/types';
import { toggleMotionDetection } from '@/app/actions/actions';

interface InputMotionPanelProps {
  roomId: string;
  input: Input;
  motionHistory: MotionHistory | null;
  motionScore?: number;
  refreshState: () => Promise<void>;
}

export function InputMotionPanel({
  roomId,
  input,
  motionHistory,
  motionScore,
  refreshState,
}: InputMotionPanelProps) {
  const label = input.title || input.inputId;
  const isEnabled = input.motionEnabled === true;

  const handleToggle = useCallback(async () => {
    await toggleMotionDetection(roomId, input.inputId, !isEnabled);
    await refreshState();
  }, [roomId, input.inputId, isEnabled, refreshState]);

  if (!isEnabled) {
    return (
      <div className='flex flex-col items-center justify-center h-full text-neutral-500 gap-2 p-4'>
        <Activity className='size-6' />
        <span className='text-sm text-center'>Motion detection disabled</span>
        <Button
          size='sm'
          variant='outline'
          onClick={handleToggle}
          className='cursor-pointer text-xs gap-1.5 mt-1'>
          <Power className='size-3' />
          Enable
        </Button>
      </div>
    );
  }

  if (!motionHistory || motionHistory.history.length < 2) {
    const score = motionScore ?? motionHistory?.current ?? 0;
    return (
      <div className='flex flex-col h-full p-3 gap-2'>
        <div className='flex items-center gap-2 text-xs text-neutral-400 shrink-0'>
          <Activity className='size-3.5 text-green-500 animate-pulse' />
          <span className='truncate font-medium text-neutral-300'>{label}</span>
          <span className='ml-auto text-neutral-500'>
            {(score * 100).toFixed(0)}%
          </span>
          <Button
            size='sm'
            variant='ghost'
            onClick={handleToggle}
            className='cursor-pointer h-5 w-5 p-0 ml-1'
            title='Disable motion detection'>
            <Power className='size-3 text-neutral-500' />
          </Button>
        </div>
        <div className='flex-1 flex items-center justify-center text-neutral-500 text-xs'>
          Collecting data...
        </div>
      </div>
    );
  }

  return (
    <div className='flex flex-col h-full p-3 gap-2'>
      <div className='flex items-center gap-2 text-xs text-neutral-400 shrink-0'>
        <Activity className='size-3.5 text-green-500' />
        <span className='truncate font-medium text-neutral-300'>{label}</span>
        <span className='ml-auto text-neutral-500'>
          {(motionHistory.current * 100).toFixed(0)}%
        </span>
        <Button
          size='sm'
          variant='ghost'
          onClick={handleToggle}
          className='cursor-pointer h-5 w-5 p-0 ml-1'
          title='Disable motion detection'>
          <Power className='size-3 text-neutral-500' />
        </Button>
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
