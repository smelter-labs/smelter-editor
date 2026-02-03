'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Share2 } from 'lucide-react';

import { getRoomInfo, type RoomState } from '@/app/actions/actions';
import OutputStream from '@/components/output-stream';
import LoadingSpinner from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function RoomPreviewPage() {
  const { roomId } = useParams();
  const [loading, setLoading] = useState(true);
  const [roomState, setRoomState] = useState<RoomState>({
    inputs: [],
    layout: 'grid',
    whepUrl: '',
  });
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let mounted = true;
    const fetchState = async () => {
      if (!roomId) return;
      const state = await getRoomInfo(roomId as string);
      if (state !== 'not-found' && mounted) {
        setRoomState(state);
        setLoading(false);
      }
    };
    void fetchState();
    const interval = setInterval(fetchState, 3_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [roomId]);

  // Use relative path to avoid SSR/client mismatch
  const previewHref = `/room-preview/${roomId}/grid?cols=6&rows=4`;

  return (
    <div className='min-h-screen w-full bg-[#0a0a0a] text-white flex items-center justify-center p-4'>
      <div className='w-full max-w-6xl'>
        <div className='w-full max-w-[1920px] mx-auto'>
          {loading ? (
            <div className='flex items-center justify-center h-[60vh]'>
              <LoadingSpinner size='lg' variant='spinner' />
            </div>
          ) : (
            <OutputStream
              whepUrl={roomState.whepUrl}
              videoRef={videoRef}
              resolution={roomState.resolution}
            />
          )}
        </div>
        <div className='mt-4 flex items-center justify-end w-full max-w-[1920px] mx-auto'>
          <Button asChild variant='outline' className='text-black'>
            <Link href={previewHref} target='_blank' rel='noopener noreferrer'>
              <Share2 className='w-4 h-4' /> Prove Me More
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
