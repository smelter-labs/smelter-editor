import { isObCamRole, type ObCamRole } from '@smelter-editor/types';
import { toRole } from '@/lib/ob-van/roles';

/**
 * Per-room camera-phone resume session (localStorage). Carrying the camKey
 * lets a refresh or a socket reconnect adopt the same camera seat (same
 * number, same tally) instead of taking a new one; `wantsCam` re-arms the
 * publish after a refresh.
 */
export type CamSession = {
  camKey?: string;
  name?: string;
  role?: ObCamRole;
  talent?: string;
  facing?: 'user' | 'environment';
  wantsCam?: boolean;
};

export const camSessionKey = (roomId: string): string => `ob-cam-${roomId}`;

/**
 * Device-wide "last used" seat settings (localStorage, shared across rooms).
 * A new event means a new roomId, so the per-room session starts empty; the
 * prefs prefill the seat form with whatever this phone used last time. The
 * per-room session always wins over prefs on restore.
 */
export type CamPrefs = Pick<CamSession, 'name' | 'role' | 'talent' | 'facing'>;

export const CAM_PREFS_KEY = 'ob-cam-last';

function toCamPrefs(session: CamSession): CamPrefs {
  const out: CamPrefs = {};
  if (session.name) out.name = session.name;
  if (session.role) out.role = session.role;
  if (session.talent) out.talent = session.talent;
  if (session.facing) out.facing = session.facing;
  return out;
}

/** Keep only well-typed fields; anything else in storage is dropped. */
function parseCamSession(raw: unknown): CamSession {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const out: CamSession = {};
  if (typeof obj.camKey === 'string' && obj.camKey) out.camKey = obj.camKey;
  if (typeof obj.name === 'string') out.name = obj.name;
  if (isObCamRole(obj.role)) out.role = toRole(obj.role);
  if (typeof obj.talent === 'string') out.talent = obj.talent;
  if (obj.facing === 'user' || obj.facing === 'environment') {
    out.facing = obj.facing;
  }
  if (typeof obj.wantsCam === 'boolean') out.wantsCam = obj.wantsCam;
  return out;
}

export function readCamSession(roomId: string): CamSession {
  try {
    const raw = window.localStorage.getItem(camSessionKey(roomId));
    return raw ? parseCamSession(JSON.parse(raw) as unknown) : {};
  } catch {
    return {};
  }
}

/** Merge `patch` into the stored session; returns the merged session. */
export function writeCamSession(
  roomId: string,
  patch: Partial<CamSession>,
): CamSession {
  const merged = parseCamSession({ ...readCamSession(roomId), ...patch });
  try {
    window.localStorage.setItem(camSessionKey(roomId), JSON.stringify(merged));
  } catch {
    // Storage blocked — resume just won't survive the next refresh.
  }
  return merged;
}

export function readCamPrefs(): CamPrefs {
  try {
    const raw = window.localStorage.getItem(CAM_PREFS_KEY);
    return raw ? toCamPrefs(parseCamSession(JSON.parse(raw) as unknown)) : {};
  } catch {
    return {};
  }
}

/** Merge `patch` into the device-wide prefs; returns the merged prefs. */
export function writeCamPrefs(patch: Partial<CamPrefs>): CamPrefs {
  const merged = toCamPrefs(parseCamSession({ ...readCamPrefs(), ...patch }));
  try {
    window.localStorage.setItem(CAM_PREFS_KEY, JSON.stringify(merged));
  } catch {
    // Storage blocked — the next event just starts with an empty form.
  }
  return merged;
}

export function clearCamSession(roomId: string): void {
  try {
    window.localStorage.removeItem(camSessionKey(roomId));
  } catch {
    // Storage blocked — nothing to clear.
  }
}
