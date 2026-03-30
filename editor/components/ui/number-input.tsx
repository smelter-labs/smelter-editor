import * as React from 'react';
import { cn } from '@/lib/utils';
import { ChevronUp, ChevronDown } from 'lucide-react';

interface NumberInputProps extends Omit<
  React.ComponentProps<'input'>,
  'type' | 'onChange'
> {
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  hideButtons?: boolean;
}

function NumberInput({
  className,
  hideButtons,
  disabled,
  min,
  max,
  step = 1,
  onChange,
  ...props
}: NumberInputProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  const nudge = (direction: 1 | -1) => {
    const input = inputRef.current;
    if (!input || disabled) return;

    const current = parseFloat(input.value) || 0;
    const s = typeof step === 'number' ? step : parseFloat(step) || 1;
    let next = current + direction * s;

    if (min !== undefined) next = Math.max(Number(min), next);
    if (max !== undefined) next = Math.min(Number(max), next);

    const precision = s < 1 ? (String(s).split('.')[1]?.length ?? 2) : 0;
    next = parseFloat(next.toFixed(precision));

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    nativeInputValueSetter?.call(input, String(next));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  return (
    <div
      className={cn(
        'relative flex items-center group/number',
        disabled && 'opacity-50',
      )}>
      <input
        ref={inputRef}
        type='number'
        data-slot='input'
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={onChange}
        className={cn(
          'flex h-7 w-full border border-neutral-700/20 bg-[#0e0e0e] px-2 py-1 pr-6 text-[10px] text-foreground font-mono shadow-sm transition-colors placeholder:text-neutral-600 focus-visible:outline-none focus-visible:border-cyan disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
          className,
        )}
        {...props}
      />
      {!hideButtons && (
        <div className='absolute right-0 inset-y-0 flex flex-col border-l border-neutral-700/20'>
          <button
            type='button'
            tabIndex={-1}
            disabled={disabled}
            aria-label='Increment'
            onClick={() => nudge(1)}
            className='flex-1 flex items-center justify-center w-5 text-neutral-600 hover:text-cyan hover:bg-cyan/10 active:bg-cyan/20 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:hover:text-neutral-600 disabled:hover:bg-transparent'>
            <ChevronUp className='size-2.5' strokeWidth={2.5} />
          </button>
          <div className='h-px bg-neutral-700/20' />
          <button
            type='button'
            tabIndex={-1}
            disabled={disabled}
            aria-label='Decrement'
            onClick={() => nudge(-1)}
            className='flex-1 flex items-center justify-center w-5 text-neutral-600 hover:text-cyan hover:bg-cyan/10 active:bg-cyan/20 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:hover:text-neutral-600 disabled:hover:bg-transparent'>
            <ChevronDown className='size-2.5' strokeWidth={2.5} />
          </button>
        </div>
      )}
    </div>
  );
}

export { NumberInput };
