import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Input } from '@/lib/types';
import type { InputWrapper } from '../hooks/use-control-panel-state';
import InputEntry from '@/components/control-panel/input-entry/input-entry';
import { SortableItem } from '@/components/control-panel/sortable-list/sortable-item';
import { SortableList } from '@/components/control-panel/sortable-list/sortable-list';
import LoadingSpinner from '@/components/ui/spinner';
import { ErrorBoundary } from '@/components/error-boundary';
import { useControlPanelContext } from '../contexts/control-panel-context';
import { useWhipConnectionsContext } from '../contexts/whip-connections-context';

type StreamsSectionProps = {
  inputWrappers: InputWrapper[];
  listVersion: number;
  showStreamsSpinner: boolean;
  updateOrder: (wrappers: InputWrapper[]) => Promise<void>;
  openFxInputId: string | null;
  onToggleFx: (inputId: string) => void;
  isSwapping?: boolean;
  selectedInputId: string | null;
  isGuest?: boolean;
  guestInputId?: string | null;
  activeClipColors?: Record<string, string>;
};

export function StreamsSection({
  inputWrappers,
  listVersion,
  showStreamsSpinner,
  updateOrder,
  openFxInputId,
  onToggleFx,
  isSwapping,
  selectedInputId,
  isGuest,
  guestInputId,
  activeClipColors,
}: StreamsSectionProps) {
  const { inputs, roomId, refreshState, availableShaders } =
    useControlPanelContext();
  const {
    cameraPcRef,
    cameraStreamRef,
    activeCameraInputId,
    setActiveCameraInputId,
    setIsCameraActive,
    activeScreenshareInputId,
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

  const [isWideScreen, setIsWideScreen] = useState(true);

  useEffect(() => {
    const checkWidth = () => {
      setIsWideScreen(window.innerWidth >= 1600);
    };
    checkWidth();
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, []);

  const attachedInputIds = useMemo(() => {
    const ids = new Set<string>();
    for (const input of inputs) {
      for (const id of input.attachedInputIds || []) {
        ids.add(id);
      }
    }
    return ids;
  }, [inputs]);

  const visibleWrappers = useMemo(
    () => inputWrappers.filter((w) => !attachedInputIds.has(w.inputId)),
    [inputWrappers, attachedInputIds],
  );

  return (
    <div className='flex-1 overflow-y-auto overflow-x-hidden relative'>
      <div className='pointer-events-none absolute top-0 left-0 right-0 h-2 z-40' />
      {isSwapping && (
        <div className='absolute inset-0 z-50 flex items-center justify-center bg-black/60 rounded-md backdrop-blur-sm'>
          <div className='flex items-center gap-2 text-neutral-300 text-sm'>
            <svg
              className='animate-spin h-5 w-5'
              viewBox='0 0 24 24'
              fill='none'>
              <circle
                className='opacity-25'
                cx='12'
                cy='12'
                r='10'
                stroke='currentColor'
                strokeWidth='4'
              />
              <path
                className='opacity-75'
                fill='currentColor'
                d='M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z'
              />
            </svg>
            <span>Transitioning…</span>
          </div>
        </div>
      )}
      {showStreamsSpinner ? (
        <div className='flex items-center justify-center h-32'>
          <LoadingSpinner size='lg' variant='spinner' />
        </div>
      ) : (
        <SortableList
          items={visibleWrappers}
          resetVersion={listVersion}
          disableDrag={isGuest || !isWideScreen}
          keyExtractor={(item) => item.inputId}
          renderItem={(item, index, orderedItems) => {
            const input = inputs.find(
              (input) => input.inputId === item.inputId,
            );
            const attachedChildren =
              input?.attachedInputIds
                ?.map((id) => inputs.find((i) => i.inputId === id))
                .filter((i): i is Input => !!i) || [];
            return (
              <SortableItem
                key={item.inputId}
                id={item.id}
                disableDrag={isGuest || !isWideScreen}>
                {input && (
                  <>
                    <ErrorBoundary>
                      <InputEntry
                        input={input}
                        refreshState={refreshState}
                        roomId={roomId}
                        availableShaders={availableShaders}
                        canRemove={
                          isGuest
                            ? input.inputId === guestInputId
                            : visibleWrappers.length > 1
                        }
                        pcRef={cameraPcRef}
                        streamRef={cameraStreamRef}
                        isFxOpen={openFxInputId === input.inputId}
                        onToggleFx={() => onToggleFx(input.inputId)}
                        onWhipDisconnectedOrRemoved={
                          onWhipDisconnectedOrRemoved
                        }
                        showGrip={isGuest ? false : isWideScreen}
                        isSelected={selectedInputId === input.inputId}
                        readOnly={isGuest && input.inputId !== guestInputId}
                        activeBlockColor={activeClipColors?.[input.inputId]}
                      />
                    </ErrorBoundary>
                    {attachedChildren.map((child) => (
                      <div
                        key={child.inputId}
                        className='ml-6 mt-1 border-l-2 border-blue-500/30 pl-2'>
                        <ErrorBoundary>
                          <InputEntry
                            input={child}
                            refreshState={refreshState}
                            roomId={roomId}
                            availableShaders={availableShaders}
                            canRemove={false}
                            pcRef={cameraPcRef}
                            streamRef={cameraStreamRef}
                            isFxOpen={openFxInputId === child.inputId}
                            onToggleFx={() => onToggleFx(child.inputId)}
                            onWhipDisconnectedOrRemoved={
                              onWhipDisconnectedOrRemoved
                            }
                            showGrip={false}
                            isSelected={selectedInputId === child.inputId}
                            readOnly={isGuest && child.inputId !== guestInputId}
                            activeBlockColor={activeClipColors?.[child.inputId]}
                          />
                        </ErrorBoundary>
                      </div>
                    ))}
                  </>
                )}
              </SortableItem>
            );
          }}
          onOrderChange={updateOrder}
        />
      )}
    </div>
  );
}
