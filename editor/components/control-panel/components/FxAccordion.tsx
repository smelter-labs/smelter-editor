import { useCallback } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { Input } from '@/lib/types';
import { Button } from '@/components/ui/button';
import InputEntry from '@/components/control-panel/input-entry/input-entry';
import { useControlPanelContext } from '../contexts/control-panel-context';
import { useWhipConnectionsContext } from '../contexts/whip-connections-context';

type FxPanelProps = {
  fxInput: Input;
  onClose: () => void;
};

export function FxAccordion({ fxInput, onClose }: FxPanelProps) {
  const { roomId, refreshState, availableShaders, inputs } =
    useControlPanelContext();
  const {
    cameraPcRef,
    cameraStreamRef,
    activeCameraInputId,
    activeScreenshareInputId,
    setActiveCameraInputId,
    setIsCameraActive,
    setActiveScreenshareInputId,
    setIsScreenshareActive,
  } = useWhipConnectionsContext();

  const onWhipDisconnectedOrRemoved = useCallback(
    (id: string) => {
      if (activeCameraInputId === id) {
        setActiveCameraInputId(null);
        setIsCameraActive(false);
      }
      if (activeScreenshareInputId === id) {
        setActiveScreenshareInputId(null);
        setIsScreenshareActive(false);
      }
    },
    [
      activeCameraInputId,
      activeScreenshareInputId,
      setActiveCameraInputId,
      setIsCameraActive,
      setActiveScreenshareInputId,
      setIsScreenshareActive,
    ],
  );

  return (
    <div>
      <Button
        type='button'
        variant='ghost'
        onClick={onClose}
        className='flex items-center gap-2 px-2 py-1.5 mb-1 text-sm text-neutral-400 hover:text-white cursor-pointer'>
        <ArrowLeft className='w-4 h-4' />
        <span className='font-medium'>{fxInput.title}</span>
      </Button>
      <div className='px-0 py-1'>
        <InputEntry
          input={fxInput}
          refreshState={refreshState}
          roomId={roomId}
          availableShaders={availableShaders}
          canRemove={inputs.length > 1}
          pcRef={cameraPcRef}
          streamRef={cameraStreamRef}
          isFxOpen={true}
          fxModeOnly={true}
          onToggleFx={onClose}
          onWhipDisconnectedOrRemoved={onWhipDisconnectedOrRemoved}
        />
      </div>
    </div>
  );
}
