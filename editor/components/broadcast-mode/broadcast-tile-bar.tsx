'use client';

import React from 'react';
import type { BroadcastTile } from '@smelter-editor/types';
import { Button } from '@/components/ui/button';
import { X, Plus } from 'lucide-react';

interface BroadcastTileBarProps {
  tiles: BroadcastTile[];
  selectedTileId: string | null;
  isEditMode: boolean;
  onSelectTile: (tileId: string | null) => void;
  onDeleteTile: (tileId: string) => void;
  onAddTile: () => void;
}

export default function BroadcastTileBar({
  tiles,
  selectedTileId,
  isEditMode,
  onSelectTile,
  onDeleteTile,
  onAddTile,
}: BroadcastTileBarProps) {
  return (
    <div className='bg-gray-900 border-t border-gray-700 p-3 flex gap-2 overflow-x-auto'>
      {/* Tile List */}
      {tiles.map((tile) => {
        const isSelected = selectedTileId === tile.id;
        const typeIcon = tile.type === 'input' ? '🎬' : '🎞️';

        return (
          <div
            key={tile.id}
            role={!isEditMode ? 'button' : undefined}
            tabIndex={!isEditMode ? 0 : undefined}
            className={`
              flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded
              transition-colors duration-200
              ${!isEditMode ? 'cursor-pointer' : ''}
              ${
                isSelected
                  ? 'bg-blue-600 hover:bg-blue-700'
                  : 'bg-gray-800 hover:bg-gray-700'
              }
            `}
            onClick={!isEditMode ? () => onSelectTile(tile.id) : undefined}
            onKeyDown={
              !isEditMode
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectTile(tile.id);
                    }
                  }
                : undefined
            }>
            <span className='text-sm'>{typeIcon}</span>
            <span className='text-sm font-medium truncate max-w-[120px]'>
              {tile.name}
            </span>
            {isEditMode && (
              <button
                type='button'
                onClick={() => onDeleteTile(tile.id)}
                className='ml-1 p-1 hover:bg-red-600 rounded transition-colors'
                aria-label='Delete tile'>
                <X size={14} />
              </button>
            )}
          </div>
        );
      })}

      {/* Add Button */}
      <Button
        size='sm'
        variant='outline'
        onClick={onAddTile}
        className='flex-shrink-0 gap-1'>
        <Plus size={16} />
        <span className='hidden sm:inline'>Add</span>
      </Button>
    </div>
  );
}
