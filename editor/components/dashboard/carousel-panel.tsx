'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Input, Layer } from '@/lib/types';
import type { Resolution } from '@/lib/resolution';
import { computeLayout } from '@smelter-editor/types';
import { useActions } from '@/components/control-panel/contexts/actions-context';
import { useClapDetection } from '@/lib/audio/useClapDetection';
import { useCarouselKeyboard } from '@/lib/keyboard/useCarouselKeyboard';
import {
  useCarouselKeyboardEnabledSetting,
  useClapDetectionEnabledSetting,
} from '@/lib/voice/macroSettings';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CarouselSettingsInline } from '@/components/control-panel/components/CarouselSettingsInline';

type Props = {
  roomId: string;
  layers: Layer[];
  inputs: Input[];
  resolution?: Resolution;
};

const DEFAULT_DURATION_MS = 400;
const MIN_DURATION_MS = 200;
const MAX_DURATION_MS = 2000;

export function CarouselPanel({ roomId, layers, inputs, resolution }: Props) {
  const actions = useActions();
  const carouselLayers = useMemo(
    () => layers.filter((l) => l.carousel),
    [layers],
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [keyboardEnabled] = useCarouselKeyboardEnabledSetting();
  const [clapEnabled] = useClapDetectionEnabledSetting();
  const firstCarouselLayerId = carouselLayers[0]?.id ?? null;
  const hasActiveCarousel =
    firstCarouselLayerId !== null &&
    (carouselLayers[0]?.inputs.length ?? 0) >= 2;

  const handleNext = useCallback(
    (layerId: string) => actions.carouselAction(roomId, layerId, 'next'),
    [actions, roomId],
  );
  const handlePrev = useCallback(
    (layerId: string) => actions.carouselAction(roomId, layerId, 'prev'),
    [actions, roomId],
  );

  const onFirstNext = useCallback(() => {
    if (firstCarouselLayerId) handleNext(firstCarouselLayerId);
  }, [firstCarouselLayerId, handleNext]);
  const onFirstPrev = useCallback(() => {
    if (firstCarouselLayerId) handlePrev(firstCarouselLayerId);
  }, [firstCarouselLayerId, handlePrev]);

  useEffect(() => {
    if (!firstCarouselLayerId) return;
    window.addEventListener('smelter:voice:carousel-next', onFirstNext);
    window.addEventListener('smelter:voice:carousel-prev', onFirstPrev);
    window.addEventListener('smelter:carousel:next', onFirstNext);
    window.addEventListener('smelter:carousel:prev', onFirstPrev);
    return () => {
      window.removeEventListener('smelter:voice:carousel-next', onFirstNext);
      window.removeEventListener('smelter:voice:carousel-prev', onFirstPrev);
      window.removeEventListener('smelter:carousel:next', onFirstNext);
      window.removeEventListener('smelter:carousel:prev', onFirstPrev);
    };
  }, [firstCarouselLayerId, onFirstNext, onFirstPrev]);

  useClapDetection({
    enabled: clapEnabled && hasActiveCarousel,
    onClap: onFirstNext,
  });

  useCarouselKeyboard({
    enabled: keyboardEnabled && hasActiveCarousel,
    onNext: onFirstNext,
    onPrev: onFirstPrev,
  });

  const [selectedCarouselLayerId, setSelectedCarouselLayerId] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (carouselLayers.length === 0) {
      if (selectedCarouselLayerId !== null) setSelectedCarouselLayerId(null);
      return;
    }
    if (
      !selectedCarouselLayerId ||
      !carouselLayers.some((l) => l.id === selectedCarouselLayerId)
    ) {
      setSelectedCarouselLayerId(carouselLayers[0].id);
    }
  }, [carouselLayers, selectedCarouselLayerId]);

  const selectedLayer = carouselLayers.find(
    (l) => l.id === selectedCarouselLayerId,
  );

  const handleCreate = async (selectedIds: string[], durationMs: number) => {
    if (selectedIds.length < 2) return;
    const slotW = resolution?.width ?? 1920;
    const slotH = resolution?.height ?? 1080;
    const newLayer: Layer = {
      id: uuidv4(),
      inputs: selectedIds.map((inputId) => ({
        inputId,
        x: 0,
        y: 0,
        width: slotW,
        height: slotH,
      })),
      carousel: {
        activeIndex: 0,
        durationMs,
        easing: 'cubic_bezier_ease_in_out',
      },
    };
    const idsToRemove = new Set(selectedIds);
    let cleanedLayers = layers.map((layer) => {
      const filtered = layer.inputs.filter(
        (li) => !idsToRemove.has(li.inputId),
      );
      return filtered.length === layer.inputs.length
        ? layer
        : { ...layer, inputs: filtered };
    });

    const res = { width: slotW, height: slotH };
    cleanedLayers = cleanedLayers.map((l) => {
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

    await actions.updateRoom(roomId, { layers: [...cleanedLayers, newLayer] });
    setCreateOpen(false);
  };

  if (carouselLayers.length === 0) {
    return (
      <div className='h-full overflow-y-auto p-3 space-y-3'>
        <p className='text-xs text-neutral-500'>
          No carousel yet. Add 2+ inputs and create one.
        </p>
        <Button
          size='sm'
          variant='secondary'
          onClick={() => setCreateOpen(true)}
          disabled={inputs.length < 2}>
          Create Carousel
        </Button>

        <CreateCarouselDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          inputs={inputs}
          onCreate={handleCreate}
        />
      </div>
    );
  }

  return (
    <div className='h-full overflow-y-auto p-3 space-y-3'>
      {carouselLayers.length > 1 && (
        <div className='space-y-1'>
          <Label className='text-xs text-neutral-400'>Carousel</Label>
          <Select
            value={selectedCarouselLayerId ?? carouselLayers[0].id}
            onValueChange={setSelectedCarouselLayerId}>
            <SelectTrigger className='h-8 text-xs'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {carouselLayers.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  Carousel · Layer {layers.indexOf(l) + 1}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {selectedLayer && (
        <CarouselSettingsInline
          key={selectedLayer.id}
          layer={selectedLayer}
          layers={layers}
          roomId={roomId}
          inputs={inputs}
          resolution={resolution}
        />
      )}
    </div>
  );
}

function CreateCarouselDialog({
  open,
  onOpenChange,
  inputs,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  inputs: Input[];
  onCreate: (selectedIds: string[], durationMs: number) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [duration, setDuration] = useState(DEFAULT_DURATION_MS);

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setDuration(DEFAULT_DURATION_MS);
    }
  }, [open]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const orderedSelected = useMemo(
    () => inputs.filter((i) => selected.has(i.inputId)).map((i) => i.inputId),
    [inputs, selected],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Carousel</DialogTitle>
        </DialogHeader>
        <div className='space-y-3'>
          <p className='text-xs text-neutral-400'>
            Pick at least 2 inputs. They will be shown one at a time with a
            slide transition.
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

          <div className='space-y-1'>
            <Label className='text-xs text-neutral-400'>
              Duration: {duration}ms
            </Label>
            <Slider
              min={MIN_DURATION_MS}
              max={MAX_DURATION_MS}
              step={50}
              value={[duration]}
              onValueChange={(v: number[]) => setDuration(v[0])}
            />
          </div>
        </div>
        <div className='flex justify-end gap-2 pt-2'>
          <Button variant='ghost' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={selected.size < 2}
            onClick={() => onCreate(orderedSelected, duration)}>
            Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
