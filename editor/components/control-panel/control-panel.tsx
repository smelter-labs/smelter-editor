'use client';

import { fadeIn } from '@/utils/animations';
import { motion } from 'framer-motion';
import { useRef, useCallback, useEffect, useMemo } from 'react';
import type { RoomState } from '@/app/actions/actions';
import {
  setPendingWhipInputs as setPendingWhipInputsAction,
  updateRoom as updateRoomAction,
  type PendingWhipInputData,
} from '@/app/actions/actions';
import LayoutSelector, { type Layout } from '@/components/layout-selector';
import Accordion, { type AccordionHandle } from '@/components/ui/accordion';
import {
  useControlPanelState,
  type InputWrapper,
} from './hooks/use-control-panel-state';
import { useWhipConnections } from './hooks/use-whip-connections';
import { useControlPanelEvents } from './hooks/use-control-panel-events';
import { FxAccordion } from './components/FxAccordion';
import { AddVideoSection } from './components/AddVideoSection';
import { StreamsSection } from './components/StreamsSection';
import { QuickActionsSection } from './components/QuickActionsSection';
import {
  ConfigurationSection,
  type PendingWhipInput,
} from './components/ConfigurationSection';
import { PendingWhipInputs } from './components/PendingWhipInputs';
import { TransitionSettings } from './components/TransitionSettings';
import {
  rotateBy90,
  type RotationAngle,
} from './whip-input/utils/whip-publisher';
import { updateInput as updateInputAction } from '@/app/actions/actions';

export type ControlPanelProps = {
  roomId: string;
  roomState: RoomState;
  refreshState: () => Promise<void>;
  isGuest?: boolean;
  onGuestStreamChange?: (stream: MediaStream | null) => void;
  onGuestInputIdChange?: (inputId: string | null) => void;
  onGuestRotateRef?: React.MutableRefObject<
    (() => Promise<RotationAngle>) | null
  >;
  onLayoutSection?: (layoutSection: React.ReactNode) => void;
};

export type { InputWrapper } from './hooks/use-control-panel-state';

