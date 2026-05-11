'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Input, Layer } from '@/lib/types';
import type { Resolution } from '@/lib/resolution';
import { useActions } from '../contexts/actions-context';
import { useClapDetection } from '@/lib/audio/useClapDetection';
import { useCarouselKeyboard } from '@/lib/keyboard/useCarouselKeyboard';
import { useVoiceCommandsEnabledSetting } from '@/lib/voice/macroSettings';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';

type Props = {
  roomId: string;
  layers: Layer[];
  inputs: Input[];
  resolution?: Resolution;
};

const DEFAULT_DURATION_MS = 400;
const MIN_DURATION_MS = 200;
const MAX_DURATION_MS = 2000;

export function CarouselSection({
  roomId,
  layers,
  inputs,
  resolution,
}: Props) {
  const actions = useActions();
  const carouselLayers = useMemo(
    () => layers.filter((l) => l.carousel),
    [layers],
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [clapEnabled, setClapEnabled] = useState(false);
  const [keyboardEnabled, setKeyboardEnabled] = useState(true);
  const [voiceCommandsEnabled, setVoiceCommandsEnabled] =
    useVoiceCommandsEnabledSetting();
  const firstCarouselLayerId = carouselLayers[0]?.id ?? null;
  const hasActiveCarousel =
    firstCarouselLayerId !== null && (carouselLayers[0]?.inputs.length ?? 0) >= 2;

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

  const handleDurationChange = async (layer: Layer, durationMs: number) => {
    if (!layer.carousel) return;
    const nextLayers: Layer[] = layers.map((l) =>
      l.id === layer.id && l.carousel
        ? { ...l, carousel: { ...l.carousel, durationMs } }
        : l,
    );
    await actions.updateRoom(roomId, { layers: nextLayers });
  };

  const handleEasingChange = async (
    layer: Layer,
    easing: 'linear' | 'cubic_bezier_ease_in_out' | 'bounce',
  ) => {
    if (!layer.carousel) return;
    const nextLayers: Layer[] = layers.map((l) =>
      l.id === layer.id && l.carousel
        ? { ...l, carousel: { ...l.carousel, easing } }
        : l,
    );
    await actions.updateRoom(roomId, { layers: nextLayers });
  };

  const handleRemove = async (layerId: string) => {
    const nextLayers = layers.filter((l) => l.id !== layerId);
    if (nextLayers.length === 0) return;
    await actions.updateRoom(roomId, { layers: nextLayers });
  };

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
    await actions.updateRoom(roomId, { layers: [...layers, newLayer] });
    setCreateOpen(false);
  };

  return (
    <div className='border border-neutral-800 rounded-md p-3 space-y-3 bg-neutral-950'>
      <div className='flex items-center justify-between'>
        <h3 className='text-sm font-semibold text-neutral-200'>Carousels</h3>
        <Button
          size='sm'
          variant='secondary'
          onClick={() => setCreateOpen(true)}
          disabled={inputs.length < 2}>
          + New
        </Button>
      </div>

      {carouselLayers.length === 0 && (
        <p className='text-xs text-neutral-500'>
          No carousels yet. Add 2+ inputs and click + New.
        </p>
      )}

      {carouselLayers.length > 0 && (
        <div className='flex flex-col gap-1 border-t border-neutral-800 pt-2'>
          <label className='flex items-center justify-between gap-2 text-xs text-neutral-300'>
            <span>Keyboard (←/→/Space)</span>
            <Switch
              checked={keyboardEnabled}
              onCheckedChange={setKeyboardEnabled}
            />
          </label>
          <label className='flex items-center justify-between gap-2 text-xs text-neutral-300'>
            <span>Clap detection (mic)</span>
            <Switch checked={clapEnabled} onCheckedChange={setClapEnabled} />
          </label>
          <label className='flex items-center justify-between gap-2 text-xs text-neutral-300'>
            <span>Voice (mic panel)</span>
            <Switch
              checked={voiceCommandsEnabled}
              onCheckedChange={setVoiceCommandsEnabled}
            />
          </label>
          <p className='text-[10px] text-neutral-500'>
            Then click the mic at the bottom and say &ldquo;next slide&rdquo; /
            &ldquo;previous slide&rdquo;.
          </p>
        </div>
      )}

      {carouselLayers.map((layer) => {
        const c = layer.carousel!;
        const active = layer.inputs[c.activeIndex];
        const activeInput = active && inputs.find((i) => i.inputId === active.inputId);
        const canCycle = layer.inputs.length >= 2;
        return (
          <div
            key={layer.id}
            className='border border-neutral-800 rounded p-2 space-y-2'>
            <div className='flex items-center justify-between'>
              <span className='text-xs text-neutral-300 font-mono truncate'>
                {layer.id.slice(0, 8)}
              </span>
              <button
                type='button'
                aria-label='Remove carousel'
                className='text-xs text-red-400 hover:text-red-300'
                onClick={() => handleRemove(layer.id)}>
                ✕
              </button>
            </div>

            <div className='text-xs text-neutral-400'>
              Active:{' '}
              <span className='text-neutral-200'>
                {activeInput?.title ?? `slide ${c.activeIndex + 1}`}
              </span>{' '}
              ({c.activeIndex + 1} / {layer.inputs.length})
            </div>

            <div className='flex gap-2'>
              <Button
                size='sm'
                variant='outline'
                disabled={!canCycle}
                onClick={() => handlePrev(layer.id)}>
                ← Prev
              </Button>
              <Button
                size='sm'
                variant='outline'
                disabled={!canCycle}
                onClick={() => handleNext(layer.id)}>
                Next →
              </Button>
            </div>

            <div className='space-y-1'>
              <Label className='text-xs text-neutral-400'>
                Duration: {c.durationMs}ms
              </Label>
              <Slider
                min={MIN_DURATION_MS}
                max={MAX_DURATION_MS}
                step={50}
                value={[c.durationMs]}
                onValueChange={(values: number[]) =>
                  handleDurationChange(layer, values[0])
                }
              />
            </div>

            <div className='space-y-1'>
              <Label className='text-xs text-neutral-400'>Easing</Label>
              <Select
                value={c.easing ?? 'linear'}
                onValueChange={(v) =>
                  handleEasingChange(
                    layer,
                    v as 'linear' | 'cubic_bezier_ease_in_out' | 'bounce',
                  )
                }>
                <SelectTrigger className='h-8 text-xs'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='linear'>Linear</SelectItem>
                  <SelectItem value='cubic_bezier_ease_in_out'>
                    Ease in/out
                  </SelectItem>
                  <SelectItem value='bounce'>Bounce</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        );
      })}

      <CreateCarouselDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        inputs={inputs}
        onCreate={handleCreate}
      />
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
