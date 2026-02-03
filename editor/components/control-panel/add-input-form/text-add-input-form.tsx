import { addTextInput, Input } from '@/app/actions/actions';
import { useState } from 'react';
import { toast } from 'react-toastify';
import { Button } from '@/components/ui/button';
import LoadingSpinner from '@/components/ui/spinner';
import { AlignLeft, AlignCenter, AlignRight } from 'lucide-react';

type TextAlign = 'left' | 'center' | 'right';

export function TextAddInputForm({
  inputs,
  roomId,
  refreshState,
}: {
  inputs: Input[];
  roomId: string;
  refreshState: () => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [textAlign, setTextAlign] = useState<TextAlign>('left');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) {
      toast.error('Please enter some text.');
      return;
    }

    setIsLoading(true);
    try {
      await addTextInput(roomId, text, textAlign);
      await refreshState();
      setText('');
      toast.success('Text input added!');
    } catch (err) {
      toast.error('Failed to add text input.');
    } finally {
      setIsLoading(false);
    }
  };

  const alignOptions: { value: TextAlign; icon: React.ReactNode }[] = [
    { value: 'left', icon: <AlignLeft className='w-4 h-4' /> },
    { value: 'center', icon: <AlignCenter className='w-4 h-4' /> },
    { value: 'right', icon: <AlignRight className='w-4 h-4' /> },
  ];

  return (
    <form onSubmit={handleSubmit} className='flex flex-col gap-3'>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='Enter text to display...'
        className='w-full p-3 bg-neutral-900 border border-neutral-700 rounded text-white text-sm resize-none min-h-[100px] focus:outline-none focus:border-neutral-500'
      />
      <div className='flex items-center gap-2'>
        <span className='text-sm text-neutral-400'>Align:</span>
        <div className='flex gap-1'>
          {alignOptions.map((option) => (
            <button
              key={option.value}
              type='button'
              onClick={() => setTextAlign(option.value)}
              className={`p-2 rounded transition-colors ${
                textAlign === option.value
                  ? 'bg-white text-black'
                  : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-white'
              }`}>
              {option.icon}
            </button>
          ))}
        </div>
      </div>
      <Button
        type='submit'
        disabled={isLoading || !text.trim()}
        className='w-full bg-white text-black hover:bg-neutral-200 font-medium'>
        {isLoading ? (
          <>
            Adding...
            <LoadingSpinner size='sm' variant='spinner' />
          </>
        ) : (
          'Add Text'
        )}
      </Button>
    </form>
  );
}
