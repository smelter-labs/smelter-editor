'use client';

import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Trash2,
  Pencil,
} from 'lucide-react';
import { Input as ShadcnInput } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { TrackGroup } from '../hooks/use-timeline-state';
import { IconPicker } from './IconPicker';
import { getGroupIcon } from './track-icons';
import type { TrackIconKey } from './track-icons';

type TimelineGroupHeaderProps = {
  group: TrackGroup;
  width: number;
  height: number;
  childCount: number;
  onToggleCollapsed: () => void;
  onRename: (label: string) => void;
  onSetIcon: (icon: TrackIconKey) => void;
  onDelete: () => void;
  onPointerDownGrip?: (e: ReactPointerEvent<SVGElement>) => void;
  isBeingDragged?: boolean;
  showDropIndicator?: boolean;
};

export function TimelineGroupHeader({
  group,
  width,
  height,
  childCount,
  onToggleCollapsed,
  onRename,
  onSetIcon,
  onDelete,
  onPointerDownGrip,
  isBeingDragged,
  showDropIndicator,
}: TimelineGroupHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [labelDraft, setLabelDraft] = useState(group.label);
  const Icon = getGroupIcon(group.icon, group.collapsed);

  const commitRename = () => {
    const trimmed = labelDraft.trim();
    if (trimmed && trimmed !== group.label) onRename(trimmed);
    setEditing(false);
  };

  return (
    <div
      className={`flex flex-col border-b border-border/50 group/group relative ${
        isBeingDragged ? 'bg-blue-500/10' : ''
      }`}>
      {showDropIndicator && (
        <div className='absolute left-0 right-0 top-0 h-0.5 bg-blue-500 z-20 pointer-events-none' />
      )}
      <div className='flex' style={{ height }}>
        <div
          className='shrink-0 bg-muted/60 flex items-center gap-1.5 px-2 sticky left-0 z-10 border-r border-border/30'
          style={{ width }}>
          <GripVertical
            className='w-3 h-3 shrink-0 text-muted-foreground/50 opacity-0 group-hover/group:opacity-100 transition-opacity cursor-grab active:cursor-grabbing'
            onPointerDown={onPointerDownGrip}
          />
          <button
            type='button'
            aria-label={group.collapsed ? 'Expand group' : 'Collapse group'}
            onClick={onToggleCollapsed}
            className='shrink-0 inline-flex items-center justify-center h-5 w-5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 cursor-pointer'>
            {group.collapsed ? (
              <ChevronRight className='w-3.5 h-3.5' />
            ) : (
              <ChevronDown className='w-3.5 h-3.5' />
            )}
          </button>
          <IconPicker
            value={group.icon}
            fallbackKey={group.collapsed ? 'folder' : 'folder-open'}
            onChange={onSetIcon}
            ariaLabel='Change group icon'
          />
          {editing ? (
            <ShadcnInput
              autoFocus
              className='text-sm bg-card border border-border rounded px-1 py-0.5 flex-1 min-w-0 outline-none focus:border-blue-500'
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                else if (e.key === 'Escape') {
                  setLabelDraft(group.label);
                  setEditing(false);
                }
              }}
              onBlur={commitRename}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className='text-sm font-medium text-foreground/90 truncate flex-1'
              onDoubleClick={(e) => {
                e.stopPropagation();
                setLabelDraft(group.label);
                setEditing(true);
              }}>
              {group.label}
              <span className='ml-1.5 text-xs text-muted-foreground'>
                ({childCount})
              </span>
            </span>
          )}
          {!editing && (
            <div className='flex items-center gap-0.5 opacity-0 group-hover/group:opacity-100 transition-opacity'>
              <Button
                variant='ghost'
                size='icon'
                aria-label='Rename group'
                className='h-5 w-5 cursor-pointer'
                onClick={(e) => {
                  e.stopPropagation();
                  setLabelDraft(group.label);
                  setEditing(true);
                }}>
                <Pencil className='w-3 h-3' />
              </Button>
              <Button
                variant='ghost'
                size='icon'
                aria-label='Ungroup tracks'
                title='Ungroup (keep tracks)'
                className='h-5 w-5 cursor-pointer text-muted-foreground hover:text-red-400'
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}>
                <Trash2 className='w-3 h-3' />
              </Button>
            </div>
          )}
        </div>
        {/* Right side spans across timeline; visually empty header band. */}
        <div className='flex-1 bg-muted/20' />
      </div>
    </div>
  );
}
