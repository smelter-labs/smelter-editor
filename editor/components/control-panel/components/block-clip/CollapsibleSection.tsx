'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export function CollapsibleSection({
  title,
  children,
  defaultOpen = true,
  className,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={className}>
      <button
        type='button'
        className='flex items-center gap-1 w-full text-left text-xs text-muted-foreground font-medium mb-2 cursor-pointer hover:text-foreground transition-colors'
        onClick={() => setOpen(!open)}>
        {open ? (
          <ChevronDown className='size-3.5 shrink-0' />
        ) : (
          <ChevronRight className='size-3.5 shrink-0' />
        )}
        {title}
      </button>
      {open && children}
    </div>
  );
}
