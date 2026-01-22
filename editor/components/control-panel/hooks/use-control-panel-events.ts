import { useEffect, useRef } from 'react';
import type { InputWrapper } from './use-control-panel-state';
import { removeInput } from '@/app/actions/actions';
import { stopCameraAndConnection } from '../whip-input/utils/preview';
import {
  loadWhipSession,
  loadLastWhipInputId,
  clearWhipSessionFor,
} from '../whip-input/utils/whip-storage';

type UseControlPanelEventsProps = {
  inputsRef: React.MutableRefObject<any[]>;
  inputWrappers: InputWrapper[];
  setInputWrappers: (
    wrappers: InputWrapper[] | ((prev: InputWrapper[]) => InputWrapper[]),
  ) => void;
  setListVersion: (v: number | ((prev: number) => number)) => void;
  updateOrder: (wrappers: InputWrapper[]) => Promise<void>;
  nextIfComposing: (step: number) => void;
  setAddInputActiveTab: (tab: 'stream' | 'mp4' | 'image' | 'inputs') => void;
  setStreamActiveTab: (tab: 'twitch' | 'kick') => void;
  addVideoAccordionRef: React.MutableRefObject<any>;
  roomId: string;
  handleRefreshState: () => Promise<void>;
  cameraPcRef: React.MutableRefObject<RTCPeerConnection | null>;
  cameraStreamRef: React.MutableRefObject<MediaStream | null>;
  screensharePcRef: React.MutableRefObject<RTCPeerConnection | null>;
  screenshareStreamRef: React.MutableRefObject<MediaStream | null>;
  activeCameraInputId: string | null;
  activeScreenshareInputId: string | null;
  setActiveCameraInputId: (id: string | null) => void;
  setIsCameraActive: (active: boolean) => void;
  setActiveScreenshareInputId: (id: string | null) => void;
  setIsScreenshareActive: (active: boolean) => void;
  setOpenFxInputId: (id: string | null) => void;
};

export function useControlPanelEvents({
  inputsRef,
  inputWrappers,
  setInputWrappers,
  setListVersion,
  updateOrder,
  nextIfComposing,
  setAddInputActiveTab,
  setStreamActiveTab,
  addVideoAccordionRef,
  roomId,
  handleRefreshState,
  cameraPcRef,
  cameraStreamRef,
  screensharePcRef,
  screenshareStreamRef,
  activeCameraInputId,
  activeScreenshareInputId,
  setActiveCameraInputId,
  setIsCameraActive,
  setActiveScreenshareInputId,
  setIsScreenshareActive,
  setOpenFxInputId,
}: UseControlPanelEventsProps) {
  useEffect(() => {
    const onMove = (e: any) => {
      try {
        const { inputId, direction } = e?.detail || {};
        if (!inputId || !direction) return;
        setInputWrappers((prev) => {
          const current = [...prev];
          const idx = current.findIndex((it) => it.inputId === inputId);
          if (idx < 0) return prev;
          const target =
            direction === 'up'
              ? Math.max(0, idx - 1)
              : Math.min(current.length - 1, idx + 1);
          if (target === idx) return prev;
          const [item] = current.splice(idx, 1);
          current.splice(target, 0, item);
          void updateOrder(current);
          return current;
        });
        setListVersion((v) => v + 1);
        nextIfComposing(0);
      } catch {}
    };
    window.addEventListener('smelter:inputs:move', onMove as EventListener);
    return () => {
      window.removeEventListener(
        'smelter:inputs:move',
        onMove as EventListener,
      );
    };
  }, [updateOrder, nextIfComposing, setInputWrappers, setListVersion]);

  useEffect(() => {
    const onStart = (e: any) => {
      try {
        if (e?.detail?.id === 'room') {
          setAddInputActiveTab('stream');
          setStreamActiveTab('twitch');
          addVideoAccordionRef.current?.open();
        }
      } catch {}
    };
    window.addEventListener('smelter:tour:start', onStart);
    return () => window.removeEventListener('smelter:tour:start', onStart);
  }, [setAddInputActiveTab, setStreamActiveTab, addVideoAccordionRef]);

  useEffect(() => {
    const deletingRef = { current: false };
    const onTourStart = (_e: Event) => {
      try {
        if (deletingRef.current) return;
        const currentInputs = inputsRef.current || [];
        if (currentInputs.length <= 4) return;
        deletingRef.current = true;
        (async () => {
          try {
            const extras = currentInputs.slice(4);
            for (const input of extras) {
              const session = loadWhipSession();
              const isSavedInSession =
                (session &&
                  session.roomId === roomId &&
                  session.inputId === input.inputId) ||
                loadLastWhipInputId(roomId) === input.inputId;
              const isWhipCandidate =
                (input.inputId && input.inputId.indexOf('whip') > 0) ||
                isSavedInSession;
              if (isWhipCandidate) {
                try {
                  stopCameraAndConnection(cameraPcRef, cameraStreamRef);
                  stopCameraAndConnection(
                    screensharePcRef,
                    screenshareStreamRef,
                  );
                } catch {}
                try {
                  clearWhipSessionFor(roomId, input.inputId);
                } catch {}
                if (activeCameraInputId === input.inputId) {
                  setActiveCameraInputId(null);
                  setIsCameraActive(false);
                }
                if (activeScreenshareInputId === input.inputId) {
                  setActiveScreenshareInputId(null);
                  setIsScreenshareActive(false);
                }
              }
              try {
                await removeInput(roomId, input.inputId);
              } catch (err) {
                console.warn('Failed to remove extra input during tour start', {
                  inputId: input.inputId,
                  err,
                });
              }
            }
          } finally {
            await handleRefreshState();
            deletingRef.current = false;
          }
        })();
      } catch {}
    };
    window.addEventListener('smelter:tour:start', onTourStart);
    return () => {
      window.removeEventListener('smelter:tour:start', onTourStart);
    };
  }, [
    roomId,
    handleRefreshState,
    inputsRef,
    cameraPcRef,
    cameraStreamRef,
    screensharePcRef,
    screenshareStreamRef,
    activeCameraInputId,
    activeScreenshareInputId,
    setActiveCameraInputId,
    setIsCameraActive,
    setActiveScreenshareInputId,
    setIsScreenshareActive,
    setOpenFxInputId,
  ]);
}
