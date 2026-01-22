import { useEffect, useRef, useState } from 'react';
import type { Input } from '@/app/actions/actions';
import { useAutoResume } from '../whip-input/hooks/use-auto-resume';
import { useWhipHeartbeat } from '../whip-input/hooks/use-whip-heartbeat';
import { stopCameraAndConnection } from '../whip-input/utils/preview';
import {
  loadWhipSession,
  loadLastWhipInputId,
  clearWhipSession,
  clearLastWhipInputId,
} from '../whip-input/utils/whip-storage';

export function useWhipConnections(
  roomId: string,
  userName: string,
  inputs: Input[],
  inputsRef: React.MutableRefObject<Input[]>,
  handleRefreshState: () => Promise<void>,
) {
  const cameraPcRef = useRef<RTCPeerConnection | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const [activeCameraInputId, setActiveCameraInputId] = useState<string | null>(
    () => {
      const session = loadWhipSession();
      return session?.roomId === roomId ? session.inputId : null;
    },
  );
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);

  const screensharePcRef = useRef<RTCPeerConnection | null>(null);
  const screenshareStreamRef = useRef<MediaStream | null>(null);
  const [activeScreenshareInputId, setActiveScreenshareInputId] = useState<
    string | null
  >(null);
  const [isScreenshareActive, setIsScreenshareActive] =
    useState<boolean>(false);

  useAutoResume(
    roomId,
    userName,
    cameraPcRef,
    cameraStreamRef,
    inputs,
    handleRefreshState,
    setActiveCameraInputId,
    setIsCameraActive,
  );
  useWhipHeartbeat(roomId, activeCameraInputId, isCameraActive);
  useWhipHeartbeat(roomId, activeScreenshareInputId, isScreenshareActive);

  useEffect(() => {
    if (!activeCameraInputId) return;
    const stillExists = inputs.some((i) => i.inputId === activeCameraInputId);
    if (stillExists) return;

    const timeout = setTimeout(() => {
      const existsNow = inputsRef.current.some(
        (i) => i.inputId === activeCameraInputId,
      );
      if (existsNow) return;
      try {
        stopCameraAndConnection(cameraPcRef, cameraStreamRef);
        setIsCameraActive(false);
        const s = loadWhipSession();
        if (s && s.roomId === roomId && s.inputId === activeCameraInputId) {
          clearWhipSession(roomId);
        }
        const lastId = loadLastWhipInputId(roomId);
        if (lastId === activeCameraInputId) clearLastWhipInputId(roomId);
      } finally {
        setActiveCameraInputId(null);
      }
    }, 10000);

    return () => clearTimeout(timeout);
  }, [inputs, activeCameraInputId, roomId, inputsRef]);

  useEffect(() => {
    if (!activeScreenshareInputId) return;
    const stillExists = inputs.some(
      (i) => i.inputId === activeScreenshareInputId,
    );
    if (stillExists) return;

    const timeout = setTimeout(() => {
      const existsNow = inputsRef.current.some(
        (i) => i.inputId === activeScreenshareInputId,
      );
      if (existsNow) return;
      try {
        stopCameraAndConnection(screensharePcRef, screenshareStreamRef);
        setIsScreenshareActive(false);
      } finally {
        setActiveScreenshareInputId(null);
      }
    }, 10000);

    return () => clearTimeout(timeout);
  }, [inputs, activeScreenshareInputId, inputsRef]);

  useEffect(() => {
    const onUnload = () => {
      stopCameraAndConnection(cameraPcRef, cameraStreamRef);
      stopCameraAndConnection(screensharePcRef, screenshareStreamRef);
    };
    window.addEventListener('beforeunload', onUnload);
    window.addEventListener('pagehide', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      window.removeEventListener('pagehide', onUnload);
    };
  }, []);

  useEffect(() => {
    return () => {
      stopCameraAndConnection(cameraPcRef, cameraStreamRef);
      stopCameraAndConnection(screensharePcRef, screenshareStreamRef);
      setIsCameraActive(false);
      setIsScreenshareActive(false);
    };
  }, []);

  useEffect(() => {
    const pc = cameraPcRef.current;
    if (!pc) return;

    const handleConnectionStateChange = () => {
      const state = pc.connectionState;

      if (state === 'connected') {
        setIsCameraActive(true);
      } else if (
        state === 'failed' ||
        state === 'disconnected' ||
        state === 'closed'
      ) {
        setIsCameraActive(false);
      }
    };

    pc.addEventListener('connectionstatechange', handleConnectionStateChange);

    handleConnectionStateChange();

    return () => {
      pc.removeEventListener(
        'connectionstatechange',
        handleConnectionStateChange,
      );
    };
  }, [cameraPcRef]);

  useEffect(() => {
    const pc = screensharePcRef.current;
    if (!pc) return;

    const handleConnectionStateChange = () => {
      const state = pc.connectionState;

      if (state === 'connected') {
        setIsScreenshareActive(true);
      } else if (
        state === 'failed' ||
        state === 'disconnected' ||
        state === 'closed'
      ) {
        setIsScreenshareActive(false);
      }
    };

    pc.addEventListener('connectionstatechange', handleConnectionStateChange);

    handleConnectionStateChange();

    return () => {
      pc.removeEventListener(
        'connectionstatechange',
        handleConnectionStateChange,
      );
    };
  }, [screensharePcRef]);

  return {
    cameraPcRef,
    cameraStreamRef,
    activeCameraInputId,
    setActiveCameraInputId,
    isCameraActive,
    setIsCameraActive,
    screensharePcRef,
    screenshareStreamRef,
    activeScreenshareInputId,
    setActiveScreenshareInputId,
    isScreenshareActive,
    setIsScreenshareActive,
  };
}
