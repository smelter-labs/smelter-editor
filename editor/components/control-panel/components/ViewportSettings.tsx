'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { NumberInput } from '@/components/ui/number-input';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { RotateCcw } from 'lucide-react';

type ViewportSettingsProps = {
  resolution: { width: number; height: number };
  viewportTop?: number;
  viewportLeft?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  viewportTransitionDurationMs?: number;
  viewportTransitionEasing?: string;
  onChange: (fields: {
    viewportTop?: number;
    viewportLeft?: number;
    viewportWidth?: number;
    viewportHeight?: number;
    viewportTransitionDurationMs?: number;
    viewportTransitionEasing?: string;
  }) => void;
};

const EASING_OPTIONS = [
  { value: 'linear', label: 'Linear' },
  { value: 'cubic_bezier_ease_in_out', label: 'Ease In/Out' },
  { value: 'bounce', label: 'Bounce' },
] as const;

function zoomFactorFromDimensions(
  vW: number,
  vH: number,
  outW: number,
  outH: number,
): number {
  const zx = vW / outW;
  const zy = vH / outH;
  return (zx + zy) / 2;
}

function dimensionsFromZoom(
  zoom: number,
  outW: number,
  outH: number,
): { viewportWidth: number; viewportHeight: number; viewportTop: number; viewportLeft: number } {
  const vW = Math.round(outW * zoom);
  const vH = Math.round(outH * zoom);
  const viewportTop = Math.round((outH - vH) / 2);
  const viewportLeft = Math.round((outW - vW) / 2);
  return { viewportWidth: vW, viewportHeight: vH, viewportTop, viewportLeft };
}

