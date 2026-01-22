import { useState, useEffect } from 'react';
import type { Input, AvailableShader } from '@/app/actions/actions';
import type { InputWrapper } from '../hooks/use-control-panel-state';
import InputEntry from '@/components/control-panel/input-entry/input-entry';
import { SortableItem } from '@/components/control-panel/sortable-list/sortable-item';
import { SortableList } from '@/components/control-panel/sortable-list/sortable-list';
import Accordion from '@/components/ui/accordion';
import LoadingSpinner from '@/components/ui/spinner';

type StreamsSectionProps = {
  inputs: Input[];
  inputWrappers: InputWrapper[];
  listVersion: number;
  showStreamsSpinner: boolean;
  roomId: string;
  refreshState: () => Promise<void>;
  availableShaders: AvailableShader[];
  updateOrder: (wrappers: InputWrapper[]) => Promise<void>;
  openFxInputId: string | null;
  onToggleFx: (inputId: string) => void;
  cameraPcRef: React.MutableRefObject<RTCPeerConnection | null>;
  cameraStreamRef: React.MutableRefObject<MediaStream | null>;
  activeCameraInputId: string | null;
  activeScreenshareInputId: string | null;
  onWhipDisconnectedOrRemoved: (id: string) => void;
};

export function StreamsSection({
  inputs,
  inputWrappers,
  listVersion,
  showStreamsSpinner,
  roomId,
  refreshState,
  availableShaders,
  updateOrder,
  openFxInputId,
  onToggleFx,
  cameraPcRef,
  cameraStreamRef,
  activeCameraInputId,
  activeScreenshareInputId,
  onWhipDisconnectedOrRemoved,
}: StreamsSectionProps) {
  const [isWideScreen, setIsWideScreen] = useState(true);

  useEffect(() => {
    const checkWidth = () => {
      setIsWideScreen(window.innerWidth >= 1600);
    };
    checkWidth();
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, []);

  return (
    <Accordion title='Streams' defaultOpen data-tour='streams-list-container'>
      <div className='flex-1 overflow-y-auto overflow-x-hidden relative'>
        <div className='pointer-events-none absolute top-0 left-0 right-0 h-2 z-40' />
        {showStreamsSpinner ? (
          <div className='flex items-center justify-center h-32'>
            <LoadingSpinner size='lg' variant='spinner' />
          </div>
        ) : (
          <SortableList
            items={inputWrappers}
            resetVersion={listVersion}
            disableDrag={!isWideScreen}
            renderItem={(item, index, orderedItems) => {
              const input = inputs.find(
                (input) => input.inputId === item.inputId,
              );
              const isFirst = index === 0;
              const isLast = index === orderedItems.length - 1;
              return (
                <SortableItem
                  key={item.inputId}
                  id={item.id}
                  disableDrag={!isWideScreen}>
                  {input && (
                    <InputEntry
                      input={input}
                      refreshState={refreshState}
                      roomId={roomId}
                      availableShaders={availableShaders}
                      canRemove={inputs.length > 1}
                      canMoveUp={!isFirst}
                      canMoveDown={!isLast}
                      pcRef={cameraPcRef}
                      streamRef={cameraStreamRef}
                      isFxOpen={openFxInputId === input.inputId}
                      onToggleFx={() => onToggleFx(input.inputId)}
                      onWhipDisconnectedOrRemoved={onWhipDisconnectedOrRemoved}
                      showGrip={isWideScreen}
                    />
                  )}
                </SortableItem>
              );
            }}
            onOrderChange={updateOrder}
          />
        )}
      </div>
    </Accordion>
  );
}
