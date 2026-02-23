'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  useParams,
  useRouter,
  usePathname,
  useSearchParams,
} from 'next/navigation';
import { motion } from 'framer-motion';
import { toast } from 'react-toastify';
import Link from 'next/link';

import { getRoomInfo, RoomState } from '@/app/actions/actions';
import LoadingSpinner from '@/components/ui/spinner';
import { WarningBanner } from '@/components/warning-banner';
import SmelterLogo from '@/components/ui/smelter-logo';
import { staggerContainer } from '@/utils/animations';
import RoomView from '@/components/pages/room-view';

export default function RoomPage() {
  const router = useRouter();
  const { roomId } = useParams();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isGuest = searchParams.get('guest') === 'true';

  const [loading, setLoading] = useState(true);
  const [roomState, setRoomState] = useState<RoomState>({
    inputs: [],
    layout: 'grid',
    whepUrl: '',
  });

  const refreshState = useCallback(async () => {
    if (!roomId) return;

    const state = await getRoomInfo(roomId as string);

    if (state === 'not-found') {
      toast.error('Room was closed, Redirecting ...');
      if (pathname?.toLowerCase().includes('kick')) {
        router.push('/kick');
      } else {
        router.push('/');
      }
    } else {
      setRoomState(state);
      setLoading(false);

      // Save default inputs on first load if they exist and haven't been saved yet
      if (typeof window !== 'undefined' && state.inputs.length > 0) {
        const storageKey = `smelter:default-inputs:${roomId}`;
        const existing = localStorage.getItem(storageKey);
        if (!existing) {
          const defaultInputIds = state.inputs.map((input) => input.inputId);
          localStorage.setItem(storageKey, JSON.stringify(defaultInputIds));
        }
      }
    }
  }, [roomId, router, pathname]);

  useEffect(() => {
    void refreshState();
    const interval = setInterval(refreshState, 3_000);
    return () => clearInterval(interval);
  }, [refreshState]);

  return (
    <motion.div
      variants={staggerContainer}
      className='h-screen flex flex-col p-2 py-4 md:p-4 bg-[#0a0a0a]'>
      <div className='flex items-center justify-between'>
        <div
          style={{
            display: 'inline-block',
            width: `${162.5 / 1.2}px`,
            height: `${21.25 / 1.2}px`,
          }}>
          <SmelterLogo />
        </div>
      </div>
      {roomState.pendingDelete && (
        <Link href='/'>
          <WarningBanner>
            This room will be removed shortly, go to the main page and start a
            new one.
          </WarningBanner>
        </Link>
      )}

      {loading ? (
        <motion.div
          variants={staggerContainer}
          className='flex-1 grid min-h-0 justify-center content-center'>
          <LoadingSpinner size='lg' variant='spinner' />
        </motion.div>
      ) : (
        <RoomView
          roomState={roomState}
          roomId={roomId as string}
          refreshState={refreshState}
          isGuest={isGuest}
        />
      )}
    </motion.div>
  );
}
