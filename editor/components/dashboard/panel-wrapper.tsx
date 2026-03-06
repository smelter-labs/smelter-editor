'use client';

import { forwardRef, type ReactNode } from 'react';
import { GripHorizontal } from 'lucide-react';
import type { PanelId } from './panel-registry';
import { PANEL_DEFINITIONS } from './panel-registry';

interface PanelWrapperProps {
  panelId: PanelId;
  isEditMode: boolean;
  children: ReactNode;
  panelContent: ReactNode;
  style?: React.CSSProperties;
  className?: string;
  onMouseDown?: React.MouseEventHandler;
  onMouseUp?: React.MouseEventHandler;
  onTouchEnd?: React.TouchEventHandler;
}

const PanelWrapper = forwardRef<HTMLDivElement, PanelWrapperProps>(
  function PanelWrapper(
    { panelId, isEditMode, children, panelContent, style, className, ...rest },
    ref,
  ) {
    const def = PANEL_DEFINITIONS[panelId];

    return (
      <div
        ref={ref}
        style={style}
        className={`${className ?? ''} flex flex-col rounded-lg overflow-visible transition-colors ${
          isEditMode
            ? 'border border-neutral-600 ring-1 ring-neutral-700/50'
            : 'bg-neutral-900 border border-neutral-800'
        }`}
        {...rest}>
        {isEditMode && (
          <div className='dashboard-drag-handle flex items-center gap-2 px-3 h-7 bg-neutral-900/90 border-b border-neutral-700 cursor-grab active:cursor-grabbing shrink-0 select-none'>
            <GripHorizontal className='w-3.5 h-3.5 text-neutral-500' />
            <span className='text-[11px] font-medium text-neutral-400 uppercase tracking-wider'>
              {def.title}
            </span>
          </div>
        )}
        <div className='flex-1 min-h-0 overflow-hidden'>{panelContent}</div>
        {children}
      </div>
    );
  },
);

export default PanelWrapper;
