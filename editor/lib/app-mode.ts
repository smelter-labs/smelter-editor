export type AppMode = 'demo' | 'geek';

export const APP_MODES: AppMode[] = ['demo', 'geek'];
export const DEFAULT_APP_MODE: AppMode = 'demo';

const APP_MODE_STORAGE_KEY = 'smelter-app-mode';

export const DEMO_MODE_HIDDEN_PANELS: ReadonlySet<string> = new Set([
  'timeline',
  'system-log',
  'fx',
  'pending-connections',
  'layout-preview',
]);

function isAppMode(value: unknown): value is AppMode {
  return value === 'demo' || value === 'geek';
}

export function getStoredAppMode(): AppMode {
  if (typeof window === 'undefined') return DEFAULT_APP_MODE;
  try {
    const value = localStorage.getItem(APP_MODE_STORAGE_KEY);
    return isAppMode(value) ? value : DEFAULT_APP_MODE;
  } catch {
    return DEFAULT_APP_MODE;
  }
}

export function setStoredAppMode(mode: AppMode): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(APP_MODE_STORAGE_KEY, mode);
  } catch {
    // localStorage full or unavailable
  }
}

export function isPanelHiddenInMode(panelId: string, mode: AppMode): boolean {
  return mode === 'demo' && DEMO_MODE_HIDDEN_PANELS.has(panelId);
}
