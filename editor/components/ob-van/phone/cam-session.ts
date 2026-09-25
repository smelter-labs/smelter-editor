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

export function clearCamSession(roomId: string): void {
  try {
    window.localStorage.removeItem(camSessionKey(roomId));
  } catch {
    // Storage blocked — nothing to clear.
  }
}
