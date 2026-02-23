'use client';

import { fadeIn } from '@/utils/animations';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import type { RoomState } from '@/app/actions/actions';
import {
  setPendingWhipInputs as setPendingWhipInputsAction,
  updateRoom as updateRoomAction,
  type PendingWhipInputData,
} from '@/app/actions/actions';
import LayoutSelector, { type Layout } from '@/components/layout-selector';
import type { AccordionHandle } from '@/components/ui/accordion';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Grid3X3, SlidersHorizontal, Zap, Settings } from 'lucide-react';
import {
  useControlPanelState,
  type InputWrapper,
} from './hooks/use-control-panel-state';
import { useWhipConnections } from './hooks/use-whip-connections';
import { useControlPanelEvents } from './hooks/use-control-panel-events';
import { FxAccordion } from './components/FxAccordion';
import { AddVideoSection } from './components/AddVideoSection';
import { StreamsSection } from './components/StreamsSection';
import { TimelinePanel } from './components/TimelinePanel';
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
import { ControlPanelProvider } from './contexts/control-panel-context';
import { WhipConnectionsProvider } from './contexts/whip-connections-context';

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
  renderStreamsOutside?: boolean;
  timelinePortalRef?: React.RefObject<HTMLDivElement | null>;
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
  renderStreamsOutside,
  timelinePortalRef,
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
    inputs,
    inputsRef,
    showStreamsSpinner,
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

  const handleToggleFx = (inputId: string) => {
    setOpenFxInputId((prev) => (prev === inputId ? null : inputId));
  };

  const controlPanelCtx = useMemo(
    () => ({
      roomId,
      refreshState: handleRefreshState,
      inputs,
      inputsRef,
      availableShaders,
    }),
    [roomId, handleRefreshState, inputs, inputsRef, availableShaders],
  );

  const fxInput =
    openFxInputId && inputs.find((i) => i.inputId === openFxInputId)
      ? inputs.find((i) => i.inputId === openFxInputId)!
      : null;

  const streamsSection = !fxInput ? (
    <StreamsSection
      inputWrappers={inputWrappers}
      listVersion={listVersion}
      showStreamsSpinner={showStreamsSpinner}
      updateOrder={updateOrderWithLock}
      openFxInputId={openFxInputId}
      onToggleFx={handleToggleFx}
      isSwapping={isSwapping}
      selectedInputId={selectedInputId}
      isGuest={isGuest}
      guestInputId={activeCameraInputId || activeScreenshareInputId}
    />
  ) : null;

  const timelineSection = !fxInput ? (
    <TimelinePanel
      inputWrappers={inputWrappers}
      listVersion={listVersion}
      showStreamsSpinner={showStreamsSpinner}
      updateOrder={updateOrderWithLock}
      openFxInputId={openFxInputId}
      onToggleFx={handleToggleFx}
      isSwapping={isSwapping}
      selectedInputId={selectedInputId}
      isGuest={isGuest}
      guestInputId={activeCameraInputId || activeScreenshareInputId}
    />
  ) : null;

  const mainPanel = (
    <motion.div
      {...(fadeIn as any)}
      className={`flex flex-col flex-1 min-h-0 gap-3 rounded-none bg-neutral-950 mt-6`}>
      <video id='local-preview' muted playsInline autoPlay className='hidden' />

      {fxInput ? (
        <FxAccordion fxInput={fxInput} onClose={() => setOpenFxInputId(null)} />
      ) : (
        <>
          <AddVideoSection
            addVideoAccordionRef={addVideoAccordionRef}
            isGuest={isGuest}
            hasGuestInput={
              isGuest
                ? !!(activeCameraInputId || activeScreenshareInputId)
                : false
            }
          />
          <PendingWhipInputs
            pendingInputs={pendingWhipInputs}
            setPendingInputs={handleSetPendingWhipInputs}
          />
          {!renderStreamsOutside && streamsSection}
          {!isGuest && (
            <SettingsBar
              changeLayout={changeLayout}
              roomState={roomState}
              roomId={roomId}
              handleRefreshState={handleRefreshState}
              pendingWhipInputs={pendingWhipInputs}
              setPendingWhipInputs={handleSetPendingWhipInputs}
            />
          )}
        </>
      )}
    </motion.div>
  );

  if (renderStreamsOutside) {
    return (
      <ControlPanelProvider value={controlPanelCtx}>
        <WhipConnectionsProvider value={whipConnections}>
          {mainPanel}
          {timelineSection &&
            timelinePortalRef?.current &&
            createPortal(timelineSection, timelinePortalRef.current)}
        </WhipConnectionsProvider>
      </ControlPanelProvider>
    );
  }

  return (
    <ControlPanelProvider value={controlPanelCtx}>
      <WhipConnectionsProvider value={whipConnections}>
        {mainPanel}
      </WhipConnectionsProvider>
    </ControlPanelProvider>
  );
}

