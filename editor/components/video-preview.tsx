import OutputStream, {
  type OutputResolution,
} from '@/components/output-stream';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { fadeInUp } from '@/utils/animations';
import { motion } from 'framer-motion';
import { VideoOff, Eye, EyeOff, Monitor, Camera } from 'lucide-react';
import { RefObject, useEffect, useRef, useState } from 'react';
import type { VideoOverlayRect } from '@/components/control-panel/control-panel';

export default function VideoPreview({
  whepUrl,
  videoRef,
  tryToPlay,
  resolution,
  isGuest,
  guestStream,
  className,
  roomId,
  overlayRects,
}: {
  whepUrl: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  tryToPlay?(): void;
  resolution?: OutputResolution;
  isGuest?: boolean;
  guestStream?: MediaStream | null;
  className?: string;
  roomId?: string;
  overlayRects?: VideoOverlayRect[];
}) {
  const activeStream = true;
  const [showPreview, setShowPreview] = useState(!isGuest);
  const [previewMode, setPreviewMode] = useState<'input' | 'output'>('input');
  const guestVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!guestVideoRef.current) return;
    if (guestStream) {
      guestVideoRef.current.srcObject = guestStream;
      guestVideoRef.current.play().catch(() => {});
    } else {
      guestVideoRef.current.srcObject = null;
    }
  }, [guestStream]);

  return (
    <motion.div
      className={`${className ?? ''} w-full h-full`}
      {...(fadeInUp as any)}>
      <Card className='flex flex-col bg-transparent border-0 h-full py-0'>
        <CardContent className='flex flex-col flex-1 min-h-0 h-full'>
          <div className='w-full max-w-[1920px] mx-auto flex flex-col flex-1 min-h-0'>
            {isGuest && (
              <div className='flex justify-end gap-2 mb-2'>
                {guestStream && showPreview && (
                  <div className='flex rounded-md overflow-hidden border border-neutral-700'>
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={() => setPreviewMode('input')}
                      className={`cursor-pointer rounded-none ${
                        previewMode === 'input'
                          ? 'bg-neutral-700 text-white'
                          : 'text-neutral-500'
                      }`}>
                      <Camera className='w-4 h-4' />
                      My Input
                    </Button>
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={() => setPreviewMode('output')}
                      className={`cursor-pointer rounded-none ${
                        previewMode === 'output'
                          ? 'bg-neutral-700 text-white'
                          : 'text-neutral-500'
                      }`}>
                      <Monitor className='w-4 h-4' />
                      Output
                    </Button>
                  </div>
                )}
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => setShowPreview((v) => !v)}
                  className='cursor-pointer text-neutral-500 hover:bg-neutral-200'>
                  {showPreview ? (
                    <EyeOff className='w-4 h-4' />
                  ) : (
                    <Eye className='w-4 h-4' />
                  )}
                  {showPreview ? 'Hide Preview' : 'Show Preview'}
                </Button>
              </div>
            )}
            {showPreview && (
              <div className='rounded-none flex items-center justify-center flex-1 min-h-0 overflow-hidden'>
                {isGuest && guestStream && previewMode === 'input' ? (
                  <div
                    className='relative bg-black rounded-none overflow-hidden border-[#2a2a2a] border-4'
                    style={{
                      aspectRatio: '16/9',
                      maxWidth: '100%',
                      maxHeight: '100%',
                      width: '100%',
                    }}>
                    <video
                      ref={guestVideoRef}
                      muted
                      playsInline
                      autoPlay
                      className='w-full h-full object-contain bg-black'
                    />
                  </div>
                ) : activeStream ? (
                  <div className='w-full h-full flex items-center justify-center'>
                    <OutputStream
                      videoRef={videoRef}
                      whepUrl={whepUrl}
                      resolution={resolution}
                      roomId={roomId}
                      overlayRects={overlayRects}
                    />
                  </div>
                ) : (
                  <div className='text-center'>
                    <VideoOff className='w-12 h-12 mx-auto mb-2 text-neutral-600' />
                    <p className='text-sm text-neutral-600'>No active stream</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
