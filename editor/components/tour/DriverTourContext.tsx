// DriverTourContext.tsx
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import type { DriveStep } from 'driver.js';
import { useDriverTour, type DriverTourApi } from './useDriverTour';

type DriverTourEntry = DriverTourApi;

type DriverTourRegistry = {
  register: (id: string, entry: DriverTourEntry) => void;
  unregister: (id: string) => void;
  get: (id: string) => DriverTourEntry | undefined;
};

const DriverTourRegistryContext = createContext<DriverTourRegistry | null>(
  null,
);

type DriverToursProviderProps = {
  children: ReactNode;
};

export function DriverToursProvider({ children }: DriverToursProviderProps) {
  const entriesRef = useRef<Map<string, DriverTourEntry>>(new Map());

  const registry = useMemo<DriverTourRegistry>(() => {
    return {
      register: (id, entry) => {
        entriesRef.current.set(id, entry);
      },
      unregister: (id) => {
        entriesRef.current.delete(id);
      },
      get: (id) => entriesRef.current.get(id),
    };
  }, []);

  return (
    <DriverTourRegistryContext.Provider value={registry}>
      {children}
    </DriverTourRegistryContext.Provider>
  );
}

type DriverTourProviderProps = {
  id: string;
  steps: DriveStep[];
  options?: Parameters<typeof useDriverTour>[2];
  children: ReactNode;
};

export function DriverTourProvider({
  id,
  steps,
  options,
  children,
}: DriverTourProviderProps) {
  const api = useDriverTour(id, steps, options);
  const registry = useContext(DriverTourRegistryContext);

  if (!registry) {
    throw new Error(
      'DriverTourProvider must be used within <DriverToursProvider>',
    );
  }

  useEffect(() => {
    const entry: DriverTourEntry = {
      ...api,
    };
    registry.register(id, entry);
    return () => {
      registry.unregister(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, api.instance]);

  return <>{children}</>;
}

export function useDriverTourControls(id: string): DriverTourEntry {
  const registry = useContext(DriverTourRegistryContext);
  if (!registry) {
    throw new Error(
      'useDriverTourControls must be used within <DriverToursProvider>',
    );
  }
  const entry = registry.get(id);
  if (entry) return entry;
  const noop = () => {};
  return {
    start: noop,
    reset: noop,
    stop: noop,
    forceStop: noop,
    highlight: noop as unknown as DriverTourEntry['highlight'],
    next: noop,
    prev: noop,
    moveTo: noop as unknown as DriverTourEntry['moveTo'],
    nextIf: noop as unknown as DriverTourEntry['nextIf'],
    prevIf: noop as unknown as DriverTourEntry['prevIf'],
    instance: null,
  };
}
