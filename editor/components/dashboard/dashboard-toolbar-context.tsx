'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import type {
  LayoutPreset,
  PanelDefinition,
  MutableLayout,
} from './panel-registry';
import type { DashboardLayoutSavedData } from './dashboard-layout';
import type { StorageClient } from '@/lib/storage-client';

export interface DashboardToolbarActions {
  isEditMode: boolean;
  toggleEditMode: () => void;
  presets: readonly LayoutPreset[];
  applyPreset: (layout: MutableLayout) => void;
  reset: () => void;
  allPanelIds: string[];
  visiblePanels: Set<string>;
  togglePanel: (panelId: string) => void;
  getPanelDefinition: (id: string) => PanelDefinition;
  dashboardLayoutStorage: StorageClient<object>;
  getCurrentLayoutData: () => DashboardLayoutSavedData;
  applyLoadedLayout: (data: DashboardLayoutSavedData) => void;
}

type ContextValue = {
  actions: DashboardToolbarActions | null;
  register: (actions: DashboardToolbarActions) => void;
  unregister: () => void;
};

const DashboardToolbarContext = createContext<ContextValue>({
  actions: null,
  register: () => {},
  unregister: () => {},
});

export function DashboardToolbarProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [actions, setActions] = useState<DashboardToolbarActions | null>(null);
  const register = useCallback(
    (a: DashboardToolbarActions) => setActions(a),
    [],
  );
  const unregister = useCallback(() => setActions(null), []);

  return (
    <DashboardToolbarContext.Provider value={{ actions, register, unregister }}>
      {children}
    </DashboardToolbarContext.Provider>
  );
}

export function useDashboardToolbar() {
  return useContext(DashboardToolbarContext).actions;
}

export function useDashboardToolbarRegister() {
  const { register, unregister } = useContext(DashboardToolbarContext);
  return { register, unregister };
}
