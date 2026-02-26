'use client';

import { createContext, useContext } from 'react';
import type { Input, AvailableShader } from '@/app/actions/actions';

type ControlPanelContextValue = {
  roomId: string;
  refreshState: () => Promise<void>;
  inputs: Input[];
  inputsRef: React.MutableRefObject<Input[]>;
  availableShaders: AvailableShader[];
};

const ControlPanelContext = createContext<ControlPanelContextValue | null>(
  null,
);

export function ControlPanelProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: ControlPanelContextValue;
}) {
  return (
    <ControlPanelContext.Provider value={value}>
      {children}
    </ControlPanelContext.Provider>
  );
}

export function useControlPanelContext() {
  const ctx = useContext(ControlPanelContext);
  if (!ctx) {
    throw new Error(
      'useControlPanelContext must be used within a ControlPanelProvider',
    );
  }
  return ctx;
}
