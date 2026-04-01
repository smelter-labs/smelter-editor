import type { RoomState } from '@/lib/types';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import AutoplayModal from '@/components/ui/autoplay-modal';
import { motion } from 'framer-motion';
import { staggerContainer } from '@/utils/animations';
import VideoPreview from '@/components/video-preview';
import ControlPanel from '@/components/control-panel/control-panel';
import DashboardLayout from '@/components/dashboard/dashboard-layout';
import { ConnectedDevicesPanel } from '@/components/dashboard/connected-devices-panel';
import { SystemLogPanel } from '@/components/dashboard/system-log-panel';
import { LayoutPreviewPanel } from '@/components/dashboard/layout-preview-panel';
import { Button } from '@/components/ui/button';
import { RotateCw } from 'lucide-react';
import {
  STATIC_PANEL_IDS,
  STATIC_PANEL_DEFINITIONS,
  isMotionPanelId,
  getInputIdFromMotionPanel,
  getMotionPanelDefinition,
  type PanelDefinition,
  type MotionPanelId,
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
  const [guestStream, setGuestStream] = useState<MediaStream | null>(null);

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

  const guestVideoRef = useRef<HTMLVideoElement | null>(null);
  const [guestRotation, setGuestRotation] = useState<0 | 90 | 180 | 270>(0);
  const guestRotateRef = useRef<(() => Promise<0 | 90 | 180 | 270>) | null>(
    null,
  );
  const [guestInputId, setGuestInputId] = useState<string | null>(null);

  useEffect(() => {
    if (!guestVideoRef.current) return;
    if (guestStream) {
      guestVideoRef.current.srcObject = guestStream;
      guestVideoRef.current.play().catch(() => {});
    } else {
      guestVideoRef.current.srcObject = null;
    }
  }, [guestStream]);

  if (isGuest) {
    return (
      <motion.div
        variants={staggerContainer}
        className='flex-1 flex flex-col min-h-0 h-full items-center justify-start overflow-hidden'>
        <div className='w-full max-w-xl'>
          {guestStream && (
            <div className='mb-4'>
              <div
                className='rounded-md overflow-hidden border border-neutral-800 bg-black'
                style={{
                  aspectRatio: guestRotation % 180 !== 0 ? '9/16' : '16/9',
                  maxHeight: guestRotation % 180 !== 0 ? '70vh' : undefined,
                  margin: '0 auto',
                  width: guestRotation % 180 !== 0 ? 'auto' : '100%',
                }}>
                <video
                  ref={guestVideoRef}
                  muted
                  playsInline
                  autoPlay
                  className='w-full h-full object-contain'
                />
              </div>
              <div className='flex justify-center mt-2'>
                <Button
                  size='sm'
                  variant='ghost'
                  onClick={async () => {
                    if (guestRotateRef.current) {
                      const angle = await guestRotateRef.current();
                      setGuestRotation(angle);
                    }
                  }}
                  className='cursor-pointer text-neutral-400 hover:text-white border border-neutral-700'>
                  <RotateCw className='w-4 h-4 mr-1' />
                  Rotate 90°
                </Button>
              </div>
            </div>
          )}
          <ControlPanel
            roomState={roomState}
            roomId={roomId}
            refreshState={refreshState}
            isGuest={isGuest}
            onGuestStreamChange={setGuestStream}
            onGuestInputIdChange={setGuestInputId}
            onGuestRotateRef={guestRotateRef}
          />
        </div>
      </motion.div>
    );
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
          motionPanels,
          peers,
          timelineColorOverrides,
          selectedInputId,
          onSelectInput,
        }) => {
          const staticPanels: Record<string, ReactNode> = {
            'video-preview': (
              <VideoPreview
                videoRef={videoRef}
                whepUrl={roomState.whepUrl}
                resolution={roomState.resolution}
                roomId={roomId}
              />
            ),
            streams: streamsSection,
            fx: fxSection,
            timeline: timelineSection,
            'block-properties': blockPropertiesSection,
            'pending-connections': pendingConnectionsSection,
            'connected-devices': <ConnectedDevicesPanel peers={peers} />,
            'system-log': <SystemLogPanel />,
            'layout-preview': (
              <LayoutPreviewPanel
                roomId={roomId}
                inputs={roomState.inputs}
                resolution={
                  roomState.resolution ?? { width: 1920, height: 1080 }
                }
                timelineColorOverrides={timelineColorOverrides}
                selectedInputId={selectedInputId}
                onSelectInput={onSelectInput}
              />
            ),
          };

          const allPanels = { ...staticPanels, ...motionPanels };
          const motionIds = Object.keys(motionPanels);
          const allPanelIds = [...STATIC_PANEL_IDS, ...motionIds];

          const inputTitleMap: Record<string, string> = {};
          for (const input of roomState.inputs) {
            inputTitleMap[input.inputId] = input.title || input.inputId;
          }

          const getPanelDefinition = (id: string): PanelDefinition => {
            if (isMotionPanelId(id)) {
              const inputId = getInputIdFromMotionPanel(id as MotionPanelId);
              return getMotionPanelDefinition(
                inputTitleMap[inputId] ?? inputId,
              );
            }
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
              panels={allPanels}
              allPanelIds={allPanelIds}
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
