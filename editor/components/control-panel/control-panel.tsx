'use client';

import { fadeIn } from '@/utils/animations';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import type {
  RoomState,
  Input,
  AvailableShader,
  PendingWhipInputData,
} from '@/lib/types';
import { useActions } from './contexts/actions-context';
import { ActionsProvider } from './contexts/actions-context';
import { defaultActions, SESSION_SOURCE_ID } from './contexts/default-actions';
import { useRecordingControls } from './hooks/use-recording-controls';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  SlidersHorizontal,
  Zap,
  Download,
  Upload,
  ToggleLeft,
  ToggleRight,
  Circle,
} from 'lucide-react';
import {
  useControlPanelState,
  type InputWrapper,
} from './hooks/use-control-panel-state';
import { useWhipConnections } from './hooks/use-whip-connections';
import {
  useRoomWebSocket,
  type ConnectedPeer,
} from './hooks/use-room-websocket';
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
  resolveRoomConfigTimelineState,
  restoreTimelineToStorage,
  type RoomConfig,
  type RoomConfigInput,
} from '@/lib/room-config';
import { SaveConfigModal, LoadConfigModal } from './components/ConfigModals';
import { TransitionSettings } from './components/TransitionSettings';
import {
  rotateBy90,
  type RotationAngle,
} from './whip-input/utils/whip-publisher';
import { loadLastWhipInputId } from './whip-input/utils/whip-storage';
import {
  ControlPanelProvider,
  useControlPanelContext,
} from './contexts/control-panel-context';
import {
  WhipConnectionsProvider,
  useWhipConnectionsContext,
} from './contexts/whip-connections-context';
import {
  useAutoPlayMacroSetting,
  useFeedbackPositionSetting,
  useFeedbackEnabledSetting,
  useFeedbackSizeSetting,
  useFeedbackDurationSetting,
  useDefaultOrientationSetting,
  useVoicePanelSizeSetting,
  useVoicePanelOpacitySetting,
} from '@/lib/voice/macroSettings';
import { FeedbackPositionPicker } from '@/components/voice-action-feedback/FeedbackPositionPicker';
import {
  BlockClipPropertiesPanel,
  type SelectedTimelineClip,
} from './components/BlockClipPropertiesPanel';
import type { TimelineState } from './hooks/use-timeline-state';
import { useMotionScores } from '@/hooks/use-motion-scores';
import { useMotionHistory } from '@/hooks/use-motion-history';
import { InputMotionPanel } from './components/InputMotionPanel';
import { motionPanelId } from '@/components/dashboard/panel-registry';
import { ErrorBoundary } from '@/components/error-boundary';

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
  renderDashboard?: (panels: {
    addVideoSection: React.ReactNode;
    buttonsSection: React.ReactNode;
    streamsSection: React.ReactNode;
    fxSection: React.ReactNode;
    timelineSection: React.ReactNode;
    blockPropertiesSection: React.ReactNode;
    motionPanels: Record<string, React.ReactNode>;
    peers: ConnectedPeer[];
  }) => React.ReactNode;
};

export type { InputWrapper } from './hooks/use-control-panel-state';

export default function ControlPanel(props: ControlPanelProps) {
  return (
    <ActionsProvider actions={defaultActions}>
      <ControlPanelWithActions {...props} />
    </ActionsProvider>
  );
}

