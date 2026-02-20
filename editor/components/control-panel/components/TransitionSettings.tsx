'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

type TransitionSettingsProps = {
  swapDurationMs: number;
  onSwapDurationChange: (value: number) => void;
  swapOutgoingEnabled: boolean;
  onSwapOutgoingEnabledChange: (value: boolean) => void;
  swapFadeInDurationMs: number;
  onSwapFadeInDurationChange: (value: number) => void;
  swapFadeOutDurationMs: number;
  onSwapFadeOutDurationChange: (value: number) => void;
  newsStripFadeDuringSwap: boolean;
  onNewsStripFadeDuringSwapChange: (value: boolean) => void;
  newsStripEnabled: boolean;
  onNewsStripEnabledChange: (value: boolean) => void;
};

export function TransitionSettings({
  swapDurationMs,
  onSwapDurationChange,
  swapOutgoingEnabled,
  onSwapOutgoingEnabledChange,
  swapFadeInDurationMs,
  onSwapFadeInDurationChange,
  swapFadeOutDurationMs,
  onSwapFadeOutDurationChange,
  newsStripFadeDuringSwap,
  onNewsStripFadeDuringSwapChange,
  newsStripEnabled,
  onNewsStripEnabledChange,
}: TransitionSettingsProps) {
  const [localSwapDuration, setLocalSwapDuration] = useState(swapDurationMs);
  const lastEnabledValueRef = useRef(swapDurationMs > 0 ? swapDurationMs : 500);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [localFadeInDuration, setLocalFadeInDuration] =
    useState(swapFadeInDurationMs);
  const lastEnabledFadeInValueRef = useRef(
    swapFadeInDurationMs > 0 ? swapFadeInDurationMs : 500,
  );
  const fadeInDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [localFadeOutDuration, setLocalFadeOutDuration] = useState(
    swapFadeOutDurationMs,
  );
  const lastEnabledFadeOutValueRef = useRef(
    swapFadeOutDurationMs > 0 ? swapFadeOutDurationMs : 500,
  );
  const fadeOutDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalSwapDuration(swapDurationMs);
    if (swapDurationMs > 0) {
      lastEnabledValueRef.current = swapDurationMs;
    }
  }, [swapDurationMs]);

  useEffect(() => {
    setLocalFadeInDuration(swapFadeInDurationMs);
    if (swapFadeInDurationMs > 0) {
      lastEnabledFadeInValueRef.current = swapFadeInDurationMs;
    }
  }, [swapFadeInDurationMs]);

  useEffect(() => {
    setLocalFadeOutDuration(swapFadeOutDurationMs);
    if (swapFadeOutDurationMs > 0) {
      lastEnabledFadeOutValueRef.current = swapFadeOutDurationMs;
    }
  }, [swapFadeOutDurationMs]);

  const handleSwapDurationChange = useCallback(
    (value: number) => {
      setLocalSwapDuration(value);
      if (value > 0) {
        lastEnabledValueRef.current = value;
      }
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        onSwapDurationChange(value);
      }, 300);
    },
    [onSwapDurationChange],
  );

  const handleFadeInDurationChange = useCallback(
    (value: number) => {
      setLocalFadeInDuration(value);
      if (value > 0) {
        lastEnabledFadeInValueRef.current = value;
      }
      if (fadeInDebounceRef.current) {
        clearTimeout(fadeInDebounceRef.current);
      }
      fadeInDebounceRef.current = setTimeout(() => {
        onSwapFadeInDurationChange(value);
      }, 300);
    },
    [onSwapFadeInDurationChange],
  );

  const handleFadeOutDurationChange = useCallback(
    (value: number) => {
      setLocalFadeOutDuration(value);
      if (value > 0) {
        lastEnabledFadeOutValueRef.current = value;
      }
      if (fadeOutDebounceRef.current) {
        clearTimeout(fadeOutDebounceRef.current);
      }
      fadeOutDebounceRef.current = setTimeout(() => {
        onSwapFadeOutDurationChange(value);
      }, 300);
    },
    [onSwapFadeOutDurationChange],
  );

  return (
    <div className='px-1'>
      <label className='flex items-center gap-2 cursor-pointer mb-2'>
        <input
          type='checkbox'
          checked={localSwapDuration > 0}
          onChange={(e) => {
            if (e.target.checked) {
              handleSwapDurationChange(lastEnabledValueRef.current);
            } else {
              handleSwapDurationChange(0);
            }
          }}
          className='accent-white'
        />
        <span className='text-xs text-neutral-400'>Swap Transition</span>
      </label>
      {localSwapDuration > 0 && (
        <>
          <div className='flex items-center justify-between mb-2'>
            <span className='text-xs text-neutral-400'>Duration</span>
            <span className='text-xs text-neutral-400'>
              {localSwapDuration}ms
            </span>
          </div>
          <input
            type='range'
            min={100}
            max={2000}
            step={50}
            value={localSwapDuration}
            onChange={(e) => handleSwapDurationChange(Number(e.target.value))}
            className='w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-white'
          />
          <label className='flex items-center gap-2 cursor-pointer mt-3'>
            <input
              type='checkbox'
              checked={swapOutgoingEnabled}
              onChange={(e) => onSwapOutgoingEnabledChange(e.target.checked)}
              className='accent-white'
            />
            <span className='text-xs text-neutral-400'>
              Outgoing Transition
            </span>
          </label>
          <label className='flex items-center gap-2 cursor-pointer mt-3'>
            <input
              type='checkbox'
              checked={localFadeOutDuration > 0}
              onChange={(e) => {
                if (e.target.checked) {
                  handleFadeOutDurationChange(
                    lastEnabledFadeOutValueRef.current,
                  );
                } else {
                  handleFadeOutDurationChange(0);
                }
              }}
              className='accent-white'
            />
            <span className='text-xs text-neutral-400'>
              Fade Out During Swap
            </span>
          </label>
          {localFadeOutDuration > 0 && (
            <>
              <div className='flex items-center justify-between mb-2 mt-2'>
                <span className='text-xs text-neutral-400'>
                  Fade Out Duration
                </span>
                <span className='text-xs text-neutral-400'>
                  {localFadeOutDuration}ms
                </span>
              </div>
              <input
                type='range'
                min={100}
                max={2000}
                step={50}
                value={localFadeOutDuration}
                onChange={(e) =>
                  handleFadeOutDurationChange(Number(e.target.value))
                }
                className='w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-white'
              />
            </>
          )}
          <label className='flex items-center gap-2 cursor-pointer mt-3'>
            <input
              type='checkbox'
              checked={localFadeInDuration > 0}
              onChange={(e) => {
                if (e.target.checked) {
                  handleFadeInDurationChange(lastEnabledFadeInValueRef.current);
                } else {
                  handleFadeInDurationChange(0);
                }
              }}
              className='accent-white'
            />
            <span className='text-xs text-neutral-400'>Fade In After Swap</span>
          </label>
          {localFadeInDuration > 0 && (
            <>
              <div className='flex items-center justify-between mb-2 mt-2'>
                <span className='text-xs text-neutral-400'>
                  Fade In Duration
                </span>
                <span className='text-xs text-neutral-400'>
                  {localFadeInDuration}ms
                </span>
              </div>
              <input
                type='range'
                min={100}
                max={2000}
                step={50}
                value={localFadeInDuration}
                onChange={(e) =>
                  handleFadeInDurationChange(Number(e.target.value))
                }
                className='w-full h-1 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-white'
              />
              <label className='flex items-center gap-2 cursor-pointer mt-3'>
                <input
                  type='checkbox'
                  checked={newsStripEnabled}
                  onChange={(e) => onNewsStripEnabledChange(e.target.checked)}
                  className='accent-white'
                />
                <span className='text-xs text-neutral-400'>News Strip</span>
              </label>
              <label className='flex items-center gap-2 cursor-pointer mt-3'>
                <input
                  type='checkbox'
                  checked={newsStripFadeDuringSwap}
                  onChange={(e) =>
                    onNewsStripFadeDuringSwapChange(e.target.checked)
                  }
                  className='accent-white'
                />
                <span className='text-xs text-neutral-400'>
                  News Strip Fades
                </span>
              </label>
            </>
          )}
        </>
      )}
    </div>
  );
}
