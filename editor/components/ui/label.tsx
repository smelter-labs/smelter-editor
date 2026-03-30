'use client';

import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const labelVariants = cva(
  'text-[10px] font-mono uppercase tracking-wider text-neutral-500 leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
);

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root> &
  VariantProps<typeof labelVariants>) {
  return (
    <LabelPrimitive.Root
      data-slot='label'
      className={cn(labelVariants(), className)}
      {...props}
    />
  );
}

export { Label };