function ControlPanelWithActions({
  refreshState,
  roomId,
  roomState,
  isGuest,
  onGuestStreamChange,
  onGuestInputIdChange,
  onGuestRotateRef,
  renderStreamsOutside,
  timelinePortalRef,
  renderDashboard,
}: ControlPanelProps) {
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

  const { peers } = useRoomWebSocket(roomId, {
    onRemoteInputChange: handleRefreshState,
    ownSourceId: SESSION_SOURCE_ID,
  });

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
          await defaultActions.updateInput(roomId, guestInputId, {
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
      await defaultActions.setPendingWhipInputs(roomId, serverData);
      await handleRefreshState();
    },
    [roomId, handleRefreshState],
  );

  const isRecordingFromServer = roomState.isRecording ?? false;
  const isFrozenFromServer = roomState.isFrozen ?? false;
  const motionScores = useMotionScores(roomId);

  const controlPanelCtx = useMemo(
    () => ({
      roomId,
      refreshState: handleRefreshState,
      inputs,
      inputsRef,
      availableShaders,
      isRecording: isRecordingFromServer,
      isFrozen: isFrozenFromServer,
      motionScores,
    }),
    [
      roomId,
      handleRefreshState,
      inputs,
      inputsRef,
      availableShaders,
      isRecordingFromServer,
      isFrozenFromServer,
      motionScores,
    ],
  );

  return (
    <ControlPanelProvider value={controlPanelCtx}>
      <WhipConnectionsProvider value={whipConnections}>
        <ControlPanelInner
          roomState={roomState}
          inputWrappers={inputWrappers}
          setInputWrappers={setInputWrappers}
          listVersion={listVersion}
          setListVersion={setListVersion}
          showStreamsSpinner={showStreamsSpinner}
          updateOrderWithLock={updateOrderWithLock}
          openFxInputId={openFxInputId}
          setOpenFxInputId={setOpenFxInputId}
          selectedInputId={selectedInputId}
          setSelectedInputId={setSelectedInputId}
          isSwapping={isSwapping}
          pendingWhipInputs={pendingWhipInputs}
          handleSetPendingWhipInputs={handleSetPendingWhipInputs}
          isGuest={isGuest}
          renderStreamsOutside={renderStreamsOutside}
          timelinePortalRef={timelinePortalRef}
          renderDashboard={renderDashboard}
          peers={peers}
        />
      </WhipConnectionsProvider>
    </ControlPanelProvider>
  );
}

type ControlPanelInnerProps = {
  roomState: RoomState;
  inputWrappers: InputWrapper[];
  setInputWrappers: (
    wrappers: InputWrapper[] | ((prev: InputWrapper[]) => InputWrapper[]),
  ) => void;
  listVersion: number;
  setListVersion: (v: number | ((prev: number) => number)) => void;
  showStreamsSpinner: boolean;
  updateOrderWithLock: (wrappers: InputWrapper[]) => Promise<void>;
  openFxInputId: string | null;
  setOpenFxInputId: React.Dispatch<React.SetStateAction<string | null>>;
  selectedInputId: string | null;
  setSelectedInputId: (id: string | null) => void;
  isSwapping: boolean;
  pendingWhipInputs: PendingWhipInput[];
  handleSetPendingWhipInputs: (inputs: PendingWhipInput[]) => Promise<void>;
  isGuest?: boolean;
  renderStreamsOutside?: boolean;
  timelinePortalRef?: React.RefObject<HTMLDivElement | null>;
  renderDashboard?: ControlPanelProps['renderDashboard'];
  peers: ConnectedPeer[];
};

