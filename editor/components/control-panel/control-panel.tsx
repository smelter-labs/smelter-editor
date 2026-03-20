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
import { Switch } from '@/components/ui/switch';
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
import { StreamsSection } from './components/StreamsSection';
import { TimelinePanel } from './components/TimelinePanel';
import { AddVideoModal } from './components/AddVideoModal';
import { QuickActionsSection } from './components/QuickActionsSection';
import { type PendingWhipInput } from './components/ConfigurationSection';
import {
  exportRoomConfig,
  downloadRoomConfig,
  parseRoomConfig,
  loadTimelineFromStorage,
  resolveRoomConfigTimelineState,
  resolveImportedEqualizerConfig,
  restoreTimelineToStorage,
  loadOutputPlayerSettings,
  saveOutputPlayerSettings,
  type RoomConfig,
  type RoomConfigInput,
} from '@/lib/room-config';
import { SaveConfigModal, LoadConfigModal } from './components/ConfigModals';
import {
  GenericSaveModal,
  GenericLoadModal,
} from '@/components/storage-modals';
import {
  setAudioAnalysisEnabled,
  addEqualizerInput,
} from '@/app/actions/actions';
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
import {
  DashboardToolbarProvider,
  useDashboardToolbar,
} from '@/components/dashboard/dashboard-toolbar-context';
import { Input as ShadcnInput } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';

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
  settingsNavPortalRef?: React.RefObject<HTMLDivElement | null>;
  renderDashboard?: (panels: {
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
  settingsNavPortalRef,
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
  const audioAnalysisEnabledFromServer =
    roomState.audioAnalysisEnabled ?? false;
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
      audioAnalysisEnabled: audioAnalysisEnabledFromServer,
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
      audioAnalysisEnabledFromServer,
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
          settingsNavPortalRef={settingsNavPortalRef}
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
  settingsNavPortalRef?: React.RefObject<HTMLDivElement | null>;
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
  settingsNavPortalRef,
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
    const settingsNav = (
      <ErrorBoundary>
        <SettingsBar
          roomState={roomState}
          pendingWhipInputs={pendingWhipInputs}
          setPendingWhipInputs={handleSetPendingWhipInputs}
          getTimelineStateForConfig={getTimelineStateForConfig}
          applyImportedTimelineState={applyImportedTimelineState}
        />
      </ErrorBoundary>
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
      <div className='h-full flex items-center justify-center text-muted-foreground text-sm'>
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
      <DashboardToolbarProvider>
        <video
          id='local-preview'
          muted
          playsInline
          autoPlay
          className='hidden'
        />
        {settingsNavPortalRef?.current &&
          createPortal(settingsNav, settingsNavPortalRef.current)}
        {renderDashboard({
          streamsSection,
          fxSection,
          timelineSection,
          blockPropertiesSection,
          motionPanels,
          peers,
        })}
      </DashboardToolbarProvider>
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
      className='flex flex-col flex-1 mt-6 min-h-0 gap-3 rounded-none bg-background'>
      <video id='local-preview' muted playsInline autoPlay className='hidden' />

      {fxInput ? (
        <FxAccordion fxInput={fxInput} onClose={() => setOpenFxInputId(null)} />
      ) : (
        <>
          {!isGuest && !renderStreamsOutside && streamsSectionContent}
          {!isGuest &&
            settingsNavPortalRef?.current &&
            createPortal(
              <ErrorBoundary>
                <SettingsBar
                  roomState={roomState}
                  pendingWhipInputs={pendingWhipInputs}
                  setPendingWhipInputs={handleSetPendingWhipInputs}
                  getTimelineStateForConfig={getTimelineStateForConfig}
                  applyImportedTimelineState={applyImportedTimelineState}
                />
              </ErrorBoundary>,
              settingsNavPortalRef.current,
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
  const [showAddVideoModal, setShowAddVideoModal] = useState(false);
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
  const dashboardToolbar = useDashboardToolbar();
  const [showDashSaveModal, setShowDashSaveModal] = useState(false);
  const [showDashLoadModal, setShowDashLoadModal] = useState(false);
  const dashFileInputRef = useRef<HTMLInputElement>(null);

  const handleDashSaveRemote = useCallback(
    async (name: string): Promise<string | null> => {
      if (!dashboardToolbar) return 'Dashboard not ready';
      const data = dashboardToolbar.getCurrentLayoutData();
      const result = await dashboardToolbar.dashboardLayoutStorage.save(
        name,
        data,
      );
      if (!result.ok) return result.error;
      return null;
    },
    [dashboardToolbar],
  );

  const handleDashSaveLocal = useCallback(() => {
    if (!dashboardToolbar) return;
    const data = dashboardToolbar.getCurrentLayoutData();
    const name = `dashboard-layout-${Date.now()}`;
    const blob = new Blob([JSON.stringify({ name, layout: data }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [dashboardToolbar]);

  const handleDashLoadRemote = useCallback(
    (data: object) => {
      if (!dashboardToolbar) return;
      dashboardToolbar.applyLoadedLayout(
        data as Parameters<typeof dashboardToolbar.applyLoadedLayout>[0],
      );
    },
    [dashboardToolbar],
  );

  const handleDashFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !dashboardToolbar) return;
      file
        .text()
        .then((text) => {
          const parsed = JSON.parse(text);
          const layoutData = parsed.layout ?? parsed;
          dashboardToolbar.applyLoadedLayout(layoutData);
        })
        .catch((err) => {
          console.error('Failed to load dashboard layout from file:', err);
        })
        .finally(() => {
          if (dashFileInputRef.current) {
            dashFileInputRef.current.value = '';
          }
        });
    },
    [dashboardToolbar],
  );

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

  const audioAnalysisEnabled = roomState.audioAnalysisEnabled ?? false;
  const [isTogglingAudio, setIsTogglingAudio] = useState(false);
  const handleToggleAudioAnalysis = useCallback(async () => {
    if (isTogglingAudio) return;
    setIsTogglingAudio(true);
    try {
      await setAudioAnalysisEnabled(roomId, !audioAnalysisEnabled);
      await handleRefreshState();
    } catch (err) {
      console.error('Failed to toggle audio analysis', err);
    } finally {
      setIsTogglingAudio(false);
    }
  }, [roomId, audioAnalysisEnabled, handleRefreshState, isTogglingAudio]);

  const buildConfig = useCallback(() => {
    const timelineState = resolveRoomConfigTimelineState(
      roomId,
      getTimelineStateForConfig(),
    );
    const outputPlayer = loadOutputPlayerSettings(roomId) ?? undefined;
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
      outputPlayer,
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
      const deferredEqualizers: {
        config: RoomConfigInput;
        position: number;
      }[] = [];
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

          if (inputConfig.type === 'equalizer') {
            deferredEqualizers.push({ config: inputConfig, position: i });
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

      const positionToInputId = new Map<number, string>();
      for (const { inputId, position } of createdInputIds) {
        positionToInputId.set(position, inputId);
      }
      for (const pending of newPendingWhipInputs) {
        positionToInputId.set(
          pending.position,
          `__pending-whip-${pending.position}__`,
        );
      }

      for (const { config: inputConfig, position } of deferredEqualizers) {
        try {
          const equalizerConfig = resolveImportedEqualizerConfig(inputConfig);
          if (!equalizerConfig) {
            console.warn(
              `Failed to resolve equalizer config for ${inputConfig.title}`,
            );
            continue;
          }

          const result = await addEqualizerInput(roomId, equalizerConfig);
          createdInputIds.push({
            inputId: result.inputId,
            config: inputConfig,
            position,
          });
          positionToInputId.set(position, result.inputId);
        } catch (e) {
          console.warn(`Failed to add input ${inputConfig.title}:`, e);
        }
      }

      await handleRefreshState();

      for (const { inputId, config: inputConfig } of createdInputIds) {
        const attachedInputIds = inputConfig.attachedInputIndices
          ?.map((idx) => positionToInputId.get(idx))
          .filter((id): id is string => !!id);
        const equalizerConfig = resolveImportedEqualizerConfig(inputConfig);

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
            cropTop: inputConfig.cropTop,
            cropLeft: inputConfig.cropLeft,
            cropRight: inputConfig.cropRight,
            cropBottom: inputConfig.cropBottom,
            equalizerConfig,
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

      if (config.outputPlayer) {
        saveOutputPlayerSettings(roomId, config.outputPlayer);
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

  const navLinkClass =
    'uppercase tracking-widest text-xl font-bold text-[#849495] hover:text-[#00f3ff] border-b-2 border-b-transparent hover:border-b-[#00f3ff] pb-[6px] transition-colors px-2 py-1 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

  const recordLabel = isWaitingForDownload
    ? 'Wait...'
    : isRecording
      ? 'Stop Rec'
      : 'Record';

  return (
    <>
      <div className='flex items-center justify-between'>
        <nav className='flex items-center gap-6'>
          <button
            onClick={() => setShowAddVideoModal(true)}
            className={navLinkClass}>
            Add Video
          </button>
          {dashboardToolbar && (
            <div className='relative group'>
              <button className={navLinkClass}>Layout</button>
              <div className='absolute left-0 top-full hidden group-hover:flex flex-col bg-[#1c1b1b] border border-[#3a494b]/30 z-50 min-w-[220px] py-1'>
                <button
                  onClick={() => dashboardToolbar.toggleEditMode()}
                  className={`text-left px-3 py-1.5 uppercase tracking-widest text-sm transition-colors ${
                    dashboardToolbar.isEditMode
                      ? 'text-[#00f3ff]'
                      : 'text-[#849495] hover:text-[#00f3ff]'
                  }`}>
                  {dashboardToolbar.isEditMode ? 'Lock Layout' : 'Edit Layout'}
                </button>
                <div className='h-px bg-[#3a494b]/30 my-1' />
                {dashboardToolbar.presets.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => dashboardToolbar.applyPreset(preset.layout)}
                    className='text-left px-3 py-1.5 uppercase tracking-widest text-sm text-[#849495] hover:text-[#00f3ff] transition-colors'>
                    {preset.label}
                  </button>
                ))}
                <div className='h-px bg-[#3a494b]/30 my-1' />
                <button
                  onClick={() => setShowDashSaveModal(true)}
                  className='text-left px-3 py-1.5 uppercase tracking-widest text-sm text-[#849495] hover:text-[#00f3ff] transition-colors'>
                  Save Layout
                </button>
                <button
                  onClick={() => setShowDashLoadModal(true)}
                  className='text-left px-3 py-1.5 uppercase tracking-widest text-sm text-[#849495] hover:text-[#00f3ff] transition-colors'>
                  Load Layout
                </button>
                <div className='h-px bg-[#3a494b]/30 my-1' />
                {dashboardToolbar.allPanelIds.map((panelId) => {
                  const def = dashboardToolbar.getPanelDefinition(panelId);
                  const isVisible = dashboardToolbar.visiblePanels.has(panelId);
                  return (
                    <button
                      key={panelId}
                      onClick={() => dashboardToolbar.togglePanel(panelId)}
                      className={`text-left px-3 py-1.5 uppercase tracking-widest text-sm transition-colors flex items-center gap-2 ${
                        isVisible
                          ? 'text-[#e3fdff]'
                          : 'text-[#849495] hover:text-[#00f3ff]'
                      }`}>
                      <span
                        className={`w-2 h-2 rounded-full ${
                          isVisible ? 'bg-[#00f3ff]' : 'bg-[#3a494b]'
                        }`}
                      />
                      {def.title}
                    </button>
                  );
                })}
                <div className='h-px bg-[#3a494b]/30 my-1' />
                <button
                  onClick={() => dashboardToolbar.reset()}
                  className='text-left px-3 py-1.5 uppercase tracking-widest text-sm text-[#849495] hover:text-[#00f3ff] transition-colors'>
                  Reset Layout
                </button>
              </div>
            </div>
          )}
          <button
            onClick={() => setOpenModal('quickActions')}
            className={navLinkClass}>
            Actions
          </button>
          <button
            onClick={() => setOpenModal('settings')}
            className={navLinkClass}>
            Settings
          </button>
          <button
            onClick={() => setShowSaveModal(true)}
            disabled={isExporting}
            className={navLinkClass}>
            {isExporting ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={() => setShowLoadModal(true)}
            disabled={isImporting}
            className={navLinkClass}>
            {isImporting ? 'Loading...' : 'Load'}
          </button>
          <button
            onClick={handleToggleRecording}
            disabled={isTogglingRecording || isWaitingForDownload}
            className={`${navLinkClass} ${
              isRecording
                ? 'text-red-400 border-b-2 border-red-400 hover:text-red-300'
                : ''
            }`}>
            {recordLabel}
          </button>
        </nav>
        <div className='ml-auto flex items-center gap-4 uppercase tracking-widest text-xl font-bold'>
          <label className='flex items-center gap-2 cursor-pointer'>
            <span className='text-[#849495]'>Public</span>
            <Switch
              checked={roomState.isPublic}
              onCheckedChange={() => handleTogglePublic()}
              disabled={isTogglingPublic}
            />
          </label>
          <label className='flex items-center gap-2 cursor-pointer'>
            <span className='text-[#849495]'>Audio</span>
            <Switch
              checked={audioAnalysisEnabled}
              onCheckedChange={() => handleToggleAudioAnalysis()}
              disabled={isTogglingAudio}
            />
          </label>
        </div>
      </div>
      <ShadcnInput
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
              <h4 className='text-sm font-medium text-foreground'>
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
                <h4 className='text-sm font-medium text-foreground'>
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
                  <span className='text-xs text-muted-foreground'>
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
                  <span className='text-xs text-muted-foreground'>
                    Compact Voice Panel
                  </span>
                </label>
                <div className='flex items-center justify-between gap-3'>
                  <span className='text-xs text-muted-foreground shrink-0'>
                    Panel Opacity
                  </span>
                  <Slider
                    min={0}
                    max={100}
                    step={5}
                    value={[voicePanelOpacity]}
                    onValueChange={(v) => setVoicePanelOpacity(v[0])}
                    className='flex-1 accent-white h-1'
                  />
                  <span className='text-xs text-muted-foreground w-8 text-right tabular-nums'>
                    {voicePanelOpacity}%
                  </span>
                </div>
              </section>
              <div className='h-px bg-card' />
              <section className='space-y-2 px-1'>
                <h4 className='text-sm font-medium text-foreground'>
                  Input Defaults
                </h4>
                <div className='flex items-center justify-between'>
                  <span className='text-xs text-muted-foreground'>
                    Default Orientation
                  </span>
                  <Select
                    value={defaultOrientation}
                    onValueChange={(v: 'horizontal' | 'vertical') =>
                      setDefaultOrientation(v)
                    }>
                    <SelectTrigger className='bg-card border border-border text-foreground text-xs px-2 py-1 rounded h-auto'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='horizontal'>Horizontal</SelectItem>
                      <SelectItem value='vertical'>Vertical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </section>
              <div className='h-px bg-card' />
              <section className='space-y-2 px-1'>
                <h4 className='text-sm font-medium text-foreground'>
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

      <AddVideoModal
        open={showAddVideoModal}
        onOpenChange={setShowAddVideoModal}
      />

      {dashboardToolbar && (
        <>
          <GenericSaveModal
            open={showDashSaveModal}
            onOpenChange={setShowDashSaveModal}
            title='Save Dashboard Layout'
            description='Choose where to save your dashboard layout.'
            namePlaceholder='Layout name...'
            onSaveLocal={handleDashSaveLocal}
            onSaveRemote={handleDashSaveRemote}
          />
          <ShadcnInput
            ref={dashFileInputRef}
            type='file'
            accept='.json,application/json'
            className='hidden'
            onChange={handleDashFileChange}
          />
          <GenericLoadModal<object>
            open={showDashLoadModal}
            onOpenChange={setShowDashLoadModal}
            title='Load Dashboard Layout'
            description='Choose where to load your dashboard layout from.'
            storage={dashboardToolbar.dashboardLayoutStorage}
            onLoadLocal={() => dashFileInputRef.current?.click()}
            onLoadRemote={handleDashLoadRemote}
            emptyMessage='No saved dashboard layouts found.'
          />
        </>
      )}
    </>
  );
}
