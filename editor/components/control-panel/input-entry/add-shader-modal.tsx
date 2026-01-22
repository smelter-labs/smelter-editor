import { X } from 'lucide-react';
import { AvailableShader } from '@/app/actions/actions';

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
  if (!isOpen) return null;

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center'
      data-no-dnd
      onClick={onClose}>
      <div className='absolute inset-0 bg-black/60' />
      <div
        className='relative z-10 w-full max-w-lg mx-4 rounded-none border border-neutral-700 bg-[#0a0a0a]'
        onClick={(e) => e.stopPropagation()}>
        <div className='flex items-center justify-between p-4 border-b border-neutral-800'>
          <div className='text-white font-medium'>Add a shader</div>
          <button
            className='h-8 w-8 p-2 text-neutral-400 hover:text-white'
            onClick={onClose}
            aria-label='Close modal'>
            <X className='size-4' />
          </button>
        </div>
        <div className='max-h-[60vh] overflow-auto p-4'>
          {availableShaders
            .filter((shader) => !addedShaderIds.has(shader.id))
            .map((shader) => (
              <div
                key={shader.id}
                className='mb-3 p-4 rounded-none border transition-all duration-300 bg-neutral-900 border-neutral-700 hover:bg-neutral-800 cursor-pointer'
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
      </div>
    </div>
  );
}
