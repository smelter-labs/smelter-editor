import type { BbCamRole, BbRim } from '@smelter-editor/types';

/**
 * Per-room resume session for a camera phone: the server-issued camKey
 * re-adopts the role after a refresh, the rest re-arms the camera without a
 * tap (a recorded-file source cannot survive a refresh — it is asked for
 * again).
 */
export type CamSession = {
  camKey?: string;
  role?: BbCamRole;
  name?: string;
  wantsCam?: boolean;
  usedFile?: boolean;
  rim?: BbRim | null;
};

export const camSessionKey = (roomId: string) => `bb-cam-${roomId}`;

export function readCamSession(roomId: string): CamSession {
  try {
    const raw = window.localStorage.getItem(camSessionKey(roomId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as CamSession) : {};
  } catch {
    return {};
  }
}

export function writeCamSession(roomId: string, session: CamSession): void {
  try {
    window.localStorage.setItem(camSessionKey(roomId), JSON.stringify(session));
  } catch {
    /* storage blocked — resume just won't survive the next refresh */
  }
}
