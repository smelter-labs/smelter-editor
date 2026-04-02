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
import { RotateCcw, Home } from 'lucide-react';

import LoadingSpinner from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { WarningBanner } from '@/components/warning-banner';
import SmelterLogo from '@/components/ui/smelter-logo';
import { staggerContainer } from '@/utils/animations';
import RoomView from '@/components/pages/room-view';
import { ErrorBoundary } from '@/components/error-boundary';
import { useRoomStateSse } from '@/hooks/use-room-state-sse';
import {
  saveCrashRecoverySnapshot,
  loadCrashRecoveryConfig,
  clearCrashRecoveryConfig,
} from '@/lib/crash-recovery';
import { formatDuration } from '@/lib/format-utils';

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

  const [recoverySnapshot, setRecoverySnapshot] = useState<{
    inputCount: number;
    savedAt: string;
  } | null>(null);

  const getHomePath = useCallback(() => {
    return pathname?.toLowerCase().includes('kick') ? '/kick' : '/';
  }, [pathname]);

  useEffect(() => {
    if (!notFound) return;
    const recovery = loadCrashRecoveryConfig();
    if (recovery) {
      setRecoverySnapshot({
        inputCount: recovery.config.inputs.length,
        savedAt: recovery.savedAt,
      });
    } else {
      toast.error('Room not found, redirecting...');
      router.push(getHomePath());
    }
  }, [notFound, router, getHomePath]);

  const refreshState = useCallback(async () => {
    if (!roomId) return;
    const state = await sseRefresh();
    if (state === 'not-found') {
      const recovery = loadCrashRecoveryConfig();
      if (recovery) {
        setRecoverySnapshot({
          inputCount: recovery.config.inputs.length,
          savedAt: recovery.savedAt,
        });
      } else {
        toast.error('Room was closed, Redirecting ...');
        router.push(getHomePath());
      }
    }
  }, [roomId, sseRefresh, router, getHomePath]);

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
        try {
          const defaultInputIds = roomState.inputs.map(
            (input) => input.inputId,
          );
          localStorage.setItem(storageKey, JSON.stringify(defaultInputIds));
        } catch (error) {
          console.warn('Failed to persist default input IDs:', error);
        }
      }
      defaultInputsSavedRef.current = true;
    }
  }, [roomId, roomState.inputs]);

  useEffect(() => {
    if (!roomId || roomState.inputs.length === 0) return;

    const timer = setTimeout(() => {
      saveCrashRecoverySnapshot(roomId as string, roomState);
    }, 2000);

    return () => clearTimeout(timer);
  }, [roomId, roomState]);

  if (loading || (notFound && !recoverySnapshot)) {
    return (
      <div className='h-screen grid place-content-center bg-[#0a0a0a]'>
        <LoadingSpinner size='lg' variant='spinner' />
      </div>
    );
  }

  if (notFound && recoverySnapshot) {
    const homePath = getHomePath();
    return (
      <div className='h-screen grid place-content-center bg-[#0a0a0a]'>
        <div className='border border-neutral-800 rounded p-6 sm:p-8 max-w-md text-center'>
          <h2 className='text-xl font-semibold text-white'>
            Session interrupted
          </h2>
          <p className='text-sm text-neutral-400 mt-2'>
            The server appears to have restarted and this room no longer exists.
          </p>
          <p className='text-xs text-neutral-500 mt-1'>
            {recoverySnapshot.inputCount} input(s) &middot; saved{' '}
            {formatDuration(
              Date.now() - new Date(recoverySnapshot.savedAt).getTime(),
            )}{' '}
            ago
          </p>
          <div className='flex flex-col gap-2 mt-6'>
            <Button
              variant='default'
              className='w-full cursor-pointer'
              onClick={() => {
                router.push(`${homePath}?restore=true`);
              }}>
              <RotateCcw className='w-4 h-4 mr-2' />
              Restore session
            </Button>
            <Button
              variant='outline'
              className='w-full cursor-pointer'
              onClick={() => {
                clearCrashRecoveryConfig();
                router.push(homePath);
              }}>
              <Home className='w-4 h-4 mr-2' />
              Go home
            </Button>
          </div>
        </div>
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
