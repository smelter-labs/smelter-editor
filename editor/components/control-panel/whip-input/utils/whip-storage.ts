import type { WhipSession } from './types';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const LOCK_TTL_MS = 60_000;

const sessionKey = (roomId: string) => `whip-session-v2:${roomId}`;
const lastIdKey = (roomId: string) => `whip-last-input-id:${roomId}`;
const userNameKey = (roomId: string) => `whip-username:${roomId}`;
const autoResumeLockKey = (roomId: string) =>
  `whip-auto-resume-lock-v2:${roomId}`;

const getSafeLocalStorage = (): Storage | null => {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
};

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
    getSafeLocalStorage()?.setItem(sessionKey(s.roomId), JSON.stringify(s));
  } catch {}
}

export function loadWhipSession(roomId: string): WhipSession | null {
  try {
    const raw = getSafeLocalStorage()?.getItem(sessionKey(roomId));
    if (!raw) return null;
    const s = JSON.parse(raw) as WhipSession;
    if (!s.inputId || !s.bearerToken || s.roomId !== roomId) return null;
    if (Date.now() - s.ts > SESSION_TTL_MS) {
      clearWhipSession(roomId);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function clearWhipSession(roomId: string) {
  try {
    const ls = getSafeLocalStorage();
    ls?.removeItem(sessionKey(roomId));
    ls?.removeItem(lastIdKey(roomId));
  } catch {}
}

export function saveLastWhipInputId(roomId: string, inputId: string) {
  try {
    getSafeLocalStorage()?.setItem(lastIdKey(roomId), inputId);
  } catch {}
}

export function loadLastWhipInputId(roomId: string): string | null {
  try {
    return getSafeLocalStorage()?.getItem(lastIdKey(roomId)) ?? null;
  } catch {
    return null;
  }
}

export function clearLastWhipInputId(roomId: string) {
  try {
    getSafeLocalStorage()?.removeItem(lastIdKey(roomId));
  } catch {}
}

export function clearWhipSessionFor(roomId: string, inputId: string) {
  try {
    getSafeLocalStorage()?.removeItem(userNameKey(roomId));
    const s = loadWhipSession(roomId);
    if (s && s.inputId === inputId) {
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
    return (
      window.localStorage.getItem(userNameKey(roomId)) ||
      window.sessionStorage.getItem(userNameKey(roomId)) ||
      ''
    );
  } catch {
    return '';
  }
}

export function saveUserName(roomId: string, name: string) {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(userNameKey(roomId), name);
  } catch {}
}

export function tryAcquireAutoResumeLock(roomId: string): boolean {
  try {
    const ss = getSafeSessionStorage();
    if (!ss) return true;
    const key = autoResumeLockKey(roomId);
    const existing = ss.getItem(key);
    if (existing) {
      const acquiredAt = Number.parseInt(existing, 10);
      if (
        Number.isFinite(acquiredAt) &&
        Date.now() - acquiredAt < LOCK_TTL_MS
      ) {
        return false;
      }
    }
    ss.setItem(key, String(Date.now()));
    return true;
  } catch {
    return true;
  }
}

export function releaseAutoResumeLock(roomId: string) {
  try {
    getSafeSessionStorage()?.removeItem(autoResumeLockKey(roomId));
  } catch {}
}
