'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { RoomState } from '@/lib/types';
import OutputStream from '@/components/output-stream';
import { Button } from '@/components/ui/button';
import { useBroadcastTiles } from '@/hooks/use-broadcast-tiles';
import BroadcastTileBar from './broadcast-tile-bar';
import BroadcastTileAdder from './broadcast-tile-adder';
import { Edit2, X } from 'lucide-react';

interface BroadcastModeScreenProps {
  roomState: RoomState;
  whepUrl: string;
  roomId: string;
}

export default function BroadcastModeScreen({
  roomState,
  whepUrl,
  roomId,
}: BroadcastModeScreenProps) {
  const [isAdderOpen, setIsAdderOpen] = useState(false);
  const {
    tiles,
    selectedTileId,
    isEditMode,
    addTile,
    removeTile,
    selectTile,
    updateTileName,
    toggleEditMode,
    syncWithServerState,
  } = useBroadcastTiles(roomId);

  // Sync with server state when roomState changes
  useEffect(() => {
    if (
      roomState.broadcastTiles &&
      roomState.selectedBroadcastTileId !== undefined
    ) {
      syncWithServerState(
        roomState.broadcastTiles,
        roomState.selectedBroadcastTileId,
      );
    }
  }, [
    roomState.broadcastTiles,
    roomState.selectedBroadcastTileId,
    syncWithServerState,
  ]);

  // Update tile names when inputs/layers change
  useEffect(() => {
    tiles.forEach((tile) => {
      if (tile.type === 'input') {
        const input = roomState.inputs.find((i) => i.inputId === tile.targetId);
        if (input && input.title !== tile.name) {
          updateTileName(tile.id, input.title);
        }
      } else if (tile.type === 'layer') {
        const layer = roomState.layers.find((l) => l.id === tile.targetId);
        if (layer && layer.id !== tile.name) {
          updateTileName(tile.id, layer.id);
        }
      }
    });
  }, [roomState.inputs, roomState.layers, tiles, updateTileName]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const selectedTile = tiles.find((t) => t.id === selectedTileId);
  const selectedTileName = selectedTile?.name || '';

  const handleAddTile = useCallback(
    (type: 'input' | 'layer', targetId: string) => {
      let name = targetId;
      if (type === 'input') {
        const input = roomState.inputs.find((i) => i.inputId === targetId);
        name = input?.title || targetId;
      } else if (type === 'layer') {
        const layer = roomState.layers.find((l) => l.id === targetId);
        name = layer?.id || targetId;
      }
      addTile(type, targetId, name);
      setIsAdderOpen(false);
    },
    [roomState.inputs, roomState.layers, addTile],
  );

  return (
    <div className='flex flex-col h-screen w-full bg-black text-white'>
      {/* Header */}
      <div className='flex items-center justify-between p-4 bg-gray-900 border-b border-gray-700'>
        <h1 className='text-xl font-semibold'>Broadcast Mode</h1>
        <div className='flex gap-2'>
          {tiles.length > 0 && (
            <Button
              size='sm'
              variant={isEditMode ? 'default' : 'outline'}
              onClick={toggleEditMode}
              className='gap-2'>
              <Edit2 size={16} />
              {isEditMode ? 'Done' : 'Edit'}
            </Button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className='flex-1 flex flex-col overflow-hidden'>
        {tiles.length === 0 ? (
          <div className='flex-1 flex flex-col items-center justify-center gap-4'>
            <p className='text-gray-400 text-lg'>No broadcast tiles added</p>
            <Button onClick={() => setIsAdderOpen(true)} className='gap-2'>
              <span>+ Add Tile</span>
            </Button>
          </div>
        ) : selectedTile ? (
          <div className='flex-1 flex flex-col overflow-hidden'>
            {/* Video Display Area */}
            <div className='flex-1 bg-black flex items-center justify-center overflow-hidden relative'>
              <OutputStream
                whepUrl={whepUrl}
                videoRef={videoRef}
                roomId={roomId}
              />
              {/* Tile Label Overlay */}
              <div className='absolute top-4 left-4 bg-black bg-opacity-75 px-3 py-2 rounded text-sm'>
                {selectedTile.type === 'input' ? '🎬 Input' : '🎞️ Layer'}:{' '}
                {selectedTileName}
              </div>
            </div>
          </div>
        ) : (
          <div className='flex-1 flex flex-col items-center justify-center gap-4 bg-gray-900'>
            <p className='text-gray-400'>Selected tile was removed</p>
            <Button onClick={() => selectTile(tiles[0]?.id || null)}>
              Select First Tile
            </Button>
          </div>
        )}
      </div>

      {/* Tile Selector Bar */}
      {tiles.length > 0 && (
        <BroadcastTileBar
          tiles={tiles}
          selectedTileId={selectedTileId}
          isEditMode={isEditMode}
          onSelectTile={selectTile}
          onDeleteTile={removeTile}
          onAddTile={() => setIsAdderOpen(true)}
        />
      )}

      {/* Add Tile Modal */}
      <BroadcastTileAdder
        isOpen={isAdderOpen}
        inputs={roomState.inputs}
        layers={roomState.layers}
        existingTileTargets={
          new Set(tiles.map((t) => `${t.type}-${t.targetId}`))
        }
        onAddTile={handleAddTile}
        onClose={() => setIsAdderOpen(false)}
      />
    </div>
  );
}
