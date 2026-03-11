'use client';

import { Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';

function getMotionColor(score: number): string {
  if (score < 0.02) return 'text-neutral-500';
  if (score < 0.05) return 'text-green-500';
  if (score < 0.15) return 'text-yellow-500';
  return 'text-red-500';
}

function getDotColor(score: number): string {
  if (score < 0.02) return 'bg-neutral-500';
  if (score < 0.05) return 'bg-green-500';
  if (score < 0.15) return 'bg-yellow-500';
  return 'bg-red-500';
}

interface MotionIndicatorProps {
  score: number;
  enabled: boolean;
  onToggle: () => void;
}

export function MotionIndicator({
  score,
  enabled,
  onToggle,
}: MotionIndicatorProps) {
  if (!enabled) {
    return (
      <Button
        data-no-dnd
        size='sm'
        variant='ghost'
        className='transition-all duration-300 ease-in-out h-7 px-1.5 cursor-pointer gap-1'
        onClick={onToggle}
        title='Motion detection disabled (click to enable)'>
        <Activity className='text-neutral-600 size-4' />
      </Button>
    );
  }

  const displayValue = (score * 100).toFixed(0);

  return (
    <Button
      data-no-dnd
      size='sm'
      variant='ghost'
      className='transition-all duration-300 ease-in-out h-7 px-1.5 cursor-pointer gap-1'
      onClick={onToggle}
      title={`Motion: ${displayValue}% (click to disable)`}>
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full ${getDotColor(score)}`}
      />
      <span className={`text-xs font-mono ${getMotionColor(score)}`}>
        {displayValue}%
      </span>
    </Button>
  );
}
