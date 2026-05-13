import type { GuestCameraSettings, ResolutionPreset } from './camera-setup';

const KEY = 'smelter-guest-camera-settings-v1';

const RESOLUTIONS: ResolutionPreset[] = ['480p', '720p', '1080p'];

function isValidSettings(value: unknown): value is GuestCameraSettings {
  if (!value || typeof value !== 'object') return false;
  const s = value as Partial<GuestCameraSettings>;
  if (s.facingMode !== 'user' && s.facingMode !== 'environment') return false;
  if (s.orientation !== 'portrait' && s.orientation !== 'landscape')
    return false;
  if (!s.resolution || !RESOLUTIONS.includes(s.resolution)) return false;
  if (typeof s.mirror !== 'boolean') return false;
  if (s.deviceId !== undefined && typeof s.deviceId !== 'string') return false;
  return true;
}

export function loadGuestCameraSettings(): GuestCameraSettings | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidSettings(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveGuestCameraSettings(settings: GuestCameraSettings): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
}
