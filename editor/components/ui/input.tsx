import * as React from 'react';

import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot='input'
      className={cn(
        'flex h-7 w-full border border-neutral-700/20 bg-[#0e0e0e] px-2 py-1 text-[10px] text-foreground shadow-sm transition-colors file:border-0 file:bg-transparent file:text-[10px] file:font-medium file:text-foreground placeholder:text-neutral-600 focus-visible:outline-none focus-visible:border-cyan disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
