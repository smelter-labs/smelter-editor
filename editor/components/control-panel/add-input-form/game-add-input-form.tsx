import { addGameInput, Input } from '@/app/actions/actions';
import { useState } from 'react';
import { toast } from 'react-toastify';
import { Button } from '@/components/ui/button';
import LoadingSpinner from '@/components/ui/spinner';

export function GameAddInputForm({
  inputs,
  roomId,
  refreshState,
}: {
  inputs: Input[];
  roomId: string;
  refreshState: () => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setIsLoading(true);
    try {
      await addGameInput(roomId, title.trim() || undefined);
      await refreshState();
      setTitle('');
      toast.success('Game input added!');
    } catch (err) {
      toast.error('Failed to add game input.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className='flex flex-col gap-3'>
      <input
        type='text'
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder='Game title (optional)'
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
          'Add Game'
        )}
      </Button>
    </form>
  );
}