export default function ControlPanel({
  refreshState,
  roomId,
  roomState,
  isGuest,
  onGuestStreamChange,
  onGuestInputIdChange,
  onGuestRotateRef,
  onLayoutSection,
}: ControlPanelProps) {
  const addVideoAccordionRef = useRef<AccordionHandle | null>(null);

  const pendingWhipInputs: PendingWhipInput[] = (
    roomState.pendingWhipInputs || []
  ).map((p) => ({
    id: p.id,
    title: p.title,
    config: {
      type: 'whip',
      title: p.title,
      description: '',
      volume: p.volume,
      showTitle: p.showTitle,
      shaders: p.shaders,
      orientation: p.orientation,
    },
    position: p.position,
  }));

  const {
    userName,
    setUserName,
    inputs,
    inputsRef,
    showStreamsSpinner,
    addInputActiveTab,
    setAddInputActiveTab,
    streamActiveTab,
    setStreamActiveTab,
    inputsActiveTab,
    setInputsActiveTab,
    inputWrappers,
    setInputWrappers,
    listVersion,
    setListVersion,
    handleRefreshState,
    availableShaders,
    updateOrder,
    changeLayout,
    openFxInputId,
    setOpenFxInputId,
    selectedInputId,
    setSelectedInputId,
    isSwapping,
    setIsSwapping,
    swapTimerRef,
  } = useControlPanelState(roomId, roomState, refreshState);

  const totalSwapMs = useMemo(() => {
    const swap = roomState.swapDurationMs ?? 500;
    const fadeIn = roomState.swapFadeInDurationMs ?? 500;
    return swap + fadeIn + 200;
  }, [roomState.swapDurationMs, roomState.swapFadeInDurationMs]);

  const updateOrderWithLock = useCallback(
    async (wrappers: InputWrapper[]) => {
      if (isSwapping) return;
      setIsSwapping(true);
      if (swapTimerRef.current) clearTimeout(swapTimerRef.current);
      await updateOrder(wrappers);
      swapTimerRef.current = setTimeout(() => {
        setIsSwapping(false);
        swapTimerRef.current = null;
      }, totalSwapMs);
    },
    [isSwapping, updateOrder, totalSwapMs, setIsSwapping, swapTimerRef],
  );

  const whipConnections = useWhipConnections(
    roomId,
    userName,
    inputs,
    inputsRef,
    handleRefreshState,
    isGuest,
  );
  const {
    cameraPcRef,
    cameraStreamRef,
    activeCameraInputId,
    setActiveCameraInputId,
    isCameraActive,
    setIsCameraActive,
    screensharePcRef,
    screenshareStreamRef,
    activeScreenshareInputId,
    setActiveScreenshareInputId,
    isScreenshareActive,
    setIsScreenshareActive,
  } = whipConnections;

  useEffect(() => {
    if (!isGuest || !onGuestStreamChange) return;
    const stream =
      cameraStreamRef.current || screenshareStreamRef.current || null;
    onGuestStreamChange(stream);
  }, [isGuest, onGuestStreamChange, isCameraActive, isScreenshareActive]);

  useEffect(() => {
    if (!isGuest || !onGuestInputIdChange) return;
    onGuestInputIdChange(activeCameraInputId || activeScreenshareInputId);
  }, [
    isGuest,
    onGuestInputIdChange,
    activeCameraInputId,
    activeScreenshareInputId,
  ]);

  useEffect(() => {
    if (!isGuest || !onGuestRotateRef) return;
    const guestInputId = activeCameraInputId || activeScreenshareInputId;
    const pcRef = activeCameraInputId ? cameraPcRef : screensharePcRef;
    const streamRef = activeCameraInputId
      ? cameraStreamRef
      : screenshareStreamRef;

    onGuestRotateRef.current = guestInputId
      ? async () => {
          const angle = await rotateBy90(pcRef, streamRef);
          const currentInput = inputs.find((i) => i.inputId === guestInputId);
          await updateInputAction(roomId, guestInputId, {
            orientation: angle % 180 !== 0 ? 'vertical' : 'horizontal',
            volume: currentInput?.volume ?? 1,
            shaders: currentInput?.shaders ?? [],
          });
          await handleRefreshState();
          if (onGuestStreamChange && pcRef.current) {
            const sender = pcRef.current
              .getSenders()
              .find((s) => s.track?.kind === 'video');
            if (sender?.track) {
              const previewStream = new MediaStream([sender.track]);
              const raw = streamRef.current;
              if (raw) {
                for (const t of raw.getAudioTracks()) {
                  previewStream.addTrack(t);
                }
              }
              onGuestStreamChange(previewStream);
            }
          }
          return angle;
        }
      : null;

    return () => {
      onGuestRotateRef.current = null;
    };
  }, [
    isGuest,
    onGuestRotateRef,
    activeCameraInputId,
    activeScreenshareInputId,
    roomId,
    handleRefreshState,
  ]);

  useControlPanelEvents({
    inputsRef,
    inputWrappers,
    setInputWrappers,
    setListVersion,
    updateOrder: updateOrderWithLock,
    setAddInputActiveTab,
    setStreamActiveTab,
    addVideoAccordionRef,
    roomId,
    handleRefreshState,
    cameraPcRef,
    cameraStreamRef,
    screensharePcRef,
    screenshareStreamRef,
    activeCameraInputId,
    activeScreenshareInputId,
    setActiveCameraInputId,
    setIsCameraActive,
    setActiveScreenshareInputId,
    setIsScreenshareActive,
    setOpenFxInputId,
    inputs,
    availableShaders,
    selectedInputId,
    setSelectedInputId,
    currentLayout: roomState.layout,
    changeLayout,
  });

  const handleSetPendingWhipInputs = useCallback(
    async (newInputs: PendingWhipInput[]) => {
      const serverData: PendingWhipInputData[] = newInputs.map((p) => ({
        id: p.id,
        title: p.title,
        volume: p.config.volume,
        showTitle: p.config.showTitle !== false,
        shaders: p.config.shaders || [],
        orientation: (p.config.orientation || 'horizontal') as
          | 'horizontal'
          | 'vertical',
        position: p.position,
      }));
      await setPendingWhipInputsAction(roomId, serverData);
      await handleRefreshState();
    },
    [roomId, handleRefreshState],
  );

  const handleWhipDisconnectedOrRemoved = (id: string) => {
    if (activeCameraInputId === id) {
      setActiveCameraInputId(null);
      setIsCameraActive(false);
    }
    if (activeScreenshareInputId === id) {
      setActiveScreenshareInputId(null);
      setIsScreenshareActive(false);
    }
  };

  const handleToggleFx = (inputId: string) => {
    setOpenFxInputId((prev) => (prev === inputId ? null : inputId));
  };

  const fxInput =
    openFxInputId && inputs.find((i) => i.inputId === openFxInputId)
      ? inputs.find((i) => i.inputId === openFxInputId)!
      : null;

  return (
    <motion.div
      {...(fadeIn as any)}
      className='flex flex-col flex-1 min-h-0 gap-3 rounded-none bg-neutral-950 mt-6'>
      <video id='local-preview' muted playsInline autoPlay className='hidden' />

      {fxInput ? (
        <FxAccordion
          fxInput={fxInput}
          onClose={() => setOpenFxInputId(null)}
          roomId={roomId}
          refreshState={handleRefreshState}
          availableShaders={availableShaders}
          inputs={inputs}
          cameraPcRef={cameraPcRef}
          cameraStreamRef={cameraStreamRef}
          activeCameraInputId={activeCameraInputId}
          activeScreenshareInputId={activeScreenshareInputId}
          onWhipDisconnectedOrRemoved={handleWhipDisconnectedOrRemoved}
        />
      ) : (
        <>
          <AddVideoSection
            inputs={inputs}
            roomId={roomId}
            refreshState={handleRefreshState}
            addInputActiveTab={addInputActiveTab}
            setAddInputActiveTab={setAddInputActiveTab}
            streamActiveTab={streamActiveTab}
            setStreamActiveTab={setStreamActiveTab}
            inputsActiveTab={inputsActiveTab}
            setInputsActiveTab={setInputsActiveTab}
            userName={userName}
            setUserName={setUserName}
            cameraPcRef={cameraPcRef}
            cameraStreamRef={cameraStreamRef}
            screensharePcRef={screensharePcRef}
            screenshareStreamRef={screenshareStreamRef}
            setActiveCameraInputId={setActiveCameraInputId}
            setIsCameraActive={setIsCameraActive}
            setActiveScreenshareInputId={setActiveScreenshareInputId}
            setIsScreenshareActive={setIsScreenshareActive}
            addVideoAccordionRef={addVideoAccordionRef}
            isGuest={isGuest}
            hasGuestInput={
              isGuest
                ? !!(activeCameraInputId || activeScreenshareInputId)
                : false
            }
          />
          <PendingWhipInputs
            roomId={roomId}
            pendingInputs={pendingWhipInputs}
            setPendingInputs={handleSetPendingWhipInputs}
            refreshState={handleRefreshState}
            cameraPcRef={cameraPcRef}
            cameraStreamRef={cameraStreamRef}
            screensharePcRef={screensharePcRef}
            screenshareStreamRef={screenshareStreamRef}
            setActiveCameraInputId={setActiveCameraInputId}
            setIsCameraActive={setIsCameraActive}
            setActiveScreenshareInputId={setActiveScreenshareInputId}
            setIsScreenshareActive={setIsScreenshareActive}
          />
          <StreamsSection
            inputs={inputs}
            inputWrappers={inputWrappers}
            listVersion={listVersion}
            showStreamsSpinner={showStreamsSpinner}
            roomId={roomId}
            refreshState={handleRefreshState}
            availableShaders={availableShaders}
            updateOrder={updateOrderWithLock}
            openFxInputId={openFxInputId}
            onToggleFx={handleToggleFx}
            isSwapping={isSwapping}
            cameraPcRef={cameraPcRef}
            cameraStreamRef={cameraStreamRef}
            activeCameraInputId={activeCameraInputId}
            activeScreenshareInputId={activeScreenshareInputId}
            onWhipDisconnectedOrRemoved={handleWhipDisconnectedOrRemoved}
            selectedInputId={selectedInputId}
            isGuest={isGuest}
            guestInputId={activeCameraInputId || activeScreenshareInputId}
          />
          {!isGuest && (
            <>
              <QuickActionsSection
                inputs={inputs}
                roomId={roomId}
                refreshState={handleRefreshState}
              />
              <LayoutAndTransitions
                changeLayout={changeLayout}
                roomState={roomState}
                roomId={roomId}
                handleRefreshState={handleRefreshState}
                onLayoutSection={onLayoutSection}
                pendingWhipInputs={pendingWhipInputs}
                setPendingWhipInputs={handleSetPendingWhipInputs}
              />
            </>
          )}
        </>
      )}
    </motion.div>
  );
}

