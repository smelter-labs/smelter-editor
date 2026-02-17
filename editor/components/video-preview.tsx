import OutputStream, {
  type OutputResolution,
} from '@/components/output-stream';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Share2, Mail, ToggleLeft, ToggleRight } from 'lucide-react';
import { fadeInUp } from '@/utils/animations';
import { motion } from 'framer-motion';
import { VideoOff } from 'lucide-react';
import { RefObject, useState } from 'react';
import { startRecording, stopRecording } from '@/app/actions/actions';

export default function VideoPreview({
  whepUrl,
  videoRef,
  tryToPlay,
  roomId,
  isPublic,
  onTogglePublic,
  resolution,
  isGuest,
}: {
  whepUrl: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  tryToPlay?(): void;
  roomId?: string;
  isPublic?: boolean;
  onTogglePublic?: () => void;
  resolution?: OutputResolution;
  isGuest?: boolean;
}) {
  const activeStream = true;
  const [isRecording, setIsRecording] = useState(false);
  const [isTogglingRecording, setIsTogglingRecording] = useState(false);
  const [isWaitingForDownload, setIsWaitingForDownload] = useState(false);

  const handleToggleRecording = async () => {
    if (!roomId || isTogglingRecording || isWaitingForDownload) return;
    setIsTogglingRecording(true);
    try {
      if (!isRecording) {
        const res = await startRecording(roomId);
        if (res.status === 'recording') {
          setIsRecording(true);
        } else {
          console.error('Failed to start recording', res.message);
        }
      } else {
        // Stop recording: switch to "Wait..." state until download starts
        setIsWaitingForDownload(true);
        const res = await stopRecording(roomId);
        if (res.status === 'stopped') {
          setIsRecording(false);
          if (res.downloadUrl) {
            setTimeout(() => {
              if (typeof window === 'undefined') return;
              const link = document.createElement('a');
              link.href = res.downloadUrl!;
              link.download = '';
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              setIsWaitingForDownload(false);
            }, 1500);
          } else {
            setIsWaitingForDownload(false);
          }
        } else {
          console.error('Failed to stop recording', res.message);
          setIsWaitingForDownload(false);
        }
      }
    } catch (err) {
      console.error('Error while toggling recording', err);
      setIsWaitingForDownload(false);
    } finally {
      setIsTogglingRecording(false);
    }
  };

  return (
    <motion.div
      className='col-span-1 xl:col-span-3 sticky top-0 self-start z-10 w-full'
      {...(fadeInUp as any)}>
      <Card className='flex flex-col bg-[#0a0a0a] border-0'>
        <CardContent className='flex flex-col'>
          <div className='w-full max-w-[1920px] mx-auto'>
            <div className='rounded-none flex items-center justify-center bg-[#141414]'>
              {activeStream ? (
                <div>
                  <OutputStream
                    videoRef={videoRef}
                    whepUrl={whepUrl}
                    resolution={resolution}
                  />
                </div>
              ) : (
                <div className='text-center'>
                  <VideoOff className='w-12 h-12 mx-auto mb-2 text-neutral-600' />
                  <p className='text-sm text-neutral-600'>No active stream</p>
                </div>
              )}
            </div>
            {roomId && !isGuest && (
              <div className='mt-3 flex justify-between items-center gap-2'>
                {onTogglePublic && (
                  <Button
                    size='lg'
                    variant='outline'
                    onClick={onTogglePublic}
                    className={`cursor-pointer max-md:h-8 max-md:px-3 max-md:text-xs ${
                      isPublic
                        ? 'text-black bg-white hover:bg-neutral-200'
                        : 'border-2 border-neutral-700 text-neutral-500 bg-transparent hover:bg-neutral-200'
                    }`}>
                    {isPublic ? (
                      <ToggleRight className='w-4 h-4' />
                    ) : (
                      <ToggleLeft className='w-4 h-4' />
                    )}
                    Public
                  </Button>
                )}
                <div className='flex gap-2'>
                  <Button
                    size='lg'
                    variant='outline'
                    onClick={handleToggleRecording}
                    disabled={isTogglingRecording || isWaitingForDownload}
                    className='max-md:h-8 max-md:px-3 max-md:text-xs text-neutral-500 hover:bg-neutral-200'>
                    {isWaitingForDownload ? (
                      'Wait...'
                    ) : isRecording ? (
                      <span className='inline-flex items-center gap-1'>
                        <span>Stop recording</span>
                        <span className='animate-pulse'>...</span>
                      </span>
                    ) : (
                      'Record'
                    )}
                  </Button>
                  <Button
                    size='lg'
                    asChild
                    variant='outline'
                    className='max-md:h-8 max-md:px-3 max-md:text-xs text-neutral-500 hover:bg-neutral-200'>
                    <Link
                      href={`/room-preview/${roomId}`}
                      target='_blank'
                      rel='noopener noreferrer'>
                      <Share2 className='w-4 h-4' />
                      Prove Me
                    </Link>
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
