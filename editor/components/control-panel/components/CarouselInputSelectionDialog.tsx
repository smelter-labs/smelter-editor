'use client';

import { useState, useEffect, useMemo } from 'react';
import type { Input, Layer } from '@/lib/types';
import type { Resolution } from '@/lib/resolution';
import { computeLayout } from '@smelter-editor/types';
import { useActions } from '../contexts/actions-context';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  inputs: Input[];
  carouselLayer: Layer;
  layers: Layer[];
  roomId: string;
  resolution?: Resolution;
};

export function CarouselInputSelectionDialog({
  open,
  onOpenChange,
  inputs,
  carouselLayer,
  layers,
  roomId,
  resolution,
}: Props) {
  const actions = useActions();
  const currentInputIds = useMemo(
    () => new Set(carouselLayer.inputs.map((li) => li.inputId)),
    [carouselLayer.inputs],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      setSelected(new Set(currentInputIds));
    }
  }, [open, currentInputIds]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    if (selected.size < 2) return;

    const slotW = resolution?.width ?? 1920;
    const slotH = resolution?.height ?? 1080;
    const slotGeometry = carouselLayer.inputs[0] ?? {
      x: 0,
      y: 0,
      width: slotW,
      height: slotH,
    };

    const addedIds = new Set(
      [...selected].filter((id) => !currentInputIds.has(id)),
    );
    const removedIds = new Set(
      [...currentInputIds].filter((id) => !selected.has(id)),
    );

    const orderedSelected = inputs
      .filter((i) => selected.has(i.inputId))
      .map((i) => i.inputId);

    let updatedLayers = layers.map((layer) => {
      if (layer.id === carouselLayer.id) {
        return {
          ...layer,
          inputs: orderedSelected.map((inputId) => {
            const existing = carouselLayer.inputs.find(
              (li) => li.inputId === inputId,
            );
            return (
              existing ?? {
                inputId,
                x: slotGeometry.x,
                y: slotGeometry.y,
                width: slotGeometry.width,
                height: slotGeometry.height,
              }
            );
          }),
        };
      }

      if (addedIds.size === 0) return layer;

      const filtered = layer.inputs.filter(
        (li) => !addedIds.has(li.inputId),
      );
      return filtered.length === layer.inputs.length
        ? layer
        : { ...layer, inputs: filtered };
    });

    const res = { width: slotW, height: slotH };
    updatedLayers = updatedLayers.map((l) => {
      if (!l.behavior || l.carousel) return l;
      const original = layers.find((orig) => orig.id === l.id);
      if (!original || original.inputs.length === l.inputs.length) return l;
      try {
        const layerInputInfos = l.inputs
          .map((li) => {
            const inp = inputs.find((i) => i.inputId === li.inputId);
            return inp
              ? {
                  inputId: inp.inputId,
                  nativeWidth: inp.nativeWidth,
                  nativeHeight: inp.nativeHeight,
                }
              : null;
          })
          .filter((bi): bi is NonNullable<typeof bi> => !!bi);
        const result = computeLayout(l.behavior, layerInputInfos, res);
        return { ...l, inputs: result.inputs };
      } catch {
        return l;
      }
    });

    await actions.updateRoom(roomId, { layers: updatedLayers });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Carousel Slides</DialogTitle>
        </DialogHeader>
        <div className='space-y-3'>
          <p className='text-xs text-neutral-400'>
            Select at least 2 inputs for the carousel.
          </p>
          <div className='max-h-64 overflow-y-auto space-y-1 border border-neutral-800 rounded p-2'>
            {inputs.length === 0 && (
              <p className='text-xs text-neutral-500'>No inputs available.</p>
            )}
            {inputs.map((input) => (
              <label
                key={input.inputId}
                className='flex items-center gap-2 cursor-pointer hover:bg-neutral-900 rounded px-1 py-0.5'>
                <Checkbox
                  checked={selected.has(input.inputId)}
                  onCheckedChange={() => toggle(input.inputId)}
                />
                <span className='text-xs text-neutral-200 truncate'>
                  {input.title || input.inputId}
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className='flex justify-end gap-2 pt-2'>
          <Button variant='ghost' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={selected.size < 2} onClick={handleSave}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