function LayoutAndTransitions({
  changeLayout,
  roomState,
  roomId,
  handleRefreshState,
  onLayoutSection,
  pendingWhipInputs,
  setPendingWhipInputs,
}: {
  changeLayout: (layout: Layout) => void;
  roomState: RoomState;
  roomId: string;
  handleRefreshState: () => Promise<void>;
  onLayoutSection?: (node: React.ReactNode) => void;
  pendingWhipInputs: PendingWhipInput[];
  setPendingWhipInputs: (inputs: PendingWhipInput[]) => void | Promise<void>;
}) {
  const content = (
    <div className='grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start'>
      <Accordion title='Layouts' defaultOpen>
        <LayoutSelector
          changeLayout={changeLayout}
          activeLayoutId={roomState.layout}
          connectedStreamsLength={roomState.inputs.length}
        />
      </Accordion>
      <Accordion title='Transitions' defaultOpen>
        <TransitionSettings
          swapDurationMs={roomState.swapDurationMs ?? 500}
          onSwapDurationChange={async (value) => {
            await updateRoomAction(roomId, { swapDurationMs: value });
            await handleRefreshState();
          }}
          swapOutgoingEnabled={roomState.swapOutgoingEnabled ?? true}
          onSwapOutgoingEnabledChange={async (value) => {
            await updateRoomAction(roomId, {
              swapOutgoingEnabled: value,
            });
            await handleRefreshState();
          }}
          swapFadeInDurationMs={roomState.swapFadeInDurationMs ?? 500}
          onSwapFadeInDurationChange={async (value) => {
            await updateRoomAction(roomId, {
              swapFadeInDurationMs: value,
            });
            await handleRefreshState();
          }}
          swapFadeOutDurationMs={roomState.swapFadeOutDurationMs ?? 500}
          onSwapFadeOutDurationChange={async (value) => {
            await updateRoomAction(roomId, {
              swapFadeOutDurationMs: value,
            });
            await handleRefreshState();
          }}
          newsStripFadeDuringSwap={roomState.newsStripFadeDuringSwap ?? true}
          onNewsStripFadeDuringSwapChange={async (value) => {
            await updateRoomAction(roomId, {
              newsStripFadeDuringSwap: value,
            });
            await handleRefreshState();
          }}
          newsStripEnabled={roomState.newsStripEnabled ?? true}
          onNewsStripEnabledChange={async (value) => {
            await updateRoomAction(roomId, {
              newsStripEnabled: value,
            });
            await handleRefreshState();
          }}
        />
      </Accordion>
      <ConfigurationSection
        inputs={roomState.inputs}
        layout={roomState.layout}
        resolution={roomState.resolution}
        transitionSettings={{
          swapDurationMs: roomState.swapDurationMs,
          swapOutgoingEnabled: roomState.swapOutgoingEnabled,
          swapFadeInDurationMs: roomState.swapFadeInDurationMs,
          swapFadeOutDurationMs: roomState.swapFadeOutDurationMs,
          newsStripFadeDuringSwap: roomState.newsStripFadeDuringSwap,
          newsStripEnabled: roomState.newsStripEnabled,
        }}
        roomId={roomId}
        refreshState={handleRefreshState}
        pendingWhipInputs={pendingWhipInputs}
        setPendingWhipInputs={setPendingWhipInputs}
      />
    </div>
  );

  useEffect(() => {
    onLayoutSection?.(content);
  });

  if (onLayoutSection) return null;
  return content;
}
