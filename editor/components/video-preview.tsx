import OutputStream from '@/components/output-stream';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Share2, Mail, ToggleLeft, ToggleRight } from 'lucide-react';
import { fadeInUp } from '@/utils/animations';
import { motion } from 'framer-motion';
import { VideoOff } from 'lucide-react';
import { RefObject } from 'react';

export default function VideoPreview({
  whepUrl,
  videoRef,
  tryToPlay,
  roomId,
  isPublic,
  onTogglePublic,
}: {
  whepUrl: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  tryToPlay?(): void;
  roomId?: string;
  isPublic?: boolean;
  onTogglePublic?: () => void;
}) {
  const activeStream = true;

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
                  <OutputStream videoRef={videoRef} whepUrl={whepUrl} />
                </div>
              ) : (
                <div className='text-center'>
                  <VideoOff className='w-12 h-12 mx-auto mb-2 text-neutral-600' />
                  <p className='text-sm text-neutral-600'>No active stream</p>
                </div>
              )}
            </div>
            {roomId && (
              <div className='mt-3 flex justify-between items-center'>
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
                <div className='flex'>
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
