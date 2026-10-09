import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAM_PREFS_KEY,
  camSessionKey,
  clearCamSession,
  readCamPrefs,
  readCamSession,
  writeCamPrefs,
  writeCamSession,
} from '../phone/cam-session';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, String(v));
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}

let storage: ReturnType<typeof memoryStorage>;

beforeEach(() => {
  storage = memoryStorage();
  vi.stubGlobal('window', { localStorage: storage });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cam-session', () => {
  it('keys the session per room', () => {
    expect(camSessionKey('abc')).toBe('ob-cam-abc');
  });

  it('round-trips a full session', () => {
    const session = {
      camKey: 'k-1',
      name: 'Ola',
      role: 'custom:Drone' as const,
      talent: 'Dr. Smith',
      facing: 'user' as const,
      wantsCam: true,
    };
    expect(writeCamSession('r1', session)).toEqual(session);
    expect(readCamSession('r1')).toEqual(session);
    expect(readCamSession('r2')).toEqual({});
  });

  it('merges patches into the stored session', () => {
    writeCamSession('r1', { name: 'Ola', role: 'speaker' });
    const merged = writeCamSession('r1', { camKey: 'k-2', wantsCam: false });
    expect(merged).toEqual({
      name: 'Ola',
      role: 'speaker',
      camKey: 'k-2',
      wantsCam: false,
    });
    expect(readCamSession('r1')).toEqual(merged);
  });

  it('drops a field patched to undefined', () => {
    writeCamSession('r1', { camKey: 'k-3', name: 'Ola' });
    expect(writeCamSession('r1', { camKey: undefined })).toEqual({
      name: 'Ola',
    });
  });

  it('reads garbage as an empty session', () => {
    storage.data.set(camSessionKey('r1'), '{not json');
    expect(readCamSession('r1')).toEqual({});
    storage.data.set(camSessionKey('r1'), '[1,2]');
    expect(readCamSession('r1')).toEqual({});
    storage.data.set(camSessionKey('r1'), '"text"');
    expect(readCamSession('r1')).toEqual({});
    storage.data.set(camSessionKey('r1'), 'null');
    expect(readCamSession('r1')).toEqual({});
  });

  it('drops badly typed fields and unknown roles', () => {
    storage.data.set(
      camSessionKey('r1'),
      JSON.stringify({
        camKey: 42,
        name: 'Ola',
        role: 'director',
        talent: ['x'],
        facing: 'sideways',
        wantsCam: 'yes',
        extra: 1,
      }),
    );
    expect(readCamSession('r1')).toEqual({ name: 'Ola' });
    storage.data.set(
      camSessionKey('r1'),
      JSON.stringify({ role: 'custom:bad/name!' }),
    );
    expect(readCamSession('r1')).toEqual({});
  });

  it('clears the session', () => {
    writeCamSession('r1', { camKey: 'k' });
    clearCamSession('r1');
    expect(readCamSession('r1')).toEqual({});
    expect(storage.data.has(camSessionKey('r1'))).toBe(false);
  });

  it('keeps device prefs separate from room sessions', () => {
    writeCamPrefs({ name: 'Ola', role: 'speaker', facing: 'user' });
    expect(readCamPrefs()).toEqual({
      name: 'Ola',
      role: 'speaker',
      facing: 'user',
    });
    expect(readCamSession('r1')).toEqual({});
    clearCamSession('r1');
    expect(readCamPrefs()).toEqual({
      name: 'Ola',
      role: 'speaker',
      facing: 'user',
    });
  });

  it('merges pref patches and clears fields patched to undefined', () => {
    writeCamPrefs({ name: 'Ola', talent: 'Dr. Smith' });
    expect(writeCamPrefs({ talent: undefined, facing: 'environment' })).toEqual(
      { name: 'Ola', facing: 'environment' },
    );
    expect(readCamPrefs()).toEqual({ name: 'Ola', facing: 'environment' });
  });

  it('never stores camKey or wantsCam in prefs', () => {
    storage.data.set(
      CAM_PREFS_KEY,
      JSON.stringify({ name: 'Ola', camKey: 'k-1', wantsCam: true }),
    );
    expect(readCamPrefs()).toEqual({ name: 'Ola' });
    writeCamPrefs({ role: 'wide' });
    expect(JSON.parse(storage.data.get(CAM_PREFS_KEY) ?? '{}')).toEqual({
      name: 'Ola',
      role: 'wide',
    });
  });

  it('reads garbage prefs as empty', () => {
    storage.data.set(CAM_PREFS_KEY, '{not json');
    expect(readCamPrefs()).toEqual({});
  });

  it('survives blocked storage', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
        removeItem: () => {
          throw new Error('blocked');
        },
      },
    });
    expect(readCamSession('r1')).toEqual({});
    expect(writeCamSession('r1', { name: 'Ola' })).toEqual({ name: 'Ola' });
    expect(readCamPrefs()).toEqual({});
    expect(writeCamPrefs({ name: 'Ola' })).toEqual({ name: 'Ola' });
    expect(() => clearCamSession('r1')).not.toThrow();
  });
});