type ModalId = 'quickActions' | 'layouts' | 'transitions' | 'configuration';

function SettingsBar({
  changeLayout,
  roomState,
  roomId,
  handleRefreshState,
  pendingWhipInputs,
  setPendingWhipInputs,
}: {
  changeLayout: (layout: Layout) => void;
  roomState: RoomState;
  roomId: string;
  handleRefreshState: () => Promise<void>;
  pendingWhipInputs: PendingWhipInput[];
  setPendingWhipInputs: (inputs: PendingWhipInput[]) => void | Promise<void>;
}) {
  const [openModal, setOpenModal] = useState<ModalId | null>(null);

  const buttons: { id: ModalId; label: string; icon: React.ReactNode }[] = [
    {
      id: 'quickActions',
      label: 'Quick Actions',
      icon: <Zap className='w-4 h-4' />,
    },
    { id: 'layouts', label: 'Layouts', icon: <Grid3X3 className='w-4 h-4' /> },
    {
      id: 'transitions',
      label: 'Transitions',
      icon: <SlidersHorizontal className='w-4 h-4' />,
    },
    {
      id: 'configuration',
      label: 'Config',
      icon: <Settings className='w-4 h-4' />,
    },
  ];

  return (
    <>
      <div className='grid grid-cols-4 gap-2'>
        {buttons.map((btn) => (
          <button
            key={btn.id}
            onClick={() => setOpenModal(btn.id)}
            className='flex flex-col items-center gap-1.5 px-2 py-3 rounded-md border border-neutral-800 bg-neutral-900 hover:bg-neutral-800 hover:border-neutral-600 transition-all cursor-pointer group'>
            <span className='text-neutral-400 group-hover:text-white transition-colors'>
              {btn.icon}
            </span>
            <span className='text-[11px] font-medium text-neutral-400 group-hover:text-white transition-colors leading-tight text-center'>
              {btn.label}
            </span>
          </button>
        ))}
      </div>

      <Dialog
        open={openModal === 'quickActions'}
        onOpenChange={(open) => !open && setOpenModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Quick Actions</DialogTitle>
          </DialogHeader>
          <QuickActionsSection />
        </DialogContent>
      </Dialog>

      <Dialog
        open={openModal === 'layouts'}
        onOpenChange={(open) => !open && setOpenModal(null)}>
        <DialogContent className='max-w-xl'>
          <DialogHeader>
            <DialogTitle>Layouts</DialogTitle>
          </DialogHeader>
          <LayoutSelector
            changeLayout={changeLayout}
            activeLayoutId={roomState.layout}
            connectedStreamsLength={roomState.inputs.length}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={openModal === 'transitions'}
        onOpenChange={(open) => !open && setOpenModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transitions</DialogTitle>
          </DialogHeader>
          <TransitionSettings
            swapDurationMs={roomState.swapDurationMs ?? 500}
            onSwapDurationChange={async (value) => {
              await updateRoomAction(roomId, { swapDurationMs: value });
              await handleRefreshState();
            }}
            swapOutgoingEnabled={roomState.swapOutgoingEnabled ?? true}
            onSwapOutgoingEnabledChange={async (value) => {
              await updateRoomAction(roomId, { swapOutgoingEnabled: value });
              await handleRefreshState();
            }}
            swapFadeInDurationMs={roomState.swapFadeInDurationMs ?? 500}
            onSwapFadeInDurationChange={async (value) => {
              await updateRoomAction(roomId, { swapFadeInDurationMs: value });
              await handleRefreshState();
            }}
            swapFadeOutDurationMs={roomState.swapFadeOutDurationMs ?? 500}
            onSwapFadeOutDurationChange={async (value) => {
              await updateRoomAction(roomId, { swapFadeOutDurationMs: value });
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
              await updateRoomAction(roomId, { newsStripEnabled: value });
              await handleRefreshState();
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={openModal === 'configuration'}
        onOpenChange={(open) => !open && setOpenModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configuration</DialogTitle>
          </DialogHeader>
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
        </DialogContent>
      </Dialog>
    </>
  );
}
