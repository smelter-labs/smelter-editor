import { ArrowLeft } from 'lucide-react';
import type { Input, AvailableShader } from '@/app/actions/actions';
import InputEntry from '@/components/control-panel/input-entry/input-entry';
import Accordion from '@/components/ui/accordion';

type FxAccordionProps = {
  fxInput: Input;
  onClose: () => void;
  roomId: string;
  refreshState: () => Promise<void>;
  availableShaders: AvailableShader[];
  inputs: Input[];
  cameraPcRef: React.MutableRefObject<RTCPeerConnection | null>;
  cameraStreamRef: React.MutableRefObject<MediaStream | null>;
  activeCameraInputId: string | null;
  activeScreenshareInputId: string | null;
  onWhipDisconnectedOrRemoved: (id: string) => void;
};

export function FxAccordion({
  fxInput,
  onClose,
  roomId,
  refreshState,
  availableShaders,
  inputs,
  cameraPcRef,
  cameraStreamRef,
  activeCameraInputId,
  activeScreenshareInputId,
  onWhipDisconnectedOrRemoved,
}: FxAccordionProps) {
  return (
    <Accordion
      title={fxInput.title}
      data-tour='fx-accordion-container'
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
