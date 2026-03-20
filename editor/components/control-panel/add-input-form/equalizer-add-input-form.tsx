'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import LoadingSpinner from '@/components/ui/spinner';
import { addEqualizerInput } from '@/app/actions/actions';

export function EqualizerAddInputForm({
  roomId,
  refreshState,
}: {
  roomId: string;
  refreshState: () => Promise<void>;
}) {
  const [barColor, setBarColor] = useState('#33ccff');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await addEqualizerInput(roomId, {
        barColor,
        barCount: 16,
        glowIntensity: 0.5,
        bgOpacity: 0.8,
        gap: 0.2,
        smoothing: 0.3,
      });
      await refreshState();
      toast.success('Equalizer input added!');
    } catch (err) {
      toast.error('Failed to add equalizer input.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className='flex flex-col gap-3'>
      <div>
        <Label className='text-neutral-400 text-xs mb-1 block'>Bar Color</Label>
        <div className='flex items-center gap-2'>
          <input
            type='color'
            value={barColor}
            onChange={(e) => setBarColor(e.target.value)}
            className='w-8 h-8 rounded border border-neutral-700 cursor-pointer'
          />
          <span className='text-xs text-neutral-400'>{barColor}</span>
        </div>
      </div>
      <Button
        type='submit'
        disabled={isLoading}
        className='w-full bg-white text-black hover:bg-neutral-200 font-medium cursor-pointer'>
        {isLoading ? (
          <>
            Adding...
            <LoadingSpinner size='sm' variant='spinner' />
          </>
        ) : (
          'Add Equalizer'
        )}
      </Button>
    </form>
  );
}