export function ViewportSettings({
  resolution,
  viewportTop,
  viewportLeft,
  viewportWidth,
  viewportHeight,
  viewportTransitionDurationMs,
  viewportTransitionEasing,
  onChange,
}: ViewportSettingsProps) {
  const { width: outW, height: outH } = resolution;

  const vT = viewportTop ?? 0;
  const vL = viewportLeft ?? 0;
  const vW = viewportWidth ?? outW;
  const vH = viewportHeight ?? outH;
  const tDur = viewportTransitionDurationMs ?? 300;
  const easing = viewportTransitionEasing ?? 'linear';

  const isDefault = vT === 0 && vL === 0 && vW === outW && vH === outH;

  const zoomFactor = zoomFactorFromDimensions(vW, vH, outW, outH);

  const [localZoom, setLocalZoom] = useState(zoomFactor);
  const [localDuration, setLocalDuration] = useState(tDur);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const durationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalZoom(zoomFactor);
  }, [zoomFactor]);

  useEffect(() => {
    setLocalDuration(tDur);
  }, [tDur]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (durationDebounceRef.current) clearTimeout(durationDebounceRef.current);
    };
  }, []);

  const handleZoomChange = useCallback(
    (newZoom: number) => {
      setLocalZoom(newZoom);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onChange(dimensionsFromZoom(newZoom, outW, outH));
      }, 150);
    },
    [onChange, outW, outH],
  );

  const handleDurationChange = useCallback(
    (value: number) => {
      setLocalDuration(value);
      if (durationDebounceRef.current) clearTimeout(durationDebounceRef.current);
      durationDebounceRef.current = setTimeout(() => {
        onChange({ viewportTransitionDurationMs: value });
      }, 150);
    },
    [onChange],
  );

  const handleReset = useCallback(() => {
    onChange({
      viewportTop: 0,
      viewportLeft: 0,
      viewportWidth: outW,
      viewportHeight: outH,
    });
  }, [onChange, outW, outH]);

  const handleFieldChange = useCallback(
    (field: string, rawValue: string) => {
      const val = parseInt(rawValue, 10);
      if (isNaN(val)) return;
      onChange({ [field]: val });
    },
    [onChange],
  );

  const PREVIEW_W = 200;
  const scale = PREVIEW_W / outW;
  const previewH = Math.round(outH * scale);

  const rectStyle = {
    left: vL * scale,
    top: vT * scale,
    width: vW * scale,
    height: vH * scale,
  };

  return (
    <div className='space-y-3'>
      {/* Mini preview */}
      <div
        className='relative mx-auto border border-neutral-700 bg-neutral-950 overflow-hidden'
        style={{ width: PREVIEW_W, height: previewH }}>
        <div
          className='absolute border-2 border-cyan/60 bg-cyan/10 transition-all duration-150'
          style={rectStyle}
        />
        {isDefault && (
          <span className='absolute inset-0 flex items-center justify-center text-[9px] text-neutral-600 select-none'>
            1:1 (no transform)
          </span>
        )}
      </div>

      {/* Zoom slider */}
      <div>
        <div className='flex items-center justify-between mb-1'>
          <span className='text-xs text-neutral-400'>Zoom</span>
          <span className='text-xs text-neutral-400 tabular-nums'>
            {localZoom.toFixed(2)}x
          </span>
        </div>
        <Slider
          min={0.25}
          max={4}
          step={0.05}
          value={[localZoom]}
          onValueChange={(v) => handleZoomChange(v[0])}
          className='w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-white'
        />
      </div>

      {/* Numeric fields */}
      <div className='grid grid-cols-4 gap-1.5'>
        <div>
          <label className='text-[9px] text-neutral-500 uppercase mb-0.5 block'>
            Left
          </label>
          <NumberInput
            value={vL}
            step={10}
            onChange={(e) => handleFieldChange('viewportLeft', e.target.value)}
          />
        </div>
        <div>
          <label className='text-[9px] text-neutral-500 uppercase mb-0.5 block'>
            Top
          </label>
          <NumberInput
            value={vT}
            step={10}
            onChange={(e) => handleFieldChange('viewportTop', e.target.value)}
          />
        </div>
        <div>
          <label className='text-[9px] text-neutral-500 uppercase mb-0.5 block'>
            Width
          </label>
          <NumberInput
            value={vW}
            min={1}
            step={10}
            onChange={(e) => handleFieldChange('viewportWidth', e.target.value)}
          />
        </div>
        <div>
          <label className='text-[9px] text-neutral-500 uppercase mb-0.5 block'>
            Height
          </label>
          <NumberInput
            value={vH}
            min={1}
            step={10}
            onChange={(e) => handleFieldChange('viewportHeight', e.target.value)}
          />
        </div>
      </div>

      {/* Transition duration */}
      <div>
        <div className='flex items-center justify-between mb-1'>
          <span className='text-xs text-neutral-400'>Transition Duration</span>
          <span className='text-xs text-neutral-400 tabular-nums'>
            {localDuration}ms
          </span>
        </div>
        <Slider
          min={0}
          max={3000}
          step={50}
          value={[localDuration]}
          onValueChange={(v) => handleDurationChange(v[0])}
          className='w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-white'
        />
      </div>

      {/* Easing + Reset */}
      <div className='flex items-center gap-2'>
        <div className='flex-1'>
          <span className='text-[9px] text-neutral-500 uppercase mb-0.5 block'>
            Easing
          </span>
          <Select
            value={easing}
            onValueChange={(v) => onChange({ viewportTransitionEasing: v })}>
            <SelectTrigger className='bg-[#0e0e0e] border border-neutral-700/20 text-foreground text-[10px] px-2 py-1 rounded h-7'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EASING_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <button
          type='button'
          onClick={handleReset}
          disabled={isDefault}
          className='mt-3.5 flex items-center gap-1 text-[10px] text-neutral-400 hover:text-white disabled:text-neutral-600 disabled:cursor-not-allowed transition-colors cursor-pointer'
          title='Reset viewport'>
          <RotateCcw className='size-3' />
          Reset
        </button>
      </div>
    </div>
  );
}
