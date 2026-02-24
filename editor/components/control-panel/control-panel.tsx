'use client';

import { fadeIn } from '@/utils/animations';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import type { RoomState, Input, AvailableShader } from '@/app/actions/actions';
import {
  setPendingWhipInputs as setPendingWhipInputsAction,
  updateRoom as updateRoomAction,
  updateInput as updateInputAction,
  addTwitchInput,
  addKickInput,
  addMP4Input,
  addImageInput,
  addTextInput,
  removeInput,
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
import {
  Grid3X3,
  SlidersHorizontal,
  Zap,
  Download,
  Upload,
} from 'lucide-react';
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
import { type PendingWhipInput } from './components/ConfigurationSection';
import {
  exportRoomConfig,
  downloadRoomConfig,
  parseRoomConfig,
  loadTimelineFromStorage,
  restoreTimelineToStorage,
  type RoomConfig,
  type RoomConfigInput,
} from '@/lib/room-config';
import { saveRemoteConfig } from '@/app/actions/actions';
import { SaveConfigModal, LoadConfigModal } from './components/ConfigModals';
import { PendingWhipInputs } from './components/PendingWhipInputs';
import { TransitionSettings } from './components/TransitionSettings';
import {
  rotateBy90,
  type RotationAngle,
} from './whip-input/utils/whip-publisher';
import { ControlPanelProvider } from './contexts/control-panel-context';
import { WhipConnectionsProvider } from './contexts/whip-connections-context';
import {
  BlockClipPropertiesPanel,
  type SelectedTimelineClip,
} from './components/BlockClipPropertiesPanel';

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

type ModalId = 'quickActions' | 'layouts' | 'transitions';

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
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const buildConfig = useCallback(() => {
    const timelineState = loadTimelineFromStorage(roomId);
    return exportRoomConfig(
      roomState.inputs,
      roomState.layout,
      roomState.resolution,
      {
        swapDurationMs: roomState.swapDurationMs,
        swapOutgoingEnabled: roomState.swapOutgoingEnabled,
        swapFadeInDurationMs: roomState.swapFadeInDurationMs,
        swapFadeOutDurationMs: roomState.swapFadeOutDurationMs,
        newsStripFadeDuringSwap: roomState.newsStripFadeDuringSwap,
        newsStripEnabled: roomState.newsStripEnabled,
      },
      timelineState ?? undefined,
    );
  }, [roomState, roomId]);

  const handleExportLocal = useCallback(() => {
    setIsExporting(true);
    try {
      const config = buildConfig();
      downloadRoomConfig(config);
    } catch (e: any) {
      console.error('Export failed:', e);
    } finally {
      setIsExporting(false);
    }
  }, [buildConfig]);

  const handleExportRemote = useCallback(
    async (name: string): Promise<string | null> => {
      const config = buildConfig();
      const result = await saveRemoteConfig(name, config);
      if (!result.ok) {
        return result.error;
      }
      return null;
    },
    [buildConfig],
  );

  useEffect(() => {
    const onVoiceExport = () => {
      handleExportLocal();
    };
    window.addEventListener('smelter:export-configuration', onVoiceExport);
    return () => {
      window.removeEventListener('smelter:export-configuration', onVoiceExport);
    };
  }, [handleExportLocal]);

  const importConfig = useCallback(
    async (config: RoomConfig) => {
      const oldInputIds = roomState.inputs.map((i) => i.inputId);
      const newPendingWhipInputs: PendingWhipInput[] = [];
      const createdInputIds: {
        inputId: string;
        config: RoomConfigInput;
        position: number;
      }[] = [];

      for (let i = 0; i < config.inputs.length; i++) {
        const inputConfig = config.inputs[i];
        try {
          let inputId: string | null = null;

          if (inputConfig.type === 'whip') {
            newPendingWhipInputs.push({
              id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              title: inputConfig.title,
              config: inputConfig,
              position: i,
            });
            continue;
          }

          switch (inputConfig.type) {
            case 'twitch-channel':
              if (inputConfig.channelId) {
                const result = await addTwitchInput(
                  roomId,
                  inputConfig.channelId,
                );
                inputId = result.inputId;
              }
              break;
            case 'kick-channel':
              if (inputConfig.channelId) {
                const result = await addKickInput(
                  roomId,
                  inputConfig.channelId,
                );
                inputId = result.inputId;
              }
              break;
            case 'local-mp4':
              if (inputConfig.mp4FileName) {
                const result = await addMP4Input(
                  roomId,
                  inputConfig.mp4FileName,
                );
                inputId = result.inputId;
              }
              break;
            case 'image':
              if (inputConfig.imageId) {
                const result = await addImageInput(roomId, inputConfig.imageId);
                inputId = result.inputId;
              }
              break;
            case 'text-input':
              if (inputConfig.text) {
                const result = await addTextInput(
                  roomId,
                  inputConfig.text,
                  inputConfig.textAlign || 'left',
                );
                inputId = result.inputId;
              }
              break;
          }

          if (inputId) {
            createdInputIds.push({
              inputId,
              config: inputConfig,
              position: i,
            });
          }
        } catch (e) {
          console.warn(`Failed to add input ${inputConfig.title}:`, e);
        }
      }

      await handleRefreshState();

      const positionToInputId = new Map<number, string>();
      for (const { inputId, position } of createdInputIds) {
        positionToInputId.set(position, inputId);
      }

      for (const { inputId, config: inputConfig } of createdInputIds) {
        const attachedInputIds = inputConfig.attachedInputIndices
          ?.map((idx) => positionToInputId.get(idx))
          .filter((id): id is string => !!id);

        try {
          await updateInputAction(roomId, inputId, {
            volume: inputConfig.volume,
            shaders: inputConfig.shaders,
            showTitle: inputConfig.showTitle,
            textColor: inputConfig.textColor,
            orientation: inputConfig.orientation,
            textMaxLines: inputConfig.textMaxLines,
            textScrollSpeed: inputConfig.textScrollSpeed,
            textScrollLoop: inputConfig.textScrollLoop,
            textFontSize: inputConfig.textFontSize,
            borderColor: inputConfig.borderColor,
            borderWidth: inputConfig.borderWidth,
            attachedInputIds:
              attachedInputIds && attachedInputIds.length > 0
                ? attachedInputIds
                : undefined,
          });
        } catch (e) {
          console.warn(`Failed to update input ${inputId}:`, e);
        }
      }

      for (const oldInputId of oldInputIds) {
        try {
          await removeInput(roomId, oldInputId);
        } catch (e) {
          console.warn(`Failed to remove old input ${oldInputId}:`, e);
        }
      }

      setPendingWhipInputs(newPendingWhipInputs);

      if (config.timeline) {
        const indexToInputId = new Map<number, string>();
        for (const { inputId, position } of createdInputIds) {
          indexToInputId.set(position, inputId);
        }
        for (const pending of newPendingWhipInputs) {
          indexToInputId.set(
            pending.position,
            `__pending-whip-${pending.position}__`,
          );
        }
        restoreTimelineToStorage(roomId, config.timeline, indexToInputId);
      }

      const orderedCreatedIds = createdInputIds
        .slice()
        .sort((a, b) => a.position - b.position)
        .map(({ inputId }) => inputId);

      try {
        await updateRoomAction(roomId, {
          layout: config.layout,
          ...(orderedCreatedIds.length > 0
            ? { inputOrder: orderedCreatedIds }
            : {}),
          ...config.transitionSettings,
        });
      } catch (e) {
        console.warn('Failed to set layout or input order:', e);
      }

      await handleRefreshState();
    },
    [roomId, roomState.inputs, handleRefreshState, setPendingWhipInputs],
  );

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsImporting(true);
      try {
        const text = await file.text();
        const config = parseRoomConfig(text);
        await importConfig(config);
      } catch (e: any) {
        console.error('Import failed:', e);
      } finally {
        setIsImporting(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    },
    [importConfig],
  );

  const modalButtons: { id: ModalId; label: string; icon: React.ReactNode }[] =
    [
      {
        id: 'quickActions',
        label: 'Quick Actions',
        icon: <Zap className='w-4 h-4' />,
      },
      {
        id: 'layouts',
        label: 'Layouts',
        icon: <Grid3X3 className='w-4 h-4' />,
      },
      {
        id: 'transitions',
        label: 'Transitions',
        icon: <SlidersHorizontal className='w-4 h-4' />,
      },
    ];

  const btnClass =
    'flex flex-col items-center gap-1.5 px-2 py-3 rounded-md border border-neutral-800 bg-neutral-900 hover:bg-neutral-800 hover:border-neutral-600 transition-all cursor-pointer group';

  return (
    <>
      <div className='grid grid-cols-5 gap-2'>
        {modalButtons.map((btn) => (
          <button
            key={btn.id}
            onClick={() => setOpenModal(btn.id)}
            className={btnClass}>
            <span className='text-neutral-400 group-hover:text-white transition-colors'>
              {btn.icon}
            </span>
            <span className='text-[11px] font-medium text-neutral-400 group-hover:text-white transition-colors leading-tight text-center'>
              {btn.label}
            </span>
          </button>
        ))}
        <button
          onClick={() => setShowSaveModal(true)}
          disabled={isExporting}
          className={btnClass}>
          <span className='text-neutral-400 group-hover:text-white transition-colors'>
            <Download className='w-4 h-4' />
          </span>
          <span className='text-[11px] font-medium text-neutral-400 group-hover:text-white transition-colors leading-tight text-center'>
            {isExporting ? 'Saving...' : 'Save'}
          </span>
        </button>
        <button
          onClick={() => setShowLoadModal(true)}
          disabled={isImporting}
          className={btnClass}>
          <span className='text-neutral-400 group-hover:text-white transition-colors'>
            <Upload className='w-4 h-4' />
          </span>
          <span className='text-[11px] font-medium text-neutral-400 group-hover:text-white transition-colors leading-tight text-center'>
            {isImporting ? 'Loading...' : 'Load'}
          </span>
        </button>
      </div>
      <input
        ref={fileInputRef}
        type='file'
        accept='.json,application/json'
        className='hidden'
        onChange={handleFileChange}
      />
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

      <SaveConfigModal
        open={showSaveModal}
        onOpenChange={setShowSaveModal}
        onSaveLocal={handleExportLocal}
        onSaveRemote={handleExportRemote}
        isExporting={isExporting}
      />

      <LoadConfigModal
        open={showLoadModal}
        onOpenChange={setShowLoadModal}
        onLoadLocal={() => fileInputRef.current?.click()}
        onLoadRemote={importConfig}
        isImporting={isImporting}
      />
    </>
  );
}
