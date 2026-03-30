import type { AvailableShader } from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface AddShaderModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableShaders: AvailableShader[];
  addedShaderIds: Set<string>;
  onAddShader: (shaderId: string) => void;
}

export function AddShaderModal({
  isOpen,
  onClose,
  availableShaders,
  addedShaderIds,
  onAddShader,
}: AddShaderModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-no-dnd className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>Add a shader</DialogTitle>
        </DialogHeader>
        <div className='max-h-[60vh] overflow-auto'>
          {availableShaders
            .filter((shader) => !addedShaderIds.has(shader.id))
            .map((shader) => (
              <div
                key={shader.id}
                className='mb-3 p-4 border transition-all duration-300 bg-neutral-900 border-neutral-700 hover:bg-neutral-800 cursor-pointer rounded-md'
                onClick={() => {
                  onClose();
                  onAddShader(shader.id);
                }}>
                <div className='flex items-center justify-between'>
                  <div>
                    <h3 className='font-semibold text-white text-lg'>
                      {shader.name}
                    </h3>
                    <p className='text-xs text-white opacity-80'>
                      {shader.description}
                    </p>
                  </div>
                </div>
              </div>
            ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
