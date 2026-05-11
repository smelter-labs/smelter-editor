'use client';

import { useCallback, useState } from 'react';
import type { Input, Layer } from '@/lib/types';
import type { Resolution } from '@/lib/resolution';
import { useActions } from '../contexts/actions-context';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { ArrowLeft, ListChecks, RotateCcw } from 'lucide-react';
import {
  useCarouselKeyboardEnabledSetting,
  useClapDetectionEnabledSetting,
  useVoiceCommandsEnabledSetting,
} from '@/lib/voice/macroSettings';
import { CarouselInputSelectionDialog } from './CarouselInputSelectionDialog';

type CarouselSettingsInlineProps = {
  layer: Layer;
  layers: Layer[];
  roomId: string;
  inputs: Input[];
  resolution?: Resolution;
  onBack: () => void;
};

const MIN_DURATION_MS = 200;
const MAX_DURATION_MS = 2000;

export function CarouselSettingsInline({
  layer,
  layers,
  roomId,
  inputs,
  resolution,
  onBack,
}: CarouselSettingsInlineProps) {
  const actions = useActions();
  const c = layer.carousel!;
  const active = layer.inputs[c.activeIndex];
  const activeInput =
    active && inputs.find((i) => i.inputId === active.inputId);
  const canCycle = layer.inputs.length >= 2;
  const visibleCount = c.visibleCount ?? 1;
  const gap = c.gap ?? 0;
  const maxVisible = Math.max(1, layer.inputs.length);

  const [editInputsOpen, setEditInputsOpen] = useState(false);
  const [keyboardEnabled, setKeyboardEnabled] =
    useCarouselKeyboardEnabledSetting();
  const [clapEnabled, setClapEnabled] = useClapDetectionEnabledSetting();
  const [voiceCommandsEnabled, setVoiceCommandsEnabled] =
    useVoiceCommandsEnabledSetting();

  const handleNext = useCallback(
    () => actions.carouselAction(roomId, layer.id, 'next'),
    [actions, roomId, layer.id],
  );
  const handlePrev = useCallback(
    () => actions.carouselAction(roomId, layer.id, 'prev'),
    [actions, roomId, layer.id],
  );

  const updateCarousel = useCallback(
    async (patch: Partial<Layer>) => {
      const nextLayers = layers.map((l) =>
        l.id === layer.id ? { ...l, ...patch } : l,
      );
      await actions.updateRoom(roomId, { layers: nextLayers });
    },
    [actions, roomId, layers, layer.id],
  );

  const handleDurationChange = useCallback(
    (durationMs: number) => {
      if (!layer.carousel) return;
      updateCarousel({ carousel: { ...layer.carousel, durationMs } });
    },
    [layer.carousel, updateCarousel],
  );

  const handleVisibleCountChange = useCallback(
    (val: number) => {
      if (!layer.carousel) return;
      const clamped = Math.max(
        1,
        Math.min(val, Math.max(1, layer.inputs.length)),
      );
      updateCarousel({
        carousel: { ...layer.carousel, visibleCount: clamped },
      });
    },
    [layer.carousel, layer.inputs.length, updateCarousel],
  );

  const handleGapChange = useCallback(
    (val: number) => {
      if (!layer.carousel) return;
      const clamped = Math.max(0, Math.min(val, 4096));
      updateCarousel({ carousel: { ...layer.carousel, gap: clamped } });
    },
    [layer.carousel, updateCarousel],
  );

  const handleEasingChange = useCallback(
    (easing: 'linear' | 'cubic_bezier_ease_in_out' | 'bounce') => {
      if (!layer.carousel) return;
      updateCarousel({ carousel: { ...layer.carousel, easing } });
    },
    [layer.carousel, updateCarousel],
  );

  const handleSlotGeometryChange = useCallback(
    async (geometry: {
      x: number;
      y: number;
      width: number;
      height: number;
    }) => {
      const nextLayers = layers.map((l) =>
        l.id === layer.id
          ? {
              ...l,
              inputs: l.inputs.map((inp) => ({
                ...inp,
                x: geometry.x,
                y: geometry.y,
                width: Math.max(20, geometry.width),
                height: Math.max(20, geometry.height),
              })),
            }
          : l,
      );
      await actions.updateRoom(roomId, { layers: nextLayers });
    },
    [actions, roomId, layers, layer.id],
  );

  const slotW = resolution?.width ?? 1920;
  const slotH = resolution?.height ?? 1080;

  return (
    <div className='p-2 space-y-2'>
      <div className='flex items-center justify-between'>
        <button
          type='button'
          onClick={onBack}
          className='flex items-center gap-1 text-xs text-neutral-400 hover:text-white transition-colors'>
          <ArrowLeft className='w-3 h-3' />
          Back to inputs
        </button>
        <button
          type='button'
          onClick={() => setEditInputsOpen(true)}
          className='flex items-center gap-1 text-xs text-neutral-400 hover:text-white transition-colors'>
          <ListChecks className='w-3 h-3' />
          Edit slides
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
          onClick={handlePrev}>
          ← Prev
        </Button>
        <Button
          size='sm'
          variant='outline'
          disabled={!canCycle}
          onClick={handleNext}>
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
          onValueChange={(values: number[]) => handleDurationChange(values[0])}
        />
      </div>

      <div className='space-y-1'>
        <Label className='text-xs text-neutral-400'>
          Visible slides: {visibleCount} / {layer.inputs.length}
        </Label>
        <Slider
          min={1}
          max={maxVisible}
          step={1}
          value={[Math.min(visibleCount, maxVisible)]}
          onValueChange={(values: number[]) =>
            handleVisibleCountChange(values[0])
          }
        />
      </div>

      <div className='space-y-1'>
        <Label className='text-xs text-neutral-400'>Gap: {gap}px</Label>
        <Slider
          min={0}
          max={200}
          step={1}
          value={[gap]}
          onValueChange={(values: number[]) => handleGapChange(values[0])}
        />
      </div>

      <div className='space-y-1'>
        <div className='flex items-center justify-between'>
          <Label className='text-xs text-neutral-400'>
            Position &amp; Size
          </Label>
          <button
            type='button'
            onClick={() =>
              handleSlotGeometryChange({
                x: 0,
                y: 0,
                width: slotW,
                height: slotH,
              })
            }
            disabled={
              (layer.inputs[0]?.x ?? 0) === 0 &&
              (layer.inputs[0]?.y ?? 0) === 0 &&
              (layer.inputs[0]?.width ?? 0) === slotW &&
              (layer.inputs[0]?.height ?? 0) === slotH
            }
            className='flex items-center gap-1 text-[10px] text-neutral-400 hover:text-white disabled:text-neutral-600 disabled:cursor-not-allowed transition-colors cursor-pointer'
            title='Reset to full canvas'>
            <RotateCcw className='size-3' />
          </button>
        </div>
        <div className='grid grid-cols-4 gap-1'>
          {(
            [
              ['x', 'Left', layer.inputs[0]?.x ?? 0],
              ['y', 'Top', layer.inputs[0]?.y ?? 0],
              ['width', 'Width', layer.inputs[0]?.width ?? slotW],
              ['height', 'Height', layer.inputs[0]?.height ?? slotH],
            ] as const
          ).map(([field, label, value]) => (
            <div key={field}>
              <label className='text-[10px] text-neutral-500 block'>
                {label}
              </label>
              <NumberInput
                value={Math.round(value)}
                step={10}
                onChange={(e) => {
                  const slot = layer.inputs[0];
                  if (!slot) return;
                  const val = Number(e.target.value) || 0;
                  handleSlotGeometryChange({
                    x: field === 'x' ? val : slot.x,
                    y: field === 'y' ? val : slot.y,
                    width: field === 'width' ? Math.max(20, val) : slot.width,
                    height:
                      field === 'height' ? Math.max(20, val) : slot.height,
                  });
                }}
              />
            </div>
          ))}
        </div>
      </div>

      <div className='space-y-1'>
        <Label className='text-xs text-neutral-400'>Easing</Label>
        <Select
          value={c.easing ?? 'linear'}
          onValueChange={(v) =>
            handleEasingChange(
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

      <div className='border-t border-neutral-800 pt-2 mt-2 space-y-1'>
        <Label className='text-xs text-neutral-400'>Controls</Label>
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

      <CarouselInputSelectionDialog
        open={editInputsOpen}
        onOpenChange={setEditInputsOpen}
        inputs={inputs}
        carouselLayer={layer}
        layers={layers}
        roomId={roomId}
        resolution={resolution}
      />
    </div>
  );
}
