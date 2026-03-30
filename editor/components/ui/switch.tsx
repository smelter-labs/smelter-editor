'use client';

import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';

import { cn } from '@/lib/utils';

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot='switch'
      className={cn(
        'peer relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-none border-0 shadow-none transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan/50 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-cyan data-[state=unchecked]:bg-neutral-700',
        className,
      )}
      {...props}>
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none absolute top-1 bottom-1 left-1 block w-3 rounded-none bg-black shadow-none ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0',
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
