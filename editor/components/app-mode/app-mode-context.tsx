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
  getStoredAdminMode,
  setStoredAppMode,
  setStoredAdminMode,
} from '@/lib/app-mode';

interface AppModeContextValue {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  toggleMode: () => void;
  adminMode: boolean;
  toggleAdminMode: () => void;
}

const AppModeContext = createContext<AppModeContextValue | null>(null);

export function AppModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<AppMode>(DEFAULT_APP_MODE);
  const [adminMode, setAdminModeState] = useState<boolean>(false);

  useEffect(() => {
    const stored = getStoredAppMode();
    setModeState(stored);
    setStoredAppMode(stored);
    setAdminModeState(getStoredAdminMode());
  }, []);

  const setMode = useCallback((next: AppMode) => {
    setStoredAppMode(next);
    window.location.reload();
  }, []);

  const toggleMode = useCallback(() => {
    const next: AppMode = getStoredAppMode() === 'demo' ? 'geek' : 'demo';
    setStoredAppMode(next);
    window.location.reload();
  }, []);

  const toggleAdminMode = useCallback(() => {
    const next = !getStoredAdminMode();
    setStoredAdminMode(next);
    window.location.reload();
  }, []);

  const value = useMemo<AppModeContextValue>(
    () => ({ mode, setMode, toggleMode, adminMode, toggleAdminMode }),
    [mode, setMode, toggleMode, adminMode, toggleAdminMode],
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
