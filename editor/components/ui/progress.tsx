'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

type ProgressProps = React.HTMLAttributes<HTMLDivElement> & {
  value?: number;
};

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, ...props }, ref) => {
    const clampedValue = Number.isFinite(value)
      ? Math.min(100, Math.max(0, value))
      : 0;

    return (
      <div
        ref={ref}
        role='progressbar'
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clampedValue}
        className={cn(
          'relative h-2 w-full overflow-hidden rounded-full bg-neutral-800',
          className,
        )}
        {...props}>
        <div
          className='h-full w-full bg-cyan-400 transition-transform duration-300 ease-out'
          style={{ transform: `translateX(-${100 - clampedValue}%)` }}
        />
      </div>
    );
  },
);

Progress.displayName = 'Progress';

export { Progress };