function ControlPanelInner({
  roomState,
  inputWrappers,
  setInputWrappers,
  listVersion,
  setListVersion,
  showStreamsSpinner,
  updateOrderWithLock,
  openFxInputId,
  setOpenFxInputId,
  selectedInputId,
  setSelectedInputId,
  isSwapping,
  pendingWhipInputs,
  handleSetPendingWhipInputs,
  isGuest,
  renderStreamsOutside,
  timelinePortalRef,
  renderDashboard,
  peers,
}: ControlPanelInnerProps) {
  const {
    roomId,
    refreshState: handleRefreshState,
    inputs,
    availableShaders,
    motionScores,
  } = useControlPanelContext();
  const motionHistoryMap = useMotionHistory(inputs, motionScores);
  const { activeCameraInputId, activeScreenshareInputId } =
    useWhipConnectionsContext();
  const actions = useActions();
  const updateRoomAction = actions.updateRoom;
  const updateInputAction = actions.updateInput;
  const configStorageSave = actions.configStorage.save;

  useControlPanelEvents({
    inputWrappers,
    setInputWrappers,
    setListVersion,
    updateOrder: updateOrderWithLock,
    selectedInputId,
    setSelectedInputId,
  });

  const handleToggleFx = (inputId: string) => {
    setOpenFxInputId((prev) => (prev === inputId ? null : inputId));
  };

  const fxInput =
    openFxInputId && inputs.find((i) => i.inputId === openFxInputId)
      ? inputs.find((i) => i.inputId === openFxInputId)!
      : null;

  const [selectedTimelineClips, setSelectedTimelineClips] = useState<
    SelectedTimelineClip[]
  >([]);
  const [timelinePlayheadMs, setTimelinePlayheadMs] = useState(0);
  const timelineStateRef = useRef<TimelineState | null>(null);
  const timelineLoadStateRef = useRef<((state: TimelineState) => void) | null>(
    null,
  );

  const handleTimelineStateChange = useCallback(
    (state: TimelineState) => {
      timelineStateRef.current = state;
      if (selectedTimelineClips.length > 0) {
        setTimelinePlayheadMs((prev) =>
          prev === state.playheadMs ? prev : state.playheadMs,
        );
      }
    },
    [selectedTimelineClips.length],
  );

  const handleTimelineLoadStateReady = useCallback(
    (loadState: (state: TimelineState) => void) => {
      timelineLoadStateRef.current = loadState;
    },
    [],
  );

  const getTimelineStateForConfig = useCallback(
    () => timelineStateRef.current,
    [],
  );

  const applyImportedTimelineState = useCallback(
    (state: TimelineState | null) => {
      if (state) {
        timelineLoadStateRef.current?.(state);
      }
      timelineStateRef.current = state;
      setTimelinePlayheadMs(state?.playheadMs ?? 0);
    },
    [],
  );

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ clips: SelectedTimelineClip[] }>)
        .detail;
      setSelectedTimelineClips(detail?.clips ?? []);
    };
    window.addEventListener('smelter:timeline:selected-clip', handler);
    return () =>
      window.removeEventListener('smelter:timeline:selected-clip', handler);
  }, []);

  useEffect(() => {
    timelineStateRef.current = null;
    timelineLoadStateRef.current = null;
    setTimelinePlayheadMs(0);
  }, [roomId]);

  useEffect(() => {
    if (selectedTimelineClips.length === 0) {
      return;
    }
    setTimelinePlayheadMs(timelineStateRef.current?.playheadMs ?? 0);
  }, [selectedTimelineClips.length]);

  if (renderDashboard) {
    const addVideoSection = (
      <div className='h-full overflow-y-auto flex flex-col gap-3 p-3'>
        <AddVideoSection
          isGuest={isGuest}
          hasGuestInput={
            isGuest
              ? !!(activeCameraInputId || activeScreenshareInputId) ||
                (!!loadLastWhipInputId(roomId) &&
                  inputs.some((i) => i.inputId === loadLastWhipInputId(roomId)))
              : false
          }
        />
      </div>
    );

    const buttonsSection = (
      <div className='h-full overflow-y-auto p-3'>
        <ErrorBoundary>
          <SettingsBar
            roomState={roomState}
            pendingWhipInputs={pendingWhipInputs}
            setPendingWhipInputs={handleSetPendingWhipInputs}
            getTimelineStateForConfig={getTimelineStateForConfig}
            applyImportedTimelineState={applyImportedTimelineState}
          />
        </ErrorBoundary>
      </div>
    );

    const streamsSection = (
      <div className='h-full overflow-y-auto p-3'>
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
      </div>
    );

    const fxSection = fxInput ? (
      <div className='h-full overflow-y-auto p-3'>
        <FxAccordion fxInput={fxInput} onClose={() => setOpenFxInputId(null)} />
      </div>
    ) : (
      <div className='h-full flex items-center justify-center text-neutral-500 text-sm'>
        Select a stream to edit FX
      </div>
    );

    const timelineSection = (
      <ErrorBoundary>
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
          fillContainer
          onTimelineStateChange={handleTimelineStateChange}
          onTimelineLoadStateReady={handleTimelineLoadStateReady}
        />
      </ErrorBoundary>
    );

    const blockPropertiesSection = (
      <div className='h-full overflow-y-auto p-3'>
        <BlockClipPropertiesPanel
          roomId={roomId}
          selectedTimelineClips={selectedTimelineClips}
          onSelectedTimelineClipsChange={setSelectedTimelineClips}
          playheadMs={timelinePlayheadMs}
          inputs={inputs}
          availableShaders={availableShaders}
          handleRefreshState={handleRefreshState}
          resolution={roomState.resolution}
          pendingWhipInputs={isGuest ? undefined : pendingWhipInputs}
          setPendingWhipInputs={
            isGuest ? undefined : handleSetPendingWhipInputs
          }
        />
      </div>
    );

    const videoInputTypes = [
      'local-mp4',
      'twitch-channel',
      'kick-channel',
      'whip',
    ];
    const motionPanels: Record<string, React.ReactNode> = {};
    for (const input of inputs) {
      if (!videoInputTypes.includes(input.type)) continue;
      const panelId = motionPanelId(input.inputId);
      const history = motionHistoryMap.get(input.inputId);
      motionPanels[panelId] = (
        <InputMotionPanel
          roomId={roomId}
          input={input}
          motionHistory={history ?? null}
          motionScore={motionScores[input.inputId]}
          refreshState={handleRefreshState}
        />
      );
    }

    return (
      <>
        <video
          id='local-preview'
          muted
          playsInline
          autoPlay
          className='hidden'
        />
        {renderDashboard({
          addVideoSection,
          buttonsSection,
          streamsSection,
          fxSection,
          timelineSection,
          blockPropertiesSection,
          motionPanels,
          peers,
        })}
      </>
    );
  }

  const streamsSectionContent = !fxInput ? (
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
    <ErrorBoundary>
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
        fillContainer={false}
        onTimelineStateChange={handleTimelineStateChange}
        onTimelineLoadStateReady={handleTimelineLoadStateReady}
      />
    </ErrorBoundary>
  ) : null;

  const mainPanel = (
    <motion.div
      {...(fadeIn as any)}
      className='flex flex-col flex-1 mt-6 min-h-0 gap-3 rounded-none bg-neutral-950'>
      <video id='local-preview' muted playsInline autoPlay className='hidden' />

      {fxInput ? (
        <FxAccordion fxInput={fxInput} onClose={() => setOpenFxInputId(null)} />
      ) : (
        <>
          <AddVideoSection
            isGuest={isGuest}
            hasGuestInput={
              isGuest
                ? !!(activeCameraInputId || activeScreenshareInputId) ||
                  (!!loadLastWhipInputId(roomId) &&
                    inputs.some(
                      (i) => i.inputId === loadLastWhipInputId(roomId),
                    ))
                : false
            }
          />
          {!isGuest && !renderStreamsOutside && streamsSectionContent}
          {!isGuest && (
            <ErrorBoundary>
              <SettingsBar
                roomState={roomState}
                pendingWhipInputs={pendingWhipInputs}
                setPendingWhipInputs={handleSetPendingWhipInputs}
                getTimelineStateForConfig={getTimelineStateForConfig}
                applyImportedTimelineState={applyImportedTimelineState}
              />
            </ErrorBoundary>
          )}
        </>
      )}
    </motion.div>
  );

  if (renderStreamsOutside) {
    return (
      <>
        {mainPanel}
        {timelineSection &&
          timelinePortalRef?.current &&
          createPortal(timelineSection, timelinePortalRef.current)}
      </>
    );
  }

  return mainPanel;
}

