'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useParams,
  useRouter,
  usePathname,
  useSearchParams,
} from 'next/navigation';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import Link from 'next/link';

import LoadingSpinner from '@/components/ui/spinner';
import { WarningBanner } from '@/components/warning-banner';
import SmelterLogo from '@/components/ui/smelter-logo';
import { staggerContainer } from '@/utils/animations';
import RoomView from '@/components/pages/room-view';
import { ErrorBoundary } from '@/components/error-boundary';
import { useRoomStateSse } from '@/hooks/use-room-state-sse';

export default function RoomPage() {
  const router = useRouter();
  const { roomId } = useParams();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isGuest = searchParams.get('guest') === 'true';
  const defaultInputsSavedRef = useRef(false);
  const settingsNavRef = useRef<HTMLDivElement | null>(null);
  const [settingsNavReady, setSettingsNavReady] = useState(false);

  useEffect(() => {
    setSettingsNavReady(true);
  }, []);

  useEffect(() => {
    defaultInputsSavedRef.current = false;
  }, [roomId]);

  const {
    roomState,
    loading,
    notFound,
    refreshState: sseRefresh,
  } = useRoomStateSse(roomId as string | undefined);

  useEffect(() => {
    if (!notFound) return;
    toast.error('Room not found, redirecting...');
    if (pathname?.toLowerCase().includes('kick')) {
      router.push('/kick');
    } else {
      router.push('/');
    }
  }, [notFound, router, pathname]);

  const refreshState = useCallback(async () => {
    if (!roomId) return;
    const state = await sseRefresh();
    if (state === 'not-found') {
      toast.error('Room was closed, Redirecting ...');
      if (pathname?.toLowerCase().includes('kick')) {
        router.push('/kick');
      } else {
        router.push('/');
      }
    }
  }, [roomId, sseRefresh, router, pathname]);

  useEffect(() => {
    if (
      !defaultInputsSavedRef.current &&
      roomId &&
      typeof window !== 'undefined' &&
      roomState.inputs.length > 0
    ) {
      const storageKey = `smelter:default-inputs:${roomId}`;
      const existing = localStorage.getItem(storageKey);
      if (!existing) {
        const defaultInputIds = roomState.inputs.map((input) => input.inputId);
        localStorage.setItem(storageKey, JSON.stringify(defaultInputIds));
      }
      defaultInputsSavedRef.current = true;
    }
  }, [roomId, roomState.inputs]);

  if (loading || notFound) {
    return (
      <div className='h-screen grid place-content-center bg-[#0a0a0a]'>
        <LoadingSpinner size='lg' variant='spinner' />
      </div>
    );
  }

  return (
    <motion.div
      variants={staggerContainer}
      className='h-screen flex flex-col p-2 py-4 md:p-4 bg-[#0a0a0a]'>
      <div className='flex items-center gap-6 mb-4'>
        <div
          style={{
            display: 'inline-block',
            width: `${162.5 / 1.2}px`,
            height: `${21.25 / 1.2}px`,
            flexShrink: 0,
          }}>
          <SmelterLogo />
        </div>
        <div ref={settingsNavRef} className='flex-1' />
      </div>
      {roomState.pendingDelete && (
        <Link href='/'>
          <WarningBanner>
            This room will be removed shortly, go to the main page and start a
            new one.
          </WarningBanner>
        </Link>
      )}

      <ErrorBoundary>
        <RoomView
          roomState={roomState}
          roomId={roomId as string}
          refreshState={refreshState}
          isGuest={isGuest}
          settingsNavPortalRef={settingsNavReady ? settingsNavRef : undefined}
        />
      </ErrorBoundary>
    </motion.div>
  );
}
