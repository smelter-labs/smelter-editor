import { useCallback } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { Input } from '@/app/actions/actions';
import InputEntry from '@/components/control-panel/input-entry/input-entry';
import Accordion from '@/components/ui/accordion';
import { useControlPanelContext } from '../contexts/control-panel-context';
import { useWhipConnectionsContext } from '../contexts/whip-connections-context';

type FxAccordionProps = {
  fxInput: Input;
  onClose: () => void;
};

export function FxAccordion({ fxInput, onClose }: FxAccordionProps) {
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
    <Accordion
      title={fxInput.title}
      defaultOpen
      headerIcon={<ArrowLeft width={18} height={18} />}
      onHeaderClick={onClose}>
      <div className='px-0 py-1'>
        <InputEntry
          input={fxInput}
          refreshState={refreshState}
          roomId={roomId}
          availableShaders={availableShaders}
          canRemove={inputs.length > 1}
          canMoveUp={false}
          canMoveDown={false}
          pcRef={cameraPcRef}
          streamRef={cameraStreamRef}
          isFxOpen={true}
          fxModeOnly={true}
          onToggleFx={onClose}
          onWhipDisconnectedOrRemoved={onWhipDisconnectedOrRemoved}
        />
      </div>
    </Accordion>
  );
}