type ModalId = 'quickActions' | 'settings';

function SettingsBar({
  roomState,
  pendingWhipInputs,
  setPendingWhipInputs,
  getTimelineStateForConfig,
  applyImportedTimelineState,
}: {
  roomState: RoomState;
  pendingWhipInputs: PendingWhipInput[];
  setPendingWhipInputs: (inputs: PendingWhipInput[]) => void | Promise<void>;
  getTimelineStateForConfig: () => TimelineState | null;
  applyImportedTimelineState: (state: TimelineState | null) => void;
}) {
  const { roomId, refreshState: handleRefreshState } = useControlPanelContext();
  const actions = useActions();
  const updateRoomAction = actions.updateRoom;
  const updateInputAction = actions.updateInput;
  const configStorageSave = actions.configStorage.save;
  const addTwitchInput = actions.addTwitchInput;
  const addKickInput = actions.addKickInput;
  const addMP4Input = actions.addMP4Input;
  const addImageInput = actions.addImageInput;
  const addTextInput = actions.addTextInput;
  const addSnakeGameInput = actions.addSnakeGameInput;
  const removeInput = actions.removeInput;
  const [openModal, setOpenModal] = useState<ModalId | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [autoPlayMacro, setAutoPlayMacro] = useAutoPlayMacroSetting();
  const [feedbackPosition, setFeedbackPosition] = useFeedbackPositionSetting();
  const [feedbackEnabled, setFeedbackEnabled] = useFeedbackEnabledSetting();
  const [feedbackSize, setFeedbackSize] = useFeedbackSizeSetting();
  const [feedbackDuration, setFeedbackDuration] = useFeedbackDurationSetting();
  const [defaultOrientation, setDefaultOrientation] =
    useDefaultOrientationSetting();
  const [voicePanelSize, setVoicePanelSize] = useVoicePanelSizeSetting();
  const [voicePanelOpacity, setVoicePanelOpacity] =
    useVoicePanelOpacitySetting();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const serverIsRecording = roomState.isRecording ?? false;
  const {
    isTogglingRecording,
    isWaitingForDownload,
    effectiveIsRecording: isRecording,
    toggle: handleToggleRecording,
  } = useRecordingControls(roomId, serverIsRecording, handleRefreshState);

  const [isTogglingPublic, setIsTogglingPublic] = useState(false);
  const handleTogglePublic = useCallback(async () => {
    if (isTogglingPublic) return;
    setIsTogglingPublic(true);
    try {
      await updateRoomAction(roomId, { isPublic: !roomState.isPublic });
      await handleRefreshState();
    } catch (err) {
      console.error('Failed to toggle public state', err);
    } finally {
      setIsTogglingPublic(false);
    }
  }, [roomId, roomState.isPublic, handleRefreshState, isTogglingPublic]);

  const buildConfig = useCallback(() => {
    const timelineState = resolveRoomConfigTimelineState(
      roomId,
      getTimelineStateForConfig(),
    );
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
  }, [getTimelineStateForConfig, roomState, roomId]);

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
      const result = await configStorageSave(name, config);
      if (!result.ok) {
        return result.error;
      }
      return null;
    },
    [buildConfig, configStorageSave],
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
            case 'game': {
              const result = await addSnakeGameInput(roomId, inputConfig.title);
              inputId = result.inputId;
              break;
            }
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
            gameBackgroundColor: inputConfig.gameBackgroundColor,
            gameCellGap: inputConfig.gameCellGap,
            gameBoardBorderColor: inputConfig.gameBoardBorderColor,
            gameBoardBorderWidth: inputConfig.gameBoardBorderWidth,
            gameGridLineColor: inputConfig.gameGridLineColor,
            gameGridLineAlpha: inputConfig.gameGridLineAlpha,
            snakeEventShaders: inputConfig.snakeEventShaders,
            snake1Shaders: inputConfig.snake1Shaders,
            snake2Shaders: inputConfig.snake2Shaders,
            absolutePosition: inputConfig.absolutePosition,
            absoluteTop: inputConfig.absoluteTop,
            absoluteLeft: inputConfig.absoluteLeft,
            absoluteWidth: inputConfig.absoluteWidth,
            absoluteHeight: inputConfig.absoluteHeight,
            absoluteTransitionDurationMs:
              inputConfig.absoluteTransitionDurationMs,
            absoluteTransitionEasing: inputConfig.absoluteTransitionEasing,
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
        const restoredTimelineState = loadTimelineFromStorage(roomId);
        if (restoredTimelineState) {
          const nextTimelineState: TimelineState = {
            ...restoredTimelineState,
            playheadMs: 0,
            isPlaying: false,
          };
          applyImportedTimelineState(nextTimelineState);
        } else {
          applyImportedTimelineState(null);
        }
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
    [
      roomId,
      roomState.inputs,
      handleRefreshState,
      setPendingWhipInputs,
      applyImportedTimelineState,
    ],
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
        label: 'Actions',
        icon: <Zap className='w-4 h-4' />,
      },
      {
        id: 'settings',
        label: 'Settings',
        icon: <SlidersHorizontal className='w-4 h-4' />,
      },
    ];

  const btnClass =
    'flex flex-col items-center gap-1.5 px-2 py-3 rounded-md border border-neutral-800 bg-neutral-900 hover:bg-neutral-800 hover:border-neutral-600 transition-all cursor-pointer group';

  const recordLabel = isWaitingForDownload
    ? 'Wait...'
    : isRecording
      ? 'Stop Rec'
      : 'Record';

  return (
    <>
      <div className='grid grid-cols-6 gap-2'>
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
        <button
          onClick={handleTogglePublic}
          disabled={isTogglingPublic}
          className={`${btnClass} ${roomState.isPublic ? 'border-white/20 bg-neutral-700' : ''}`}>
          <span
            className={`transition-colors ${roomState.isPublic ? 'text-white' : 'text-neutral-400 group-hover:text-white'}`}>
            {roomState.isPublic ? (
              <ToggleRight className='w-4 h-4' />
            ) : (
              <ToggleLeft className='w-4 h-4' />
            )}
          </span>
          <span
            className={`text-[11px] font-medium transition-colors leading-tight text-center ${roomState.isPublic ? 'text-neutral-200' : 'text-neutral-400 group-hover:text-white'}`}>
            Public
          </span>
        </button>
        <button
          onClick={handleToggleRecording}
          disabled={isTogglingRecording || isWaitingForDownload}
          className={`${btnClass} ${isRecording ? 'border-red-500/50 bg-red-950/30' : ''}`}>
          <span
            className={`transition-colors ${isRecording ? 'text-red-400 group-hover:text-red-300' : 'text-neutral-400 group-hover:text-white'}`}>
            <Circle className='w-4 h-4' />
          </span>
          <span className='text-[11px] font-medium text-neutral-400 group-hover:text-white transition-colors leading-tight text-center'>
            {recordLabel}
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
        open={openModal === 'settings'}
        onOpenChange={(open) => !open && setOpenModal(null)}>
        <DialogContent className='max-w-2xl'>
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
          </DialogHeader>
          <div className='grid grid-cols-2 gap-6'>
            <section className='space-y-2'>
              <h4 className='text-sm font-medium text-white'>
                Transition Settings
              </h4>
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
                newsStripFadeDuringSwap={
                  roomState.newsStripFadeDuringSwap ?? true
                }
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
            </section>
            <div className='space-y-4'>
              <section className='space-y-2 px-1'>
                <h4 className='text-sm font-medium text-white'>
                  Macros Settings
                </h4>
                <label className='flex items-center gap-2 cursor-pointer'>
                  <input
                    type='checkbox'
                    checked={autoPlayMacro}
                    onChange={(e) => {
                      setAutoPlayMacro(e.target.checked);
                    }}
                    className='accent-white'
                  />
                  <span className='text-xs text-neutral-400'>
                    Auto Play Macro
                  </span>
                </label>
                <label className='flex items-center gap-2 cursor-pointer'>
                  <input
                    type='checkbox'
                    checked={voicePanelSize === 's'}
                    onChange={(e) =>
                      setVoicePanelSize(e.target.checked ? 's' : 'l')
                    }
                    className='accent-white'
                  />
                  <span className='text-xs text-neutral-400'>
                    Compact Voice Panel
                  </span>
                </label>
                <div className='flex items-center justify-between gap-3'>
                  <span className='text-xs text-neutral-400 shrink-0'>
                    Panel Opacity
                  </span>
                  <input
                    type='range'
                    min={0}
                    max={100}
                    step={5}
                    value={voicePanelOpacity}
                    onChange={(e) =>
                      setVoicePanelOpacity(Number(e.target.value))
                    }
                    className='flex-1 accent-white h-1'
                  />
                  <span className='text-xs text-neutral-500 w-8 text-right tabular-nums'>
                    {voicePanelOpacity}%
                  </span>
                </div>
              </section>
              <div className='h-px bg-neutral-800' />
              <section className='space-y-2 px-1'>
                <h4 className='text-sm font-medium text-white'>
                  Input Defaults
                </h4>
                <div className='flex items-center justify-between'>
                  <span className='text-xs text-neutral-400'>
                    Default Orientation
                  </span>
                  <select
                    className='bg-neutral-800 border border-neutral-700 text-white text-xs px-2 py-1 rounded'
                    value={defaultOrientation}
                    onChange={(e) =>
                      setDefaultOrientation(
                        e.target.value as 'horizontal' | 'vertical',
                      )
                    }>
                    <option value='horizontal'>Horizontal</option>
                    <option value='vertical'>Vertical</option>
                  </select>
                </div>
              </section>
              <div className='h-px bg-neutral-800' />
              <section className='space-y-2 px-1'>
                <h4 className='text-sm font-medium text-white'>
                  Toast Notifications
                </h4>
                <FeedbackPositionPicker
                  enabled={feedbackEnabled}
                  onEnabledChange={setFeedbackEnabled}
                  position={feedbackPosition}
                  onPositionChange={setFeedbackPosition}
                  size={feedbackSize}
                  onSizeChange={setFeedbackSize}
                  duration={feedbackDuration}
                  onDurationChange={setFeedbackDuration}
                />
              </section>
            </div>
          </div>
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
