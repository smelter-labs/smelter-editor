import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

interface DeleteButtonProps {
  onClick: () => void;
}

export function DeleteButton({ onClick }: DeleteButtonProps) {
  return (
    <Button
      data-no-dnd
      size='sm'
      variant='ghost'
      className='transition-all duration-300 ease-in-out h-7 w-7 p-1.5 cursor-pointer'
      onClick={onClick}>
      <X className='text-neutral-400 size-5' />
    </Button>
  );
}
