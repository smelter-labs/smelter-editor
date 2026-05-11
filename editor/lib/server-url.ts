const SERVER_URL_STORAGE_KEY = 'smelter-server-url';
export const SERVER_URL_COOKIE_NAME = 'smelter-server-url';
const DEFAULT_SERVER_URL = 'http://localhost:3001';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

type ServerPreset = {
  id: string;
  label: string;
  url: string;
};

export const SERVER_PRESETS: ServerPreset[] = [
  { id: 'localhost', label: 'Localhost', url: 'http://localhost:3001' },
  {
    id: 'instance-a-prod',
    label: 'Instance A Prod',
    url: 'https://puffer.fishjam.io/smelter-editor-api',
  },
  {
    id: 'instance-b-dev',
    label: 'Instance B Dev',
    url: 'https://puffer.fishjam.io/smelter-editor-b-api',
  },
  { id: 'custom', label: 'Custom', url: '' },
];

function normalizeServerUrl(url: string): string {
  return url.replace(/\/$/, '');
}

export function getDefaultServerUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_SMELTER_SERVER_URL;
  if (!envUrl) {
    return DEFAULT_SERVER_URL;
  }
  return normalizeServerUrl(envUrl);
}

function getStoredServerUrl(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const value = localStorage.getItem(SERVER_URL_STORAGE_KEY)?.trim();
  if (!value) {
    return null;
  }
  return normalizeServerUrl(value);
}

export function setStoredServerUrl(url: string | null): void {
  if (typeof window === 'undefined') {
    return;
  }

  const trimmed = url?.trim() ?? '';
  if (!trimmed) {
    localStorage.removeItem(SERVER_URL_STORAGE_KEY);
    document.cookie = `${SERVER_URL_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
    return;
  }

  const normalized = normalizeServerUrl(trimmed);
  localStorage.setItem(SERVER_URL_STORAGE_KEY, normalized);
  document.cookie = `${SERVER_URL_COOKIE_NAME}=${encodeURIComponent(normalized)}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}

export function getEffectiveClientServerUrl(): string {
  return getStoredServerUrl() ?? getDefaultServerUrl();
}

export function toWsUrl(httpUrl: string): string {
  return normalizeServerUrl(httpUrl).replace(/^http/, 'ws');
}
