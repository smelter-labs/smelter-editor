import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';

interface DeleteButtonProps {
  onClick: () => void;
}

export function DeleteButton({ onClick }: DeleteButtonProps) {
  return (
    <Button
      data-no-dnd
      size='sm'
      variant='ghost'
      className='ml-auto shrink-0 transition-all duration-300 ease-in-out h-7 w-7 p-1.5 cursor-pointer'
      onClick={onClick}>
      <Trash2 className='text-neutral-400 size-5' />
    </Button>
  );
}
