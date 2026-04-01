'use client';

import { AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';

export type InputEntryTextSectionProps = {
  textValue: string;
  textAlign: 'left' | 'center' | 'right';
  textColor: string;
  textMaxLines: number;
  textScrollSpeed: number;
  textScrollLoop: boolean;
  textFontSize: number;
  onTextChange: (value: string) => void;
  onTextAlignChange: (value: 'left' | 'center' | 'right') => void;
  onTextColorChange: (value: string) => void;
  onTextMaxLinesChange: (value: number) => void;
  onTextScrollSpeedChange: (value: number) => void;
  onTextScrollLoopChange: (value: boolean) => void;
  onTextFontSizeChange: (value: number) => void;
};

export function InputEntryTextSection({
  textValue,
  textAlign,
  textColor,
  textMaxLines,
  textScrollSpeed,
  textScrollLoop,
  textFontSize,
  onTextChange,
  onTextAlignChange,
  onTextColorChange,
  onTextMaxLinesChange,
  onTextScrollSpeedChange,
  onTextScrollLoopChange,
  onTextFontSizeChange,
}: InputEntryTextSectionProps) {
  return (
    <div className='mb-3 md:pl-7'>
      <Textarea
        data-no-dnd
        value={textValue}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        placeholder='Enter text to display...'
        className='w-full p-2 bg-neutral-800 border border-neutral-700 rounded text-white text-sm resize-none min-h-[60px] focus:outline-none focus:border-neutral-500'
      />
      <div className='flex items-center gap-4 mt-2'>
        <div className='flex items-center gap-2'>
          <span className='text-xs text-neutral-400'>Align:</span>
          <div className='flex gap-1'>
            {[
              {
                value: 'left' as const,
                icon: <AlignLeft className='w-3 h-3' />,
              },
              {
                value: 'center' as const,
                icon: <AlignCenter className='w-3 h-3' />,
              },
              {
                value: 'right' as const,
                icon: <AlignRight className='w-3 h-3' />,
              },
            ].map((option) => (
              <Button
                key={option.value}
                variant={textAlign === option.value ? 'default' : 'ghost'}
                size='icon'
                onClick={() => onTextAlignChange(option.value)}
                className={`h-auto w-auto p-1.5 cursor-pointer ${
                  textAlign === option.value
                    ? 'bg-white text-black hover:bg-white'
                    : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-white'
                }`}>
                {option.icon}
              </Button>
            ))}
          </div>
        </div>
        <div className='flex items-center gap-2'>
          <span className='text-xs text-neutral-400'>Color:</span>
          <input
            type='color'
            value={textColor}
            onChange={(e) => onTextColorChange(e.target.value)}
            className='w-8 h-8 rounded cursor-pointer bg-neutral-800 border border-neutral-700'
            style={{ cursor: 'pointer' }}
          />
        </div>
        <div className='flex items-center gap-2'>
          <span className='text-xs text-neutral-400'>Font size:</span>
          <NumberInput
            data-no-dnd
            min={20}
            max={200}
            value={textFontSize}
            onChange={(e) =>
              onTextFontSizeChange(
                Math.max(20, Math.min(200, parseInt(e.target.value) || 80)),
              )
            }
            onKeyDown={(e) => e.stopPropagation()}
            className='w-16 p-1 bg-neutral-800 border border-neutral-700 text-white text-sm text-center focus:outline-none focus:border-neutral-500'
          />
        </div>
      </div>
      <div className='flex items-center gap-4 mt-2'>
        <div className='flex items-center gap-2'>
          <span className='text-xs text-neutral-400'>Max lines:</span>
          <NumberInput
            data-no-dnd
            min={1}
            max={20}
            value={textMaxLines}
            onChange={(e) =>
              onTextMaxLinesChange(
                Math.max(0, Math.min(20, parseInt(e.target.value) || 10)),
              )
            }
            onKeyDown={(e) => e.stopPropagation()}
            className='w-16 p-1 bg-neutral-800 border border-neutral-700 text-white text-sm text-center focus:outline-none focus:border-neutral-500'
          />
        </div>
        <div className='flex items-center gap-2'>
          <span className='text-xs text-neutral-400'>Scroll speed:</span>
          <Slider
            data-no-dnd
            min={20}
            max={500}
            value={[textScrollSpeed]}
            onValueChange={(v) => onTextScrollSpeedChange(v[0])}
            className='w-20'
          />
          <span className='text-xs text-neutral-500 w-8'>
            {textScrollSpeed}
          </span>
        </div>
        <label className='flex items-center gap-2 cursor-pointer'>
          <Checkbox
            data-no-dnd
            checked={textScrollLoop}
            onCheckedChange={(checked) => onTextScrollLoopChange(!!checked)}
          />
          <span className='text-xs text-neutral-400'>Loop</span>
        </label>
      </div>
    </div>
  );
}
