'use client';

import { cn } from '@/lib/utils';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'spinner' | 'dots' | 'pulse' | 'bars';
  className?: string;
}

export default function LoadingSpinner({
  size = 'md',
  variant = 'spinner',
  className,
}: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
    xl: 'w-12 h-12',
  };

  if (variant === 'spinner') {
    return (
      <div
        className={cn(
          'animate-spin rounded-full border-4 border-neutral-600 border-t-white',
          sizeClasses[size],
          className,
        )}
        role='status'
        aria-label='Loading'>
        <span className='sr-only'>Loading...</span>
      </div>
    );
  }

  if (variant === 'dots') {
    const dotSize = {
      sm: 'w-1 h-1',
      md: 'w-2 h-2',
      lg: 'w-3 h-3',
      xl: 'w-4 h-4',
    };

    return (
      <div
        className={cn('flex space-x-1', className)}
        role='status'
        aria-label='Loading'>
        <div
          className={cn(
            'bg-neutral-400 rounded-none animate-bounce',
            dotSize[size],
          )}
          style={{ animationDelay: '0ms' }}></div>
        <div
          className={cn(
            'bg-neutral-400 rounded-none animate-bounce',
            dotSize[size],
          )}
          style={{ animationDelay: '150ms' }}></div>
        <div
          className={cn(
            'bg-neutral-400 rounded-none animate-bounce',
            dotSize[size],
          )}
          style={{ animationDelay: '300ms' }}></div>
        <span className='sr-only'>Loading...</span>
      </div>
    );
  }

  if (variant === 'pulse') {
    return (
      <div
        className={cn(
          'bg-neutral-400 rounded-none animate-pulse',
          sizeClasses[size],
          className,
        )}
        role='status'
        aria-label='Loading'>
        <span className='sr-only'>Loading...</span>
      </div>
    );
  }

  if (variant === 'bars') {
    const barHeight = {
      sm: 'h-3',
      md: 'h-4',
      lg: 'h-6',
      xl: 'h-8',
    };

    return (
      <div
        className={cn('flex items-end space-x-1', className)}
        role='status'
        aria-label='Loading'>
        <div
          className={cn('w-1 bg-neutral-400 animate-pulse', barHeight[size])}
          style={{ animationDelay: '0ms', animationDuration: '1s' }}></div>
        <div
          className={cn('w-1 bg-neutral-400 animate-pulse', barHeight[size])}
          style={{ animationDelay: '200ms', animationDuration: '1s' }}></div>
        <div
          className={cn('w-1 bg-neutral-400 animate-pulse', barHeight[size])}
          style={{ animationDelay: '400ms', animationDuration: '1s' }}></div>
        <div
          className={cn('w-1 bg-neutral-400 animate-pulse', barHeight[size])}
          style={{ animationDelay: '600ms', animationDuration: '1s' }}></div>
        <span className='sr-only'>Loading...</span>
      </div>
    );
  }
  return null;
}
