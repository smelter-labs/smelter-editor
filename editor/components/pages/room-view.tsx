import { RoomState, updateRoom } from '@/app/actions/actions';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AutoplayModal from '@/components/ui/autoplay-modal';
import { motion } from 'framer-motion';
import { staggerContainer } from '@/utils/animations';
import VideoPreview from '@/components/video-preview';
import ControlPanel from '@/components/control-panel/control-panel';
import RecordingsList from '@/components/recordings-list';
import { Button } from '@/components/ui/button';
import { FolderDown } from 'lucide-react';

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
  const [showRecordings, setShowRecordings] = useState(false);

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

  useEffect(() => {
    const attemptAutoplay = async () => {
      if (!videoRef.current) return;
      try {
        await videoRef.current.play();
      } catch (error) {
        setShowAutoplayPopup(true);
      }
    };
    attemptAutoplay();
  }, []);

  return (
    <>
      {showAutoplayPopup && !played && (
        <AutoplayModal
          onAllow={() => handleAutoplayPermission(true)}
          onDeny={() => handleAutoplayPermission(false)}
        />
      )}

      <RecordingsList
        open={showRecordings}
        onClose={() => setShowRecordings(false)}
        roomId={roomId}
      />

      <div className='flex justify-end gap-2 mb-1'>
        <Button
          size='sm'
          variant='ghost'
          className='text-neutral-400 hover:text-white cursor-pointer'
          onClick={() => setShowRecordings(true)}>
          <FolderDown className='w-4 h-4 mr-1' />
          Recordings
        </Button>
      </div>

      <motion.div
        variants={staggerContainer}
        className='flex-1 grid grid-cols-1 grid-rows-[auto,1fr] gap-0 xl:grid-cols-4 xl:grid-rows-none xl:gap-4 min-h-0 h-full items-start overflow-hidden'>
        <VideoPreview
          videoRef={videoRef}
          whepUrl={roomState.whepUrl}
          roomId={roomId}
          isPublic={roomState.isPublic}
          onTogglePublic={handleTogglePublic}
          resolution={roomState.resolution}
          isGuest={isGuest}
          guestStream={guestStream}
        />
        <motion.div className='col-span-1 w-full flex flex-col xl:gap-4 min-h-0 h-full max-h-full justify-start overflow-y-auto overflow-x-hidden md:pr-4 control-panel-container'>
          <div className='control-panel-wrapper'>
            <ControlPanel
              roomState={roomState}
              roomId={roomId}
              refreshState={refreshState}
              isGuest={isGuest}
              onGuestStreamChange={setGuestStream}
            />
          </div>
        </motion.div>
      </motion.div>
    </>
  );
}
