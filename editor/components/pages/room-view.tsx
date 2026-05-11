import type { RoomState } from '@/lib/types';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import AutoplayModal from '@/components/ui/autoplay-modal';
import VideoPreview from '@/components/video-preview';
import ControlPanel from '@/components/control-panel/control-panel';
import DashboardLayout from '@/components/dashboard/dashboard-layout';
import { ConnectedDevicesPanel } from '@/components/dashboard/connected-devices-panel';
import { SystemLogPanel } from '@/components/dashboard/system-log-panel';
import { LayoutPreviewPanel } from '@/components/dashboard/layout-preview-panel';
import GuestPanel from '@/components/pages/guest-panel';
import {
  STATIC_PANEL_IDS,
  STATIC_PANEL_DEFINITIONS,
  type PanelDefinition,
} from '@/components/dashboard/panel-registry';

interface RoomViewProps {
  roomId: string;
  roomState: RoomState;
  refreshState: () => Promise<void>;
  isGuest?: boolean;
  settingsNavPortalRef?: React.RefObject<HTMLDivElement | null>;
}

export default function RoomView({
  roomId,
  roomState,
  refreshState,
  isGuest,
  settingsNavPortalRef,
}: RoomViewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [showAutoplayPopup, setShowAutoplayPopup] = useState(true);
  const [played, setPlayed] = useState(false);

  const handleAutoplayPermission = useCallback((allow: boolean) => {
    if (allow) {
      videoRef.current?.play();
    }
    setShowAutoplayPopup(false);
  }, []);

  const setupVideoEventListeners = useCallback(() => {
    if (!videoRef.current) {
      return;
    }

    videoRef.current.onplay = () => {
      setPlayed(true);
    };
  }, []);

  useEffect(() => {
    if (isGuest) return;
    setupVideoEventListeners();
  }, [setupVideoEventListeners, isGuest]);

  useEffect(() => {
    if (isGuest) return;
    const attemptAutoplay = async () => {
      if (!videoRef.current) return;
      try {
        await videoRef.current.play();
      } catch (error) {
        setShowAutoplayPopup(true);
      }
    };
    attemptAutoplay();
  }, [isGuest]);

  if (isGuest) {
    return <GuestPanel roomId={roomId} />;
  }

  return (
    <>
      {showAutoplayPopup && !played && (
        <AutoplayModal
          onAllow={() => handleAutoplayPermission(true)}
          onDeny={() => handleAutoplayPermission(false)}
        />
      )}

      <ControlPanel
        roomState={roomState}
        roomId={roomId}
        refreshState={refreshState}
        settingsNavPortalRef={settingsNavPortalRef}
        renderDashboard={({
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
          onSelectInput,
          videoOverlayRects,
        }) => {
          const staticPanels: Record<string, ReactNode> = {
            'video-preview': (
              <VideoPreview
                videoRef={videoRef}
                whepUrl={roomState.whepUrl}
                resolution={roomState.resolution}
                roomId={roomId}
                overlayRects={videoOverlayRects}
              />
            ),
            streams: streamsSection,
            fx: fxSection,
            timeline: timelineSection,
            'block-properties': blockPropertiesSection,
            'pending-connections': pendingConnectionsSection,
            'connected-devices': <ConnectedDevicesPanel peers={peers} />,
            'system-log': <SystemLogPanel />,
            'motion-detection': motionDetectionSection,
            'layout-preview': (
              <LayoutPreviewPanel
                roomId={roomId}
                inputs={roomState.inputs}
                resolution={
                  roomState.resolution ?? { width: 1920, height: 1080 }
                }
                timelineColorOverrides={timelineColorOverrides}
                activeClipColors={activeClipColors}
                selectedInputId={selectedInputId}
                onSelectInput={onSelectInput}
              />
            ),
          };

          const getPanelDefinition = (id: string): PanelDefinition => {
            return (
              STATIC_PANEL_DEFINITIONS[
                id as keyof typeof STATIC_PANEL_DEFINITIONS
              ] ?? {
                id,
                title: id,
                minW: 4,
                minH: 3,
              }
            );
          };

          return (
            <DashboardLayout
              panels={staticPanels}
              allPanelIds={STATIC_PANEL_IDS}
              getPanelDefinition={getPanelDefinition}
              videoAspectRatio={
                roomState.resolution
                  ? roomState.resolution.width / roomState.resolution.height
                  : 16 / 9
              }
            />
          );
        }}
      />
    </>
  );
}
