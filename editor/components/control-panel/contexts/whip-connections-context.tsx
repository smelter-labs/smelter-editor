'use client';

import { createContext, useContext } from 'react';

type WhipConnectionsContextValue = {
  cameraPcRef: React.MutableRefObject<RTCPeerConnection | null>;
  cameraStreamRef: React.MutableRefObject<MediaStream | null>;
  activeCameraInputId: string | null;
  setActiveCameraInputId: (id: string | null) => void;
  isCameraActive: boolean;
  setIsCameraActive: (active: boolean) => void;
  screensharePcRef: React.MutableRefObject<RTCPeerConnection | null>;
  screenshareStreamRef: React.MutableRefObject<MediaStream | null>;
  activeScreenshareInputId: string | null;
  setActiveScreenshareInputId: (id: string | null) => void;
  isScreenshareActive: boolean;
  setIsScreenshareActive: (active: boolean) => void;
};

const WhipConnectionsContext =
  createContext<WhipConnectionsContextValue | null>(null);

export function WhipConnectionsProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: WhipConnectionsContextValue;
}) {
  return (
    <WhipConnectionsContext.Provider value={value}>
      {children}
    </WhipConnectionsContext.Provider>
  );
}

export function useWhipConnectionsContext() {
  const ctx = useContext(WhipConnectionsContext);
  if (!ctx) {
    throw new Error(
      'useWhipConnectionsContext must be used within a WhipConnectionsProvider',
    );
  }
  return ctx;
}
