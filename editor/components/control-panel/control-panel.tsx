'use client';

import { fadeIn } from '@/utils/animations';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import type { RoomState, Input, AvailableShader } from '@/app/actions/actions';
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
import ShaderPanel from './input-entry/shader-panel';
import type { BlockSettings } from './hooks/use-timeline-state';

type SelectedTimelineClip = {
  trackId: string;
  clipId: string;
  inputId: string;
  startMs: number;
  endMs: number;
  blockSettings: BlockSettings;
};

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

  const [selectedTimelineClip, setSelectedTimelineClip] =
    useState<SelectedTimelineClip | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ clip: SelectedTimelineClip | null }>)
        .detail;
      setSelectedTimelineClip(detail?.clip ?? null);
    };
    window.addEventListener('smelter:timeline:selected-clip', handler);
    return () =>
      window.removeEventListener('smelter:timeline:selected-clip', handler);
  }, []);

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
              selectedTimelineClip={selectedTimelineClip}
              inputs={inputs}
              availableShaders={availableShaders}
              onSelectedTimelineClipChange={setSelectedTimelineClip}
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
  selectedTimelineClip,
  onSelectedTimelineClipChange,
  inputs,
  availableShaders,
}: {
  changeLayout: (layout: Layout) => void;
  roomState: RoomState;
  roomId: string;
  handleRefreshState: () => Promise<void>;
  pendingWhipInputs: PendingWhipInput[];
  setPendingWhipInputs: (inputs: PendingWhipInput[]) => void | Promise<void>;
  selectedTimelineClip: SelectedTimelineClip | null;
  onSelectedTimelineClipChange: (clip: SelectedTimelineClip | null) => void;
  inputs: Input[];
  availableShaders: AvailableShader[];
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
      <BlockClipPropertiesPanel
        roomId={roomId}
        selectedTimelineClip={selectedTimelineClip}
        onSelectedTimelineClipChange={onSelectedTimelineClipChange}
        inputs={inputs}
        availableShaders={availableShaders}
        handleRefreshState={handleRefreshState}
      />

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

function BlockClipPropertiesPanel({
  roomId,
  selectedTimelineClip,
  onSelectedTimelineClipChange,
  inputs,
  availableShaders,
  handleRefreshState,
}: {
  roomId: string;
  selectedTimelineClip: SelectedTimelineClip | null;
  onSelectedTimelineClipChange: (clip: SelectedTimelineClip | null) => void;
  inputs: Input[];
  availableShaders: AvailableShader[];
  handleRefreshState: () => Promise<void>;
}) {
  const [sliderValues, setSliderValues] = useState<{ [key: string]: number }>(
    {},
  );
  const [shaderLoading, setShaderLoading] = useState<string | null>(null);
  const [paramLoading, setParamLoading] = useState<{
    [shaderId: string]: string | null;
  }>({});

  const selectedInput = selectedTimelineClip
    ? inputs.find((i) => i.inputId === selectedTimelineClip.inputId)
    : null;

  const applyClipPatch = useCallback(
    async (patch: Partial<BlockSettings>) => {
      if (!selectedTimelineClip) return;
      const nextClip: SelectedTimelineClip = {
        ...selectedTimelineClip,
        blockSettings: {
          ...selectedTimelineClip.blockSettings,
          ...patch,
        },
      };
      onSelectedTimelineClipChange(nextClip);
      window.dispatchEvent(
        new CustomEvent('smelter:timeline:update-clip-settings', {
          detail: {
            trackId: selectedTimelineClip.trackId,
            clipId: selectedTimelineClip.clipId,
            patch,
          },
        }),
      );

      try {
        await updateInputAction(roomId, selectedTimelineClip.inputId, {
          volume: patch.volume ?? nextClip.blockSettings.volume,
          shaders: patch.shaders ?? nextClip.blockSettings.shaders,
          showTitle: patch.showTitle ?? nextClip.blockSettings.showTitle,
          orientation: patch.orientation ?? nextClip.blockSettings.orientation,
          text: patch.text,
          textAlign: patch.textAlign,
          textColor: patch.textColor,
          textMaxLines: patch.textMaxLines,
          textScrollSpeed: patch.textScrollSpeed,
          textScrollLoop: patch.textScrollLoop,
          textFontSize: patch.textFontSize,
          borderColor: patch.borderColor,
          borderWidth: patch.borderWidth,
          attachedInputIds: patch.attachedInputIds,
        });
        await handleRefreshState();
      } catch (err) {
        console.warn('Failed to apply clip settings', err);
      }
    },
    [
      selectedTimelineClip,
      onSelectedTimelineClipChange,
      roomId,
      handleRefreshState,
    ],
  );

  const handleShaderToggle = useCallback(
    (shaderId: string) => {
      if (!selectedTimelineClip) return;
      const current = selectedTimelineClip.blockSettings.shaders || [];
      const existing = current.find((s) => s.shaderId === shaderId);
      if (!existing) {
        const shaderDef = availableShaders.find((s) => s.id === shaderId);
        if (!shaderDef) return;
        void applyClipPatch({
          shaders: [
            ...current,
            {
              shaderName: shaderDef.name,
              shaderId: shaderDef.id,
              enabled: true,
              params:
                shaderDef.params?.map((param) => ({
                  paramName: param.name,
                  paramValue:
                    typeof param.defaultValue === 'number'
                      ? param.defaultValue
                      : 0,
                })) || [],
            },
          ],
        });
        return;
      }
      void applyClipPatch({
        shaders: current.map((shader) =>
          shader.shaderId === shaderId
            ? { ...shader, enabled: !shader.enabled }
            : shader,
        ),
      });
    },
    [selectedTimelineClip, availableShaders, applyClipPatch],
  );

  const handleShaderRemove = useCallback(
    (shaderId: string) => {
      if (!selectedTimelineClip) return;
      void applyClipPatch({
        shaders: (selectedTimelineClip.blockSettings.shaders || []).filter(
          (shader) => shader.shaderId !== shaderId,
        ),
      });
    },
    [selectedTimelineClip, applyClipPatch],
  );

  const handleSliderChange = useCallback(
    (shaderId: string, paramName: string, newValue: number) => {
      if (!selectedTimelineClip) return;
      setSliderValues((prev) => ({
        ...prev,
        [`${shaderId}:${paramName}`]: newValue,
      }));
      setParamLoading((prev) => ({ ...prev, [shaderId]: paramName }));
      const current = selectedTimelineClip.blockSettings.shaders || [];
      const shaders = current.map((shader) => {
        if (shader.shaderId !== shaderId) return shader;
        return {
          ...shader,
          params: shader.params.map((param) =>
            param.paramName === paramName
              ? { ...param, paramValue: newValue }
              : param,
          ),
        };
      });
      void applyClipPatch({ shaders }).finally(() =>
        setParamLoading((prev) => ({ ...prev, [shaderId]: null })),
      );
    },
    [selectedTimelineClip, applyClipPatch],
  );

  const getShaderParamConfig = useCallback(
    (shaderId: string, paramName: string) =>
      selectedTimelineClip?.blockSettings.shaders
        ?.find((shader) => shader.shaderId === shaderId)
        ?.params.find((param) => param.paramName === paramName),
    [selectedTimelineClip],
  );

  if (!selectedTimelineClip) {
    return null;
  }

  const shaderInput: Input = selectedInput ?? {
    id: -1,
    inputId: selectedTimelineClip.inputId,
    title: selectedTimelineClip.inputId,
    description: '',
    showTitle: selectedTimelineClip.blockSettings.showTitle,
    volume: selectedTimelineClip.blockSettings.volume,
    type: 'local-mp4',
    sourceState: 'unknown',
    status: 'connected',
    shaders: selectedTimelineClip.blockSettings.shaders,
    orientation: selectedTimelineClip.blockSettings.orientation,
    attachedInputIds: selectedTimelineClip.blockSettings.attachedInputIds,
    borderColor: selectedTimelineClip.blockSettings.borderColor,
    borderWidth: selectedTimelineClip.blockSettings.borderWidth,
  };
  shaderInput.shaders = selectedTimelineClip.blockSettings.shaders;

  return (
    <div className='mt-3 p-3 rounded-md border border-neutral-800 bg-neutral-900'>
      <div className='text-xs text-neutral-500 mb-2'>
        Selected block properties
      </div>
      <div className='text-sm text-neutral-300 mb-3 truncate'>
        {selectedInput?.title ?? selectedTimelineClip.inputId}
      </div>
      <div className='grid grid-cols-2 gap-2 mb-2'>
        <label className='text-xs text-neutral-400'>Volume</label>
        <input
          type='range'
          min={0}
          max={1}
          step={0.01}
          value={selectedTimelineClip.blockSettings.volume}
          onChange={(e) => {
            void applyClipPatch({ volume: Number(e.target.value) });
          }}
        />
      </div>
      <div className='flex items-center justify-between mb-2'>
        <span className='text-xs text-neutral-400'>Show title</span>
        <input
          type='checkbox'
          checked={selectedTimelineClip.blockSettings.showTitle}
          onChange={(e) => {
            void applyClipPatch({ showTitle: e.target.checked });
          }}
        />
      </div>
      <div className='flex items-center justify-between mb-2'>
        <span className='text-xs text-neutral-400'>Orientation</span>
        <select
          className='bg-neutral-800 border border-neutral-700 text-white text-xs px-2 py-1'
          value={selectedTimelineClip.blockSettings.orientation}
          onChange={(e) =>
            void applyClipPatch({
              orientation: e.target.value as 'horizontal' | 'vertical',
            })
          }>
          <option value='horizontal'>Horizontal</option>
          <option value='vertical'>Vertical</option>
        </select>
      </div>
      <div className='grid grid-cols-2 gap-2 mb-2'>
        <div>
          <label className='text-xs text-neutral-400 block mb-1'>
            Border color
          </label>
          <input
            type='color'
            className='w-full h-8 bg-neutral-800 border border-neutral-700'
            value={selectedTimelineClip.blockSettings.borderColor || '#ff0000'}
            onChange={(e) =>
              void applyClipPatch({ borderColor: e.target.value })
            }
          />
        </div>
        <div>
          <label className='text-xs text-neutral-400 block mb-1'>
            Border width
          </label>
          <input
            type='number'
            min={0}
            max={100}
            className='w-full bg-neutral-800 border border-neutral-700 text-white text-xs px-2 py-1'
            value={selectedTimelineClip.blockSettings.borderWidth ?? 0}
            onChange={(e) =>
              void applyClipPatch({
                borderWidth: Math.max(0, Number(e.target.value) || 0),
              })
            }
          />
        </div>
      </div>
      {selectedInput?.type === 'text-input' && (
        <div className='mt-2 space-y-2'>
          <div>
            <label className='text-xs text-neutral-400 block mb-1'>Text</label>
            <textarea
              className='w-full bg-neutral-800 border border-neutral-700 text-white text-xs p-2 min-h-[80px]'
              value={selectedTimelineClip.blockSettings.text || ''}
              onChange={(e) => void applyClipPatch({ text: e.target.value })}
            />
          </div>
          <div className='grid grid-cols-2 gap-2'>
            <div>
              <label className='text-xs text-neutral-400 block mb-1'>
                Align
              </label>
              <select
                className='w-full bg-neutral-800 border border-neutral-700 text-white text-xs px-2 py-1'
                value={selectedTimelineClip.blockSettings.textAlign || 'left'}
                onChange={(e) =>
                  void applyClipPatch({
                    textAlign: e.target.value as 'left' | 'center' | 'right',
                  })
                }>
                <option value='left'>Left</option>
                <option value='center'>Center</option>
                <option value='right'>Right</option>
              </select>
            </div>
            <div>
              <label className='text-xs text-neutral-400 block mb-1'>
                Text color
              </label>
              <input
                type='color'
                className='w-full h-8 bg-neutral-800 border border-neutral-700'
                value={
                  selectedTimelineClip.blockSettings.textColor || '#ffffff'
                }
                onChange={(e) =>
                  void applyClipPatch({ textColor: e.target.value })
                }
              />
            </div>
          </div>
          <div className='grid grid-cols-2 gap-2'>
            <div>
              <label className='text-xs text-neutral-400 block mb-1'>
                Font size
              </label>
              <input
                type='number'
                min={8}
                max={300}
                className='w-full bg-neutral-800 border border-neutral-700 text-white text-xs px-2 py-1'
                value={selectedTimelineClip.blockSettings.textFontSize ?? 80}
                onChange={(e) =>
                  void applyClipPatch({
                    textFontSize: Number(e.target.value) || 80,
                  })
                }
              />
            </div>
            <div>
              <label className='text-xs text-neutral-400 block mb-1'>
                Max lines
              </label>
              <input
                type='number'
                min={1}
                max={50}
                className='w-full bg-neutral-800 border border-neutral-700 text-white text-xs px-2 py-1'
                value={selectedTimelineClip.blockSettings.textMaxLines ?? 10}
                onChange={(e) =>
                  void applyClipPatch({
                    textMaxLines: Number(e.target.value) || 10,
                  })
                }
              />
            </div>
          </div>
          <div>
            <label className='text-xs text-neutral-400 block mb-1'>
              Scroll speed
            </label>
            <input
              type='range'
              min={1}
              max={400}
              step={1}
              value={selectedTimelineClip.blockSettings.textScrollSpeed ?? 40}
              onChange={(e) =>
                void applyClipPatch({
                  textScrollSpeed: Number(e.target.value) || 40,
                })
              }
            />
          </div>
          <div className='flex items-center justify-between'>
            <span className='text-xs text-neutral-400'>Scroll loop</span>
            <input
              type='checkbox'
              checked={
                selectedTimelineClip.blockSettings.textScrollLoop ?? true
              }
              onChange={(e) =>
                void applyClipPatch({ textScrollLoop: e.target.checked })
              }
            />
          </div>
        </div>
      )}
      <div className='mt-3 border-t border-neutral-800 pt-2'>
        <div className='text-xs text-neutral-400 mb-1'>
          Shaders (block-level)
        </div>
        <div className='text-[11px] text-neutral-500 mb-2'>
          Edit this block's shaders independently from other blocks.
        </div>
        <ShaderPanel
          input={shaderInput}
          availableShaders={availableShaders}
          sliderValues={sliderValues}
          paramLoading={paramLoading}
          shaderLoading={shaderLoading}
          onShaderToggle={handleShaderToggle}
          onShaderRemove={handleShaderRemove}
          onSliderChange={handleSliderChange}
          getShaderParamConfig={getShaderParamConfig}
          getShaderButtonClass={() => ''}
          consolidated={true}
        />
      </div>
    </div>
  );
}
