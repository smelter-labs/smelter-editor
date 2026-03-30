'use client';

import * as React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';

import { cn } from '@/lib/utils';

function Slider({
  className,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      data-slot='slider'
      className={cn(
        'relative flex w-full touch-none select-none items-center',
        className,
      )}
      {...props}>
      <SliderPrimitive.Track className='relative h-1.5 w-full grow overflow-hidden rounded-full bg-neutral-800'>
        <SliderPrimitive.Range className='absolute h-full bg-cyan shadow-[0_0_8px_rgba(0,243,255,0.6)]' />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className='block h-4 w-4 rounded-full bg-cyan border border-black shadow-[0_0_6px_rgba(0,243,255,0.4)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan/50 disabled:pointer-events-none disabled:opacity-50' />
    </SliderPrimitive.Root>
  );
}

export { Slider };
