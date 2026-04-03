'use client';

import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { CheckIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot='checkbox'
      className={cn(
        'peer relative flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-none border-0 bg-neutral-700 shadow-none transition-colors outline-none focus-visible:ring-1 focus-visible:ring-cyan/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-cyan data-[state=checked]:text-black',
        className,
      )}
      {...props}>
      <CheckboxPrimitive.Indicator className='grid place-content-center text-current transition-none [&>svg]:size-3.5 [&>svg]:stroke-[3]'>
        <CheckIcon />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
