'use client';

import { fadeIn } from '@/utils/animations';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import type {
  RoomState,
  Input,
  Layer,
  AvailableShader,
  PendingWhipInputData,
} from '@/lib/types';
import { useActions } from './contexts/actions-context';
import { ActionsProvider } from './contexts/actions-context';
import { defaultActions, SESSION_SOURCE_ID } from './contexts/default-actions';
import {
  RECORDING_DOWNLOAD_STARTED_EVENT,
  useRecordingControls,
} from './hooks/use-recording-controls';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
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
import { LayersSection } from './components/LayersSection';
import {
  TimelinePanel,
  type TimelinePanelActions,
} from './components/TimelinePanel';
import { AddVideoModal } from './components/AddVideoModal';
import { QuickActionsSection } from './components/QuickActionsSection';
import { type PendingWhipInput } from './components/ConfigurationSection';
import {
  exportRoomConfig,
  downloadRoomConfig,
  parseRoomConfig,
  buildTimelineStateFromConfigTimeline,
  resolveRoomConfigTimelineState,
  restoreTimelineToStorage,
  loadOutputPlayerSettings,
  saveOutputPlayerSettings,
  type RoomConfig,
} from '@/lib/room-config';
import { streamImportConfig } from '@/lib/import-config-stream';
import { SaveConfigModal, LoadConfigModal } from './components/ConfigModals';
import {
  GenericSaveModal,
  GenericLoadModal,
} from '@/components/storage-modals';
import { setAudioAnalysisEnabled } from '@/app/actions/actions';
import { TransitionSettings } from './components/TransitionSettings';
import { BehaviorSelector } from './components/BehaviorSelector';
import { ViewportSettings } from './components/ViewportSettings';
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
  useTimelineEventsEnabledSetting,
  useTimelineEventsPositionSetting,
  useTimelineEventsSizeSetting,
  useTimelineEventsDurationSetting,
} from '@/lib/timeline-event-settings';
import { useTimelineEventDetection } from '@/hooks/use-timeline-event-detection';
import {
  BlockClipPropertiesPanel,
  type SelectedTimelineClip,
} from './components/BlockClipPropertiesPanel';
import {
  PendingConnectionsPanel,
  loadAutoModalSetting,
} from './components/PendingConnectionsPanel';
import { PendingConnectionsModal } from './components/PendingConnectionsModal';
import type { TimelineState } from './hooks/use-timeline-state';
import {
  buildInputColorMap,
  TYPE_HSL,
} from './components/timeline/timeline-utils';
import {
  emitTimelineEvent,
  listenTimelineEvent,
  TIMELINE_EVENTS,
} from './components/timeline/timeline-events';
import { useMotionScores } from '@/hooks/use-motion-scores';
import { useMotionHistory } from '@/hooks/use-motion-history';
import { MotionDetectionPanel } from './components/MotionDetectionPanel';
import { ErrorBoundary } from '@/components/error-boundary';
import {
  ImportProgressDialog,
  type ImportProgressState,
} from './components/import-progress-dialog';
import {
  DashboardToolbarProvider,
  useDashboardToolbar,
} from '@/components/dashboard/dashboard-toolbar-context';
import { Input as ShadcnInput } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PresentationModeSettings } from './components/PresentationModeSettings';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import QRCode from 'react-qr-code';

type ControlPanelProps = {
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
    pendingConnectionsSection: React.ReactNode;
    motionDetectionSection: React.ReactNode;
    peers: ConnectedPeer[];
    timelineColorOverrides: Record<string, string>;
    activeClipColors: Record<string, string>;
    selectedInputId: string | null;
    onSelectInput: (id: string) => void;
  }) => React.ReactNode;
};

const VIDEO_INPUT_TYPES = new Set<string>([
  'local-mp4',
  'twitch-channel',
  'kick-channel',
  'hls',
  'whip',
]);

