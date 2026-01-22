import { Button } from '@/components/ui/button';
import { Mic, MicOff } from 'lucide-react';

interface MuteButtonProps {
  muted: boolean;
  disabled: boolean;
  onClick: () => void;
}

export function MuteButton({ muted, disabled, onClick }: MuteButtonProps) {
  return (
    <Button
      data-no-dnd
      size='sm'
      variant='ghost'
      className='transition-all duration-300 ease-in-out h-7 w-7 p-1.5 cursor-pointer'
      disabled={disabled}
      onClick={onClick}>
      {muted ? (
        <MicOff className=' text-neutral-400 size-5' />
      ) : (
        <Mic className=' text-white size-5' />
      )}
    </Button>
  );
}
