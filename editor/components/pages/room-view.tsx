import { RoomState, updateRoom } from '@/app/actions/actions';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AutoplayModal from '@/components/ui/autoplay-modal';
import { motion } from 'framer-motion';
import { staggerContainer } from '@/utils/animations';
import VideoPreview from '@/components/video-preview';
import ControlPanel from '@/components/control-panel/control-panel';

interface RoomViewProps {
  roomId: string;
  roomState: RoomState;
  refreshState: () => Promise<void>;
}

export default function RoomView({
  roomId,
  roomState,
  refreshState,
}: RoomViewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [showAutoplayPopup, setShowAutoplayPopup] = useState(true);
  const [played, setPlayed] = useState(false);
  const [isAutoTourStarting, setIsAutoTourStarting] = useState(false);

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
    setupVideoEventListeners();
  }, [setupVideoEventListeners]);

  // Check if tour is auto-starting via hash
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const h = (window.location.hash || '').toLowerCase();
    if (
      h.includes('tour-main') ||
      h.includes('tour-composing') ||
      h.includes('tour-shaders')
    ) {
      setIsAutoTourStarting(true);
      setShowAutoplayPopup(false);
    }
  }, []);

  useEffect(() => {
    const attemptAutoplay = async () => {
      if (!videoRef.current) return;
      try {
        await videoRef.current.play();
      } catch (error) {
        // Only show autoplay popup if tour is not auto-starting
        if (!isAutoTourStarting) {
          setShowAutoplayPopup(true);
        }
      }
    };
    attemptAutoplay();
  }, [isAutoTourStarting]);

  return (
    <>
      {showAutoplayPopup && !played && !isAutoTourStarting && (
        <AutoplayModal
          onAllow={() => handleAutoplayPermission(true)}
          onDeny={() => handleAutoplayPermission(false)}
        />
      )}

      <motion.div
        variants={staggerContainer}
        className='flex-1 grid grid-cols-1 grid-rows-[auto,1fr] gap-0 xl:grid-cols-4 xl:grid-rows-none xl:gap-4 min-h-0 h-full items-start overflow-hidden'>
        <VideoPreview
          videoRef={videoRef}
          whepUrl={roomState.whepUrl}
          roomId={roomId}
          isPublic={roomState.isPublic}
          onTogglePublic={handleTogglePublic}
        />
        <motion.div className='col-span-1 w-full flex flex-col xl:gap-4 min-h-0 h-full max-h-full justify-start overflow-y-auto overflow-x-hidden md:pr-4 control-panel-container'>
          <div className='control-panel-wrapper'>
            <ControlPanel
              roomState={roomState}
              roomId={roomId}
              refreshState={refreshState}
            />
          </div>
        </motion.div>
      </motion.div>
    </>
  );
}
