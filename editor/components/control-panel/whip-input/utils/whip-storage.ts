import type { WhipSession } from './types';

const WHIP_SESSION_KEY = 'whip-session-v1';
const lastIdKey = (roomId: string) => `whip-last-input-id:${roomId}`;
const userNameKey = (roomId: string) => `whip-username:${roomId}`;
const autoResumeLockKey = (roomId: string) => `whip-auto-resume-lock:${roomId}`;

const getSafeSessionStorage = (): Storage | null => {
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
};

export function saveWhipSession(s: WhipSession) {
  try {
    getSafeSessionStorage()?.setItem(WHIP_SESSION_KEY, JSON.stringify(s));
  } catch {}
}
export function loadWhipSession(): WhipSession | null {
  try {
    const raw = getSafeSessionStorage()?.getItem(WHIP_SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as WhipSession;
    if (!s.inputId || !s.bearerToken || !s.roomId) return null;
    if (Date.now() - s.ts > 24 * 60 * 60 * 1000) return null;
    return s;
  } catch {
    return null;
  }
}
export function clearWhipSession(roomId: string) {
  try {
    window.sessionStorage.removeItem(lastIdKey(roomId));
    getSafeSessionStorage()?.removeItem(WHIP_SESSION_KEY);
  } catch {}
}

export function saveLastWhipInputId(roomId: string, inputId: string) {
  try {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(lastIdKey(roomId), inputId);
  } catch {}
}
export function loadLastWhipInputId(roomId: string): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage.getItem(lastIdKey(roomId));
  } catch {
    return null;
  }
}

export function clearLastWhipInputId(roomId: string) {
  try {
    if (typeof window === 'undefined') return;
    window.sessionStorage.removeItem(lastIdKey(roomId));
  } catch {}
}

export function clearWhipSessionFor(roomId: string, inputId: string) {
  try {
    window.sessionStorage.removeItem(userNameKey(roomId));
    const s = loadWhipSession();
    if (s && s.roomId === roomId && s.inputId === inputId) {
      clearWhipSession(roomId);
    }
    const lastId = loadLastWhipInputId(roomId);
    if (lastId === inputId) {
      clearLastWhipInputId(roomId);
    }
  } catch {}
}

export function loadUserName(roomId: string): string {
  try {
    if (typeof window === 'undefined') return '';
    return window.sessionStorage.getItem(userNameKey(roomId)) || '';
  } catch {
    return '';
  }
}
export function saveUserName(roomId: string, name: string) {
  try {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(userNameKey(roomId), name);
  } catch {}
}

export function tryAcquireAutoResumeLock(roomId: string): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const key = autoResumeLockKey(roomId);
    if (sessionStorage.getItem(key)) return true;
    sessionStorage.setItem(key, '1');
    return true;
  } catch {
    return true; // allow once if sessionStorage unavailable
  }
}
