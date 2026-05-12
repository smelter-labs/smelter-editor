'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Camera, Eye, Home } from 'lucide-react';

import type { RoomState } from '@/lib/types';
import { getRoomInfo } from '@/app/actions/actions';
import OutputStream from '@/components/output-stream';
import LoadingSpinner from '@/components/ui/spinner';
import SmelterLogo from '@/components/ui/smelter-logo';
import { Button } from '@/components/ui/button';

type View = 'choose' | 'preview';

export default function MobileJoinPage() {
  const router = useRouter();
  const { roomId } = useParams();
  const [view, setView] = useState<View>('choose');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let mounted = true;
    const fetchState = async () => {
      if (!roomId) {
        if (mounted) setNotFound(true);
        return;
      }

      const state = await getRoomInfo(roomId as string);
      if (!mounted) return;

      if (state === 'not-found') {
        setNotFound(true);
        setLoading(false);
        return;
      }

      setRoomState(state);
      setLoading(false);
    };
    void fetchState();
    const interval = setInterval(fetchState, 5_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [roomId]);

  const handleJoinAsCamera = () => {
    if (!roomId) return;
    router.push(`/room/${encodeURIComponent(roomId as string)}?guest=true`);
  };

  if (loading) {
    return (
      <div className='min-h-screen w-full bg-[#0a0a0a] flex items-center justify-center'>
        <LoadingSpinner size='lg' variant='spinner' />
      </div>
    );
  }

  if (notFound || !roomState) {
    return (
      <div className='min-h-screen w-full bg-[#0a0a0a] text-white flex items-center justify-center p-6'>
        <div className='border border-neutral-800 rounded p-6 max-w-md w-full text-center'>
          <h2 className='text-xl font-semibold'>Room not found</h2>
          <p className='text-sm text-neutral-400 mt-2'>
            The room link you scanned is no longer active.
          </p>
          <Button asChild variant='outline' className='mt-6 text-black'>
            <Link href='/'>
              <Home className='w-4 h-4 mr-2' />
              Go home
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className='min-h-screen w-full bg-[#0a0a0a] text-white flex flex-col'>
      <header className='flex items-center gap-4 p-4 border-b border-neutral-900'>
        <div
          style={{
            display: 'inline-block',
            width: '140px',
            height: '18px',
            flexShrink: 0,
          }}>
          <SmelterLogo />
        </div>
      </header>

      <main className='flex-1 flex flex-col p-4 gap-4'>
        {view === 'choose' && (
          <div className='flex-1 flex flex-col justify-center gap-4 max-w-md mx-auto w-full'>
            <h1 className='text-2xl font-semibold text-center mb-2'>
              How do you want to join?
            </h1>
            <p className='text-sm text-neutral-400 text-center mb-4'>
              Choose an option below to connect to this room.
            </p>

            <button
              onClick={handleJoinAsCamera}
              className='group flex items-center gap-4 p-5 border border-neutral-800 rounded-lg bg-neutral-900/40 hover:border-[#00f3ff] hover:bg-neutral-900/60 transition-colors cursor-pointer text-left'>
              <div className='shrink-0 w-12 h-12 rounded-full bg-neutral-800 flex items-center justify-center group-hover:bg-[#00f3ff]/10'>
                <Camera className='w-6 h-6 text-[#00f3ff]' />
              </div>
              <div className='flex-1 min-w-0'>
                <div className='text-lg font-semibold'>Join as Camera</div>
                <div className='text-sm text-neutral-400'>
                  Send your phone&apos;s camera as a new input.
                </div>
              </div>
            </button>

            <button
              onClick={() => setView('preview')}
              className='group flex items-center gap-4 p-5 border border-neutral-800 rounded-lg bg-neutral-900/40 hover:border-[#00f3ff] hover:bg-neutral-900/60 transition-colors cursor-pointer text-left'>
              <div className='shrink-0 w-12 h-12 rounded-full bg-neutral-800 flex items-center justify-center group-hover:bg-[#00f3ff]/10'>
                <Eye className='w-6 h-6 text-[#00f3ff]' />
              </div>
              <div className='flex-1 min-w-0'>
                <div className='text-lg font-semibold'>Watch Output</div>
                <div className='text-sm text-neutral-400'>
                  Preview the room&apos;s live output stream.
                </div>
              </div>
            </button>
          </div>
        )}

        {view === 'preview' && (
          <div className='flex-1 flex flex-col gap-3 w-full'>
            <div className='flex items-center justify-between'>
              <button
                onClick={() => setView('choose')}
                className='text-sm uppercase tracking-widest text-[#849495] hover:text-[#00f3ff] transition-colors cursor-pointer'>
                Back
              </button>
            </div>
            <div className='flex-1 flex items-center justify-center'>
              <div className='w-full max-w-3xl'>
                <OutputStream
                  whepUrl={roomState.whepUrl}
                  videoRef={videoRef}
                  resolution={roomState.resolution}
                  roomId={roomId as string}
                />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