;

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

  const updateRoomForLayers = useActions().updateRoom;
  const handleLayersChange = useCallback(
    async (newLayers: Layer[]) => {
      try {
        await updateRoomForLayers(roomId, { layers: newLayers });
      } catch (e) {
        console.error('handleLayersChange failed:', e);
      }
    },
    [roomId, updateRoomForLayers],
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
          handleLayersChange={handleLayersChange}
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
  handleLayersChange: (layers: Layer[]) => Promise<void>;
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
  handleLayersChange,
}: ControlPanelInnerProps) {
  const {
    roomId,
    refreshState: handleRefreshState,
    inputs,
    availableShaders,
    isRecording,
    motionScores,
  } = useControlPanelContext();
  const motionHistoryMap = useMotionHistory(inputs, motionScores);
  const { activeCameraInputId, activeScreenshareInputId } =
    useWhipConnectionsContext();
  const actions = useActions();
  const updateRoomAction = actions.updateRoom;
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

  useTimelineEventDetection(timelineStateRef, inputs);
  const timelineLoadStateRef = useRef<((state: TimelineState) => void) | null>(
    null,
  );
  const pendingTimelineStateRef = useRef<TimelineState | null>(null);
  const timelineActionsRef = useRef<TimelinePanelActions | null>(null);

  const [timelineColorOverrides, setTimelineColorOverrides] = useState<
    Record<string, string>
  >({});
  const timelineColorKeyRef = useRef('');

  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;
  const [activeClipColors, setActiveClipColors] = useState<
    Record<string, string>
  >({});
  const activeClipColorsKeyRef = useRef('');

  const [pendingWhipColors, setPendingWhipColors] = useState<
    Record<string, string>
  >({});
  const pendingWhipColorsKeyRef = useRef('');

  const [pendingModalOpen, setPendingModalOpen] = useState(false);
  const pendingModalShownRef = useRef(false);
  const [timelineActionsReady, setTimelineActionsReady] = useState(false);

  const [showcaseWelcome, setShowcaseWelcome] = useState<{
    before: string;
    after: string;
  } | null>(null);

  useEffect(() => {
    try {
      const key = `showcase-welcome-${roomId}`;
      const raw = sessionStorage.getItem(key);
      if (raw) {
        sessionStorage.removeItem(key);
        const parsed = JSON.parse(raw);
        if (parsed.before || parsed.after) {
          setShowcaseWelcome(parsed);
        }
      }
    } catch {}
  }, [roomId]);

  useEffect(() => {
    if (
      !isGuest &&
      !pendingModalShownRef.current &&
      pendingWhipInputs.length > 0 &&
      (loadAutoModalSetting() || showcaseWelcome)
    ) {
      pendingModalShownRef.current = true;
      setPendingModalOpen(true);
    }
  }, [isGuest, pendingWhipInputs.length, showcaseWelcome]);

  const handlePendingModalOpenChange = useCallback(
    (open: boolean) => {
      setPendingModalOpen(open);
      if (pendingModalOpen && !open) {
        const applyAtPlayhead = timelineActionsRef.current?.applyAtPlayhead;
        if (applyAtPlayhead) {
          void applyAtPlayhead();
        } else {
          emitTimelineEvent(TIMELINE_EVENTS.APPLY_AT_PLAYHEAD, {});
        }
      }
    },
    [pendingModalOpen],
  );

  const handleTimelineActionsReady = useCallback(
    (actions: TimelinePanelActions | null) => {
      timelineActionsRef.current = actions;
      setTimelineActionsReady(actions !== null);
    },
    [],
  );

  const handlePendingModalActionClose = useCallback(() => {
    setPendingModalOpen(false);
  }, []);

  const handlePendingModalApply = useCallback(async () => {
    const applyAtPlayhead = timelineActionsRef.current?.applyAtPlayhead;
    if (applyAtPlayhead) {
      await applyAtPlayhead();
      return;
    }
    emitTimelineEvent(TIMELINE_EVENTS.APPLY_AT_PLAYHEAD, {});
  }, []);

  const handlePendingModalConnectAndPlay = useCallback(async () => {
    const timelineActions = timelineActionsRef.current;
    if (!timelineActions) {
      return;
    }
    await timelineActions.applyAtPlayhead();
    await timelineActions.play();
  }, []);

  const handlePendingModalConnectAndRecord = useCallback(async () => {
    const timelineActions = timelineActionsRef.current;
    if (!timelineActions || isRecording) {
      return;
    }
    await timelineActions.applyAtPlayhead();
    await timelineActions.recordAndPlay();
  }, [isRecording]);

  const handleTimelineStateChange = useCallback(
    (state: TimelineState) => {
      timelineStateRef.current = state;
      if (selectedTimelineClips.length > 0) {
        setTimelinePlayheadMs((prev) =>
          prev === state.playheadMs ? prev : state.playheadMs,
        );
      }

      const next: Record<string, string> = {};
      for (const track of state.tracks) {
        for (const clip of track.clips) {
          if (clip.blockSettings.timelineColor && !next[clip.inputId]) {
            next[clip.inputId] = clip.blockSettings.timelineColor;
          }
        }
      }
      const key = JSON.stringify(next);
      if (key !== timelineColorKeyRef.current) {
        timelineColorKeyRef.current = key;
        setTimelineColorOverrides(next);
      }

      const colorMap = buildInputColorMap(inputsRef.current);
      const activeColors: Record<string, string> = {};
      for (const track of state.tracks) {
        for (const clip of track.clips) {
          if (
            state.playheadMs >= clip.startMs &&
            state.playheadMs < clip.endMs &&
            !activeColors[clip.inputId]
          ) {
            const tc = clip.blockSettings.timelineColor;
            activeColors[clip.inputId] =
              tc || colorMap.get(clip.inputId)?.dot || '';
          }
        }
      }
      const activeKey = JSON.stringify(activeColors);
      if (activeKey !== activeClipColorsKeyRef.current) {
        activeClipColorsKeyRef.current = activeKey;
        setActiveClipColors(activeColors);
      }

      const whipBase = TYPE_HSL['whip'];
      const pendingColors: Record<string, string> = {};
      for (const track of state.tracks) {
        for (const clip of track.clips) {
          if (
            clip.inputId.startsWith('__pending-whip-') &&
            !pendingColors[clip.inputId]
          ) {
            const tc = clip.blockSettings.timelineColor;
            pendingColors[clip.inputId] =
              tc || `hsl(${whipBase[0]} ${whipBase[1]}% ${whipBase[2]}%)`;
          }
        }
      }
      const pendingKey = JSON.stringify(pendingColors);
      if (pendingKey !== pendingWhipColorsKeyRef.current) {
        pendingWhipColorsKeyRef.current = pendingKey;
        setPendingWhipColors(pendingColors);
      }
    },
    [selectedTimelineClips.length],
  );

  const handleTimelineLoadStateReady = useCallback(
    (loadState: (state: TimelineState) => void) => {
      timelineLoadStateRef.current = loadState;
      const pending = pendingTimelineStateRef.current;
      if (pending) {
        pendingTimelineStateRef.current = null;
        loadState(pending);
      }
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
        if (timelineLoadStateRef.current) {
          timelineLoadStateRef.current(state);
        } else {
          pendingTimelineStateRef.current = state;
        }
      }
      timelineStateRef.current = state;
      setTimelinePlayheadMs(state?.playheadMs ?? 0);
    },
    [],
  );

  useEffect(() => {
    return listenTimelineEvent(TIMELINE_EVENTS.SELECTED_CLIP, ({ clips }) => {
      setSelectedTimelineClips(clips ?? []);
    });
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
          getTimelineStateForConfig={getTimelineStateForConfig}
          applyImportedTimelineState={applyImportedTimelineState}
        />
      </ErrorBoundary>
    );

    const streamsSection = (
      <div className='h-full overflow-y-auto p-3'>
        <LayersSection
          layers={roomState.layers}
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
          onLayersChange={handleLayersChange}
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
          onTimelineActionsReady={handleTimelineActionsReady}
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
        />
      </div>
    );

    const pendingConnectionsSection = !isGuest ? (
      <PendingConnectionsPanel
        pendingWhipInputs={pendingWhipInputs}
        setPendingWhipInputs={handleSetPendingWhipInputs}
        colorMap={pendingWhipColors}
      />
    ) : (
      <div className='h-full flex items-center justify-center p-3'>
        <p className='text-xs text-neutral-500'>Not available for guests</p>
      </div>
    );

    const motionDetectionInputs = inputs.filter((input) =>
      VIDEO_INPUT_TYPES.has(input.type),
    );
    const motionDetectionSection = (
      <MotionDetectionPanel
        roomId={roomId}
        inputs={motionDetectionInputs}
        motionHistoryMap={motionHistoryMap}
        motionScores={motionScores}
        refreshState={handleRefreshState}
      />
    );

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
          pendingConnectionsSection,
          motionDetectionSection,
          peers,
          timelineColorOverrides,
          activeClipColors,
          selectedInputId,
          onSelectInput: setSelectedInputId,
        })}
        {!isGuest && (
          <PendingConnectionsModal
            pendingWhipInputs={pendingWhipInputs}
            setPendingWhipInputs={handleSetPendingWhipInputs}
            colorMap={pendingWhipColors}
            open={pendingModalOpen}
            onOpenChange={handlePendingModalOpenChange}
            onActionClose={handlePendingModalActionClose}
            onApplyAtPlayhead={handlePendingModalApply}
            onConnectAndPlay={handlePendingModalConnectAndPlay}
            onConnectAndRecord={handlePendingModalConnectAndRecord}
            canConnectAndPlay={timelineActionsReady}
            canConnectAndRecord={timelineActionsReady && !isRecording}
            welcomeTextBefore={showcaseWelcome?.before}
            welcomeTextAfter={showcaseWelcome?.after}
          />
        )}
      </DashboardToolbarProvider>
    );
  }

  const streamsSectionContent = !fxInput ? (
    <LayersSection
      layers={roomState.layers}
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
      onLayersChange={handleLayersChange}
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
        onTimelineActionsReady={handleTimelineActionsReady}
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

  const pendingModal = !isGuest && (
    <PendingConnectionsModal
      pendingWhipInputs={pendingWhipInputs}
      setPendingWhipInputs={handleSetPendingWhipInputs}
      colorMap={pendingWhipColors}
      open={pendingModalOpen}
      onOpenChange={handlePendingModalOpenChange}
      onActionClose={handlePendingModalActionClose}
      onApplyAtPlayhead={handlePendingModalApply}
      onConnectAndPlay={handlePendingModalConnectAndPlay}
      onConnectAndRecord={handlePendingModalConnectAndRecord}
      canConnectAndPlay={timelineActionsReady}
      canConnectAndRecord={timelineActionsReady && !isRecording}
      welcomeTextBefore={showcaseWelcome?.before}
      welcomeTextAfter={showcaseWelcome?.after}
    />
  );

  if (renderStreamsOutside) {
    return (
      <>
        {mainPanel}
        {timelineSection &&
          timelinePortalRef?.current &&
          createPortal(timelineSection, timelinePortalRef.current)}
        {pendingModal}
      </>
    );
  }

  return (
    <>
      {mainPanel}
      {pendingModal}
    </>
  );
}

