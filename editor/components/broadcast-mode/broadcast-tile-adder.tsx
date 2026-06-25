'use client';

import React, { useState, useMemo } from 'react';
import type { Input, Layer } from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input as InputField } from '@/components/ui/input';
import { Check } from 'lucide-react';

interface BroadcastTileAdderProps {
  isOpen: boolean;
  inputs: Input[];
  layers: Layer[];
  existingTileTargets: Set<string>;
  onAddTile: (type: 'input' | 'layer', targetId: string) => void;
  onClose: () => void;
}

export default function BroadcastTileAdder({
  isOpen,
  inputs,
  layers,
  existingTileTargets,
  onAddTile,
  onClose,
}: BroadcastTileAdderProps) {
  const [activeTab, setActiveTab] = useState<'inputs' | 'layers'>('inputs');
  const [searchInput, setSearchInput] = useState('');
  const [searchLayer, setSearchLayer] = useState('');

  // Filter inputs
  const filteredInputs = useMemo(
    () =>
      inputs.filter(
        (input) =>
          !existingTileTargets.has(`input-${input.inputId}`) &&
          input.title.toLowerCase().includes(searchInput.toLowerCase()),
      ),
    [inputs, searchInput, existingTileTargets],
  );

  // Filter layers
  const filteredLayers = useMemo(
    () =>
      layers.filter(
        (layer) =>
          !existingTileTargets.has(`layer-${layer.id}`) &&
          layer.id.toLowerCase().includes(searchLayer.toLowerCase()),
      ),
    [layers, searchLayer, existingTileTargets],
  );

  const handleAddInput = (inputId: string) => {
    onAddTile('input', inputId);
  };

  const handleAddLayer = (layerId: string) => {
    onAddTile('layer', layerId);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>Add Broadcast Tile</DialogTitle>
          <DialogDescription>
            Select an input or layer to add to broadcast
          </DialogDescription>
        </DialogHeader>

        {/* Custom Tabs */}
        <div className='space-y-3'>
          <div className='flex gap-2 border-b border-gray-700'>
            <button
              onClick={() => setActiveTab('inputs')}
              className={`px-4 py-2 font-medium text-sm transition-colors ${
                activeTab === 'inputs'
                  ? 'border-b-2 border-blue-500 text-blue-500'
                  : 'text-gray-400 hover:text-gray-300'
              }`}>
              Inputs
            </button>
            <button
              onClick={() => setActiveTab('layers')}
              className={`px-4 py-2 font-medium text-sm transition-colors ${
                activeTab === 'layers'
                  ? 'border-b-2 border-blue-500 text-blue-500'
                  : 'text-gray-400 hover:text-gray-300'
              }`}>
              Layers
            </button>
          </div>

          {/* Inputs Tab */}
          {activeTab === 'inputs' && (
            <div className='space-y-3'>
              <InputField
                placeholder='Search inputs...'
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className='bg-gray-800 border-gray-700'
              />
              <div className='h-[300px] border border-gray-700 rounded overflow-y-auto'>
                <div className='p-3 space-y-2'>
                  {filteredInputs.length === 0 ? (
                    <p className='text-sm text-gray-400 text-center py-8'>
                      No inputs available
                    </p>
                  ) : (
                    filteredInputs.map((input) => (
                      <div
                        key={input.inputId}
                        className='flex items-center justify-between p-2 bg-gray-800 hover:bg-gray-700 rounded cursor-pointer transition-colors'
                        onClick={() => handleAddInput(input.inputId)}>
                        <div className='flex items-center gap-2 flex-1 min-w-0'>
                          <span className='text-sm'>🎬</span>
                          <div className='flex-1 min-w-0'>
                            <p className='text-sm font-medium truncate'>
                              {input.title}
                            </p>
                            <p className='text-xs text-gray-400 truncate'>
                              {input.type}
                            </p>
                          </div>
                        </div>
                        <Check
                          size={16}
                          className='text-blue-500 flex-shrink-0'
                        />
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Layers Tab */}
          {activeTab === 'layers' && (
            <div className='space-y-3'>
              <InputField
                placeholder='Search layers...'
                value={searchLayer}
                onChange={(e) => setSearchLayer(e.target.value)}
                className='bg-gray-800 border-gray-700'
              />
              <div className='h-[300px] border border-gray-700 rounded overflow-y-auto'>
                <div className='p-3 space-y-2'>
                  {filteredLayers.length === 0 ? (
                    <p className='text-sm text-gray-400 text-center py-8'>
                      No layers available
                    </p>
                  ) : (
                    filteredLayers.map((layer) => (
                      <div
                        key={layer.id}
                        className='flex items-center justify-between p-2 bg-gray-800 hover:bg-gray-700 rounded cursor-pointer transition-colors'
                        onClick={() => handleAddLayer(layer.id)}>
                        <div className='flex items-center gap-2 flex-1 min-w-0'>
                          <span className='text-sm'>🎞️</span>
                          <div className='flex-1 min-w-0'>
                            <p className='text-sm font-medium truncate'>
                              {layer.id}
                            </p>
                            <p className='text-xs text-gray-400'>
                              {layer.inputs.length} input
                              {layer.inputs.length !== 1 ? 's' : ''}
                            </p>
                          </div>
                        </div>
                        <Check
                          size={16}
                          className='text-blue-500 flex-shrink-0'
                        />
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className='flex justify-end gap-2'>
          <Button variant='outline' onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
