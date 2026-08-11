import { getStoredAppMode } from './app-mode';

const SERVER_URL_STORAGE_KEY = 'smelter-server-url';
export const SERVER_URL_COOKIE_NAME = 'smelter-server-url';
/** Query key for deep links (e.g. `/mobile/[roomId]?server=...`) to pre-select API URL */
export const SERVER_URL_QUERY_PARAM = 'server';
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
    url: 'https://puffer.fishjam.io/smelter-editor-production-api',
  },
  {
    id: 'instance-b-dev',
    label: 'Instance B Dev',
    url: 'https://puffer.fishjam.io/smelter-editor-dev-api',
  },
  { id: 'custom', label: 'Custom', url: '' },
];

function normalizeServerUrl(url: string): string {
  return url.replace(/\/$/, '');
}

export function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

/**
 * When the editor is opened via a LAN IP (e.g. http://192.168.1.5:3000), rewrite
 * loopback URLs so the phone/tablet reaches the dev machine instead of itself.
 * Preserves the original port (API :3001, WHEP :9072, etc.).
 */
export function rewriteLoopbackUrlForClient(
  url: string,
  preferredBaseUrl?: string,
): string {
  if (typeof window === 'undefined') {
    return url;
  }

  try {
    const parsed = new URL(url);
    if (!isLoopbackHost(parsed.hostname)) {
      return normalizeServerUrl(url);
    }

    const baseHost = preferredBaseUrl
      ? new URL(preferredBaseUrl).hostname
      : window.location.hostname;

    if (isLoopbackHost(baseHost)) {
      return normalizeServerUrl(url);
    }

    parsed.hostname = baseHost;
    return normalizeServerUrl(parsed.toString());
  } catch {
    return url;
  }
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

export function isAllowedApiServerUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return false;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (u.username || u.password) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * If `encoded` is a valid http(s) API base URL, persist it (localStorage + cookie)
 * so server actions and the rest of the editor use this backend.
 */
export function applyServerUrlFromQueryParam(encoded: string | null): boolean {
  if (typeof window === 'undefined' || !encoded?.trim()) {
    return false;
  }
  try {
    const decoded = decodeURIComponent(encoded.trim());
    if (!isAllowedApiServerUrl(decoded)) return false;
    setStoredServerUrl(decoded);
    return true;
  } catch {
    return false;
  }
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

<<<<<<< Updated upstream
=======
<<<<<<< Updated upstream
=======
>>>>>>> Stashed changes
/**
 * The server URL the user picked explicitly (via `?server=` deep link or the
 * server selector) — or null when unset or a loopback address. Callers use it
 * to override same-origin heuristics: a page served from a static host (e.g.
 * the Vercel deploy) can still be told to talk to a public API elsewhere.
 */
export function getStoredClientServerUrl(): string | null {
<<<<<<< Updated upstream
  if (getStoredAppMode() === 'demo') {
    return null;
  }
=======
  // Deliberately NOT gated on demo mode: phones scanning a workshop QR run in
  // the default demo mode, and the `?server=` baked into that QR is the only
  // way they can reach the right backend from a static (Vercel) deploy.
>>>>>>> Stashed changes
  const stored = getStoredServerUrl();
  if (!stored) {
    return null;
  }
  try {
    if (isLoopbackHost(new URL(stored).hostname)) {
      return null;
    }
  } catch {
    return null;
  }
  return stored;
}

<<<<<<< Updated upstream
=======
/**
 * The build-time default server URL when it is reachable from another device
 * (non-loopback) — e.g. the public API baked into the Vercel deploy. Null in
 * local dev, where the loopback default is unreachable from a phone and
 * same-origin/tunnel heuristics should apply instead.
 */
export function getPublicDefaultServerUrl(): string | null {
  const url = getDefaultServerUrl();
  try {
    return isLoopbackHost(new URL(url).hostname) ? null : url;
  } catch {
    return null;
  }
}

>>>>>>> Stashed changes
>>>>>>> Stashed changes
export function getEffectiveClientServerUrl(): string {
  const raw =
    getStoredAppMode() === 'demo'
      ? getDefaultServerUrl()
      : (getStoredServerUrl() ?? getDefaultServerUrl());
  return rewriteLoopbackUrlForClient(raw);
}

export function toWsUrl(httpUrl: string): string {
  return normalizeServerUrl(httpUrl).replace(/^http/, 'ws');
}
