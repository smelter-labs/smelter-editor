import { RoomState, updateRoom } from '@/app/actions/actions';
import { useCallback, useEffect, useRef, useState } from 'react';
import AutoplayModal from '@/components/ui/autoplay-modal';
import { motion } from 'framer-motion';
import { staggerContainer } from '@/utils/animations';
import VideoPreview from '@/components/video-preview';
import ControlPanel from '@/components/control-panel/control-panel';
import { Button } from '@/components/ui/button';
import { RotateCw } from 'lucide-react';

interface RoomViewProps {
  roomId: string;
  roomState: RoomState;
  refreshState: () => Promise<void>;
  isGuest?: boolean;
}

export default function RoomView({
  roomId,
  roomState,
  refreshState,
  isGuest,
}: RoomViewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [showAutoplayPopup, setShowAutoplayPopup] = useState(true);
  const [played, setPlayed] = useState(false);
  const [guestStream, setGuestStream] = useState<MediaStream | null>(null);
  const [panelExpanded, setPanelExpanded] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('control-panel-expanded') === 'true';
  });

  const togglePanelExpanded = useCallback(() => {
    setPanelExpanded((prev) => {
      const next = !prev;
      localStorage.setItem('control-panel-expanded', String(next));
      return next;
    });
  }, []);

  const handleAutoplayPermission = useCallback((allow: boolean) => {
    if (allow) {
      videoRef.current?.play();
    }
    setShowAutoplayPopup(false);
  }, []);

  const handleTogglePublic = useCallback(async () => {
    await updateRoom(roomId, { isPublic: !roomState.isPublic });
    await refreshState();
  }, [roomId, roomState.isPublic, refreshState]);

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

  // Sync guest rotation when host changes orientation via server
  useEffect(() => {
    if (!isGuest || !guestInputId) return;
    const guestInput = roomState.inputs.find((i) => i.inputId === guestInputId);
    if (!guestInput) return;
    const serverVertical = guestInput.orientation === 'vertical';
    const localVertical = guestRotation % 180 !== 0;
    if (serverVertical !== localVertical && guestRotateRef.current) {
      guestRotateRef.current().then(setGuestRotation);
    }
  }, [isGuest, guestInputId, roomState.inputs]);

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

      <motion.div
        variants={staggerContainer}
        className={`flex-1 grid min-h-0 h-full overflow-hidden gap-4 ${panelExpanded ? 'xl:grid-cols-2' : 'xl:grid-cols-4'}`}
        style={{ gridTemplateRows: 'minmax(0, 1fr) auto' }}>
        <div
          className={`${panelExpanded ? 'xl:col-span-1' : 'xl:col-span-3'} flex flex-col gap-4 min-h-0`}>
          <VideoPreview
            videoRef={videoRef}
            whepUrl={roomState.whepUrl}
            roomId={roomId}
            isPublic={roomState.isPublic}
            onTogglePublic={handleTogglePublic}
            resolution={roomState.resolution}
            panelExpanded={panelExpanded}
            onTogglePanelExpanded={togglePanelExpanded}
          />
        </div>
        <div
          className='col-span-1 row-span-1 w-full flex flex-col min-h-0 h-full max-h-full justify-start overflow-x-hidden md:pr-4 control-panel-container'
          style={{ display: 'contents' }}>
          <ControlPanel
            roomState={roomState}
            roomId={roomId}
            refreshState={refreshState}
            renderStreamsOutside
          />
        </div>
      </motion.div>
    </>
  );
}
