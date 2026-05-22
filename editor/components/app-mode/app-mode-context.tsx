'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  AppMode,
  DEFAULT_APP_MODE,
  getStoredAppMode,
  setStoredAppMode,
} from '@/lib/app-mode';

interface AppModeContextValue {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  toggleMode: () => void;
}

const AppModeContext = createContext<AppModeContextValue | null>(null);

export function AppModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<AppMode>(DEFAULT_APP_MODE);

  useEffect(() => {
    setModeState(getStoredAppMode());
  }, []);

  const setMode = useCallback((next: AppMode) => {
    setModeState(next);
    setStoredAppMode(next);
  }, []);

  const toggleMode = useCallback(() => {
    setModeState((prev) => {
      const next: AppMode = prev === 'demo' ? 'geek' : 'demo';
      setStoredAppMode(next);
      return next;
    });
  }, []);

  const value = useMemo<AppModeContextValue>(
    () => ({ mode, setMode, toggleMode }),
    [mode, setMode, toggleMode],
  );

  return (
    <AppModeContext.Provider value={value}>{children}</AppModeContext.Provider>
  );
}

export function useAppMode(): AppModeContextValue {
  const ctx = useContext(AppModeContext);
  if (!ctx) {
    throw new Error('useAppMode must be used within an AppModeProvider');
  }
  return ctx;
}
