'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  DriverTourProvider,
  DriverToursProvider,
} from '../tour/DriverTourContext';
import { useDriverTourControls } from '../tour/DriverTourContext';
import {
  composingTourSteps,
  commonTourOptions,
  mobileTourSteps,
  roomTourSteps,
  shadersTourSteps,
  mobileTourOptions,
} from '../tour/tour-config';
import TourLauncher from '@/components/room-page/TourLauncher';
import { useIsMobile } from '@/hooks/use-mobile';

export default function RoomPage() {
  const router = useRouter();
  const { roomId } = useParams();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isGuest = searchParams.get('guest') === 'true';

  const [loading, setLoading] = useState(true);
  const isMobile = useIsMobile();
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

  function MobileTourAutostart({
    loading,
    isMobile,
  }: {
    loading: boolean;
    isMobile: boolean;
  }) {
    const { start } = useDriverTourControls('mobile');
    const startedRef = useRef(false);
    useEffect(() => {
      if (!isMobile) return;
      const alreadyShown =
        window.sessionStorage.getItem('mobileTourShown') === '1';
      if (alreadyShown) return;
      startedRef.current = true;
      const id = window.setTimeout(() => {
        try {
          window.sessionStorage.setItem('mobileTourShown', '1');
        } catch {}
        start();
      }, 1500);
      return () => window.clearTimeout(id);
    }, [loading, start, isMobile]);
    return null;
  }

  function HashTourAutostart({ loading }: { loading: boolean }) {
    const roomCtl = useDriverTourControls('room');
    const composingCtl = useDriverTourControls('composing');
    const shadersCtl = useDriverTourControls('shaders');
    const didStartRef = useRef(false);
    let hash = '';
    if (typeof window !== 'undefined') {
      const h = (window.location.hash || '').toLowerCase();
      if (
        h.includes('tour-main') ||
        h.includes('tour-composing') ||
        h.includes('tour-shaders')
      ) {
        hash = h;
        window.location.hash = '';
        setTimeout(() => {
          if (h.includes('tour-main')) {
            roomCtl.start();
          } else if (h.includes('tour-composing')) {
            composingCtl.start();
          } else if (h.includes('tour-shaders')) {
            shadersCtl.start();
          }
        }, 500);
      }
    }
    return null;
  }

  // Expand all accordions after any tour stops
  useEffect(() => {
    const onTourStop = () => {
      try {
        const allAccordions = document.querySelectorAll(
          '[data-accordion="true"]',
        ) as NodeListOf<HTMLDivElement>;
        allAccordions.forEach((acc) => {
          if (acc.getAttribute('data-open') !== 'true') {
            acc.querySelector('button')?.click();
          }
        });
      } catch {}
    };
    window.addEventListener('smelter:tour:stop', onTourStop as EventListener);
    return () => {
      window.removeEventListener(
        'smelter:tour:stop',
        onTourStop as EventListener,
      );
    };
  }, []);

  return (
    <DriverToursProvider>
      <DriverTourProvider
        id='mobile'
        steps={mobileTourSteps}
        options={mobileTourOptions}>
        {(() => {
          function StopToursOnPendingDelete({ pending }: { pending: boolean }) {
            const { forceStop: stopMobile } = useDriverTourControls('mobile');
            const { forceStop: stopRoom } = useDriverTourControls('room');
            const { forceStop: stopShaders } = useDriverTourControls('shaders');
            const { forceStop: stopComposing } =
              useDriverTourControls('composing');
            const didStopRef = useRef(false);
            useEffect(() => {
              if (!pending || didStopRef.current) return;
              didStopRef.current = true;
              stopMobile?.();
              stopRoom?.();
              stopShaders?.();
              stopComposing?.();
            }, [pending, stopMobile, stopRoom, stopShaders, stopComposing]);
            return null;
          }
          return (
            <StopToursOnPendingDelete pending={!!roomState.pendingDelete} />
          );
        })()}
        <DriverTourProvider
          id='room'
          steps={roomTourSteps}
          options={commonTourOptions}>
          <DriverTourProvider
            id='shaders'
            steps={shadersTourSteps}
            options={commonTourOptions}>
            <DriverTourProvider
              id='composing'
              steps={composingTourSteps}
              options={commonTourOptions}>
              <MobileTourAutostart loading={loading} isMobile={isMobile} />
              <HashTourAutostart loading={loading} />
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
                  <div className='hidden md:block'>
                    <TourLauncher />
                  </div>
                </div>
                {roomState.pendingDelete && (
                  <Link href='/'>
                    <WarningBanner>
                      This room will be removed shortly, go to the main page and
                      start a new one.
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
            </DriverTourProvider>
          </DriverTourProvider>
        </DriverTourProvider>
      </DriverTourProvider>
    </DriverToursProvider>
  );
}
