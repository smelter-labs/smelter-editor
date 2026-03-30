import type { Input } from '@/lib/types';
import { useActions } from '../contexts/actions-context';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input as ShadcnInput } from '@/components/ui/input';
import LoadingSpinner from '@/components/ui/spinner';

export function SnakeGameAddInputForm({
  inputs,
  roomId,
  refreshState,
}: {
  inputs: Input[];
  roomId: string;
  refreshState: () => Promise<void>;
}) {
  const { addSnakeGameInput } = useActions();
  const [title, setTitle] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setIsLoading(true);
    try {
      await addSnakeGameInput(roomId, title.trim() || undefined);
      await refreshState();
      setTitle('');
      toast.success('Snake game input added!');
    } catch (err) {
      toast.error('Failed to add snake game input.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className='flex flex-col gap-3'>
      <ShadcnInput
        type='text'
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder='Snake game title (optional)'
        className='w-full p-3 bg-neutral-900 border border-neutral-700 rounded text-white text-sm focus:outline-none focus:border-neutral-500'
      />
      <Button
        type='submit'
        disabled={isLoading}
        className='w-full bg-white text-black hover:bg-neutral-200 font-medium'>
        {isLoading ? (
          <>
            Adding...
            <LoadingSpinner size='sm' variant='spinner' />
          </>
        ) : (
          'Add Snake Game'
        )}
      </Button>
    </form>
  );
}