type ModalId = 'quickActions' | 'settings';

function SettingsBar({
  roomState,
  getTimelineStateForConfig,
  applyImportedTimelineState,
}: {
  roomState: RoomState;
  getTimelineStateForConfig: () => TimelineState | null;
  applyImportedTimelineState: (state: TimelineState | null) => void;
}) {
  const { roomId, refreshState: handleRefreshState } = useControlPanelContext();
  const actions = useActions();
  const updateRoomAction = actions.updateRoom;
  const configStorageSave = actions.configStorage.save;
  const [openModal, setOpenModal] = useState<ModalId | null>(null);
  const [showAddVideoModal, setShowAddVideoModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] =
    useState<ImportProgressState | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);
  const [autoPlayMacro, setAutoPlayMacro] = useAutoPlayMacroSetting();
  const [feedbackPosition, setFeedbackPosition] = useFeedbackPositionSetting();
  const [feedbackEnabled, setFeedbackEnabled] = useFeedbackEnabledSetting();
  const [feedbackSize, setFeedbackSize] = useFeedbackSizeSetting();
  const [feedbackDuration, setFeedbackDuration] = useFeedbackDurationSetting();
  const [tlEventsEnabled, setTlEventsEnabled] =
    useTimelineEventsEnabledSetting();
  const [tlEventsPosition, setTlEventsPosition] =
    useTimelineEventsPositionSetting();
  const [tlEventsSize, setTlEventsSize] = useTimelineEventsSizeSetting();
  const [tlEventsDuration, setTlEventsDuration] =
    useTimelineEventsDurationSetting();
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

  const startImportProgress = useCallback((total: number, phase: string) => {
    setImportProgress({
      phase,
      current: 0,
      total: Math.max(total, 1),
    });
  }, []);

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
  const [recordingDownloadFileName, setRecordingDownloadFileName] = useState<
    string | null
  >(null);
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
      'grid',
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
      {
        viewportTop: roomState.viewportTop,
        viewportLeft: roomState.viewportLeft,
        viewportWidth: roomState.viewportWidth,
        viewportHeight: roomState.viewportHeight,
        viewportTransitionDurationMs: roomState.viewportTransitionDurationMs,
        viewportTransitionEasing: roomState.viewportTransitionEasing,
      },
      roomState.outputShaders,
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

  useEffect(() => {
    const onRecordingDownloadStarted = (
      event: CustomEvent<{ fileName?: string }>,
    ) => {
      setRecordingDownloadFileName(event.detail?.fileName ?? null);
    };

    window.addEventListener(
      RECORDING_DOWNLOAD_STARTED_EVENT,
      onRecordingDownloadStarted as EventListener,
    );
    return () => {
      window.removeEventListener(
        RECORDING_DOWNLOAD_STARTED_EVENT,
        onRecordingDownloadStarted as EventListener,
      );
    };
  }, []);

  const importConfig = useCallback(
    async (config: RoomConfig) => {
      setIsImporting(true);
      startImportProgress(1, 'Starting import');

      try {
        const oldInputIds = roomState.inputs.map((i) => i.inputId);

        const result = await streamImportConfig(
          roomId,
          { config, oldInputIds },
          {
            onProgress: (event) => {
              setImportProgress({
                phase: event.phase,
                current: event.current,
                total: event.total,
              });
            },
          },
        );

        if (result.errors.length > 0) {
          console.warn('[import-config] Errors:', result.errors);
        }

        const indexToInputId = new Map<number, string>();
        for (const [idx, inputId] of Object.entries(result.indexToInputId)) {
          indexToInputId.set(Number(idx), inputId);
        }
        for (const pw of result.pendingWhipData) {
          indexToInputId.set(
            pw.position,
            `__pending-whip-${pw.position}__`,
          );
        }

        if (config.timeline) {
          restoreTimelineToStorage(roomId, config.timeline, indexToInputId);
          const restoredTimelineState = buildTimelineStateFromConfigTimeline(
            config.timeline,
            indexToInputId,
          );
          const knownInputIds = new Set<string>();
          for (const inputId of Object.values(result.indexToInputId)) {
            knownInputIds.add(inputId);
          }
          for (const pw of result.pendingWhipData) {
            knownInputIds.add(`__pending-whip-${pw.position}__`);
          }

          const importedTimelineState =
            restoredTimelineState.tracks.length > 0
              ? {
                  ...restoredTimelineState,
                  playheadMs: 0,
                  isPlaying: false,
                  knownInputIds,
                }
              : null;

          applyImportedTimelineState(importedTimelineState);
        }

        if (config.outputPlayer) {
          saveOutputPlayerSettings(roomId, config.outputPlayer);
        }

        await handleRefreshState();
      } finally {
        setImportProgress(null);
        setIsImporting(false);
      }
    },
    [
      roomId,
      roomState.inputs,
      handleRefreshState,
      applyImportedTimelineState,
      startImportProgress,
    ],
  );

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const config = parseRoomConfig(text);
        await importConfig(config);
      } catch (e: any) {
        console.error('Import failed:', e);
      } finally {
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    },
    [importConfig],
  );

  const navLinkClass =
    'relative inline-flex h-12 mt-2 items-center justify-center px-2 uppercase tracking-widest text-xl font-bold leading-none text-[#849495] transition-colors hover:text-[#00f3ff] after:pointer-events-none after:absolute after:left-2 after:right-2 after:bottom-3 after:h-[2px] after:rounded-full after:bg-transparent after:content-[""] hover:after:bg-[#00f3ff] disabled:opacity-50 disabled:cursor-not-allowed';

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
          <button onClick={() => setShowQRModal(true)} className={navLinkClass}>
            Join via QR
          </button>
          <button
            onClick={handleToggleRecording}
            disabled={isTogglingRecording || isWaitingForDownload}
            className={`${navLinkClass} ${
              isRecording
                ? 'text-red-400 after:bg-red-400 hover:text-red-300 hover:after:bg-red-300'
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
          <Tabs defaultValue='general'>
            <TabsList className='w-full'>
              <TabsTrigger value='general' className='flex-1'>
                General
              </TabsTrigger>
              <TabsTrigger value='presentation' className='flex-1'>
                Presentation Mode
              </TabsTrigger>
            </TabsList>
            <TabsContent value='general'>
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
                    swapFadeOutDurationMs={
                      roomState.swapFadeOutDurationMs ?? 500
                    }
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
                      await updateRoomAction(roomId, {
                        newsStripEnabled: value,
                      });
                      await handleRefreshState();
                    }}
                  />
                  <div className='h-px bg-card mt-3' />
                  <h4 className='text-sm font-medium text-foreground mt-3'>
                    Viewport
                  </h4>
                  {roomState.resolution && (
                    <ViewportSettings
                      resolution={roomState.resolution}
                      viewportTop={roomState.viewportTop}
                      viewportLeft={roomState.viewportLeft}
                      viewportWidth={roomState.viewportWidth}
                      viewportHeight={roomState.viewportHeight}
                      viewportTransitionDurationMs={
                        roomState.viewportTransitionDurationMs
                      }
                      viewportTransitionEasing={
                        roomState.viewportTransitionEasing
                      }
                      onChange={async (fields) => {
                        await updateRoomAction(roomId, fields);
                        await handleRefreshState();
                      }}
                    />
                  )}
                  <div className='h-px bg-card mt-3' />
                  <h4 className='text-sm font-medium text-foreground mt-3'>
                    Layout Behavior
                  </h4>
                  <p className='text-[11px] text-neutral-500'>
                    Default layer behavior for new inputs
                  </p>
                  <BehaviorSelector
                    behavior={roomState.layers?.[0]?.behavior}
                    onChange={async (b) => {
                      const currentLayers = roomState.layers ?? [];
                      const updatedLayers =
                        currentLayers.length > 0
                          ? currentLayers.map((l, i) =>
                              i === 0 ? { ...l, behavior: b } : l,
                            )
                          : [{ id: 'default', inputs: [], behavior: b }];
                      await updateRoomAction(roomId, { layers: updatedLayers });
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
                      <Checkbox
                        checked={autoPlayMacro}
                        onCheckedChange={(checked: boolean) => {
                          setAutoPlayMacro(checked);
                        }}
                      />
                      <span className='text-xs text-muted-foreground'>
                        Auto Play Macro
                      </span>
                    </label>
                    <label className='flex items-center gap-2 cursor-pointer'>
                      <Checkbox
                        checked={voicePanelSize === 's'}
                        onCheckedChange={(checked: boolean) =>
                          setVoicePanelSize(checked ? 's' : 'l')
                        }
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
                  <div className='h-px bg-card' />
                  <section className='space-y-2 px-1'>
                    <h4 className='text-sm font-medium text-foreground'>
                      Timeline Event Notifications
                    </h4>
                    <FeedbackPositionPicker
                      label='Show Timeline Events'
                      enabled={tlEventsEnabled}
                      onEnabledChange={setTlEventsEnabled}
                      position={tlEventsPosition}
                      onPositionChange={setTlEventsPosition}
                      size={tlEventsSize}
                      onSizeChange={setTlEventsSize}
                      duration={tlEventsDuration}
                      onDurationChange={setTlEventsDuration}
                    />
                  </section>
                </div>
              </div>
            </TabsContent>
            <TabsContent value='presentation'>
              <PresentationModeSettings
                roomState={roomState}
                getTimelineStateForConfig={getTimelineStateForConfig}
              />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
      <Dialog
        open={recordingDownloadFileName !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRecordingDownloadFileName(null);
          }
        }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Recording download started</DialogTitle>
          </DialogHeader>
          <p className='text-sm text-muted-foreground'>
            Your recording file started downloading
            {recordingDownloadFileName ? `: ${recordingDownloadFileName}` : '.'}
          </p>
          <div className='mt-4 flex justify-end'>
            <button
              type='button'
              onClick={() => setRecordingDownloadFileName(null)}
              className='rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:opacity-90 transition-opacity'>
              OK
            </button>
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
      />

      <QRModal
        roomId={roomId}
        open={showQRModal}
        onOpenChange={setShowQRModal}
      />

      <ImportProgressDialog progress={importProgress} />

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

function QRModal({
  roomId,
  open,
  onOpenChange,
}: {
  roomId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);

  const joinUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const url = new URL(
      `/room/${encodeURIComponent(roomId)}`,
      window.location.origin,
    );
    return url.toString();
  }, [roomId]);

  const handleCopy = useCallback(async () => {
    if (!joinUrl) return;
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (err) {
      console.error('Failed to copy join URL:', err);
    }
  }, [joinUrl]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) setCopied(false);
      }}>
      <DialogContent className='max-w-md'>
        <DialogHeader>
          <DialogTitle>Join via QR</DialogTitle>
        </DialogHeader>
        <div className='space-y-4'>
          <div className='flex justify-center'>
            {joinUrl ? (
              <div className='rounded-md border border-border bg-card p-3'>
                <QRCode
                  value={joinUrl}
                  size={220}
                  bgColor='transparent'
                  fgColor='currentColor'
                />
              </div>
            ) : (
              <div className='text-sm text-muted-foreground'>
                Preparing link…
              </div>
            )}
          </div>
          <div className='space-y-2'>
            <ShadcnInput readOnly value={joinUrl} />
            <button
              type='button'
              className='w-full uppercase tracking-widest text-sm font-bold text-[#849495] hover:text-[#00f3ff] border border-border py-2 transition-colors disabled:opacity-50'
              onClick={() => void handleCopy()}
              disabled={!joinUrl}>
              {copied ? 'Copied' : 'Copy Link'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
