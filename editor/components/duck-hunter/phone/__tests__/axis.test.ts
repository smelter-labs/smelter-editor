import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AXIS_CFG_KEY,
  DEFAULT_LANDSCAPE,
  DEFAULT_MOVE_SENS,
  DEFAULT_PORTRAIT,
  LEGACY_AXIS_CFG_KEY,
  MAX_MOVE_SENS,
  MAX_SENS,
  MIN_MOVE_SENS,
  loadAxisSettings,
  parseStoredAxisSettings,
  saveAxisSettings,
} from '../axis';

function createLocalStorageMock() {
  const store = new Map<string, string>();

  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
  };
}

const legacyBlob = JSON.stringify({
  horiz: { source: 'yaw', invert: false, sens: 1 },
  vert: { source: 'pitch', invert: false, sens: 1 },
  name: 'ACE',
});

describe('axis settings persistence', () => {
  let storageMock: ReturnType<typeof createLocalStorageMock>;

  beforeEach(() => {
    storageMock = createLocalStorageMock();
    vi.stubGlobal('window', { localStorage: storageMock });
  });

  it('first visit: returns per-orientation defaults and commits them to v2', () => {
    const s = loadAxisSettings();

    expect(s.portrait).toEqual(DEFAULT_PORTRAIT);
    expect(s.landscape).toEqual(DEFAULT_LANDSCAPE);
    expect(s.name).toBeUndefined();
    expect(JSON.parse(storageMock.getItem(AXIS_CFG_KEY)!)).toEqual(s);
  });

  it('legacy-only blob: resets axes to new defaults, salvages only the name', () => {
    storageMock.setItem(LEGACY_AXIS_CFG_KEY, legacyBlob);

    const s = loadAxisSettings();

    expect(s.portrait.horiz.source).toBe('pitch'); // not the legacy 'yaw'
    expect(s.portrait).toEqual(DEFAULT_PORTRAIT);
    expect(s.landscape).toEqual(DEFAULT_LANDSCAPE);
    expect(s.name).toBe('ACE');
    expect(storageMock.getItem(AXIS_CFG_KEY)).not.toBeNull();
    expect(storageMock.getItem(LEGACY_AXIS_CFG_KEY)).toBeNull();
  });

  it('v2 present: respects it verbatim and ignores a stale legacy blob', () => {
    const custom = {
      portrait: {
        horiz: { source: 'rateY', invert: false, sens: 3 },
        vert: { source: 'yaw', invert: true, sens: 0.5 },
        moveSens: 1.4,
      },
      landscape: {
        horiz: { source: 'pitch', invert: false, sens: 1.1 },
        vert: { source: 'rateZ', invert: true, sens: 2 },
        moveSens: 0,
      },
      name: 'DUKE',
    };
    storageMock.setItem(AXIS_CFG_KEY, JSON.stringify(custom));
    storageMock.setItem(LEGACY_AXIS_CFG_KEY, legacyBlob);

    const s = loadAxisSettings();

    expect(s).toEqual(custom);
    expect(storageMock.getItem(LEGACY_AXIS_CFG_KEY)).toBeNull();
  });

  it('malformed v2 JSON: treated as absent, legacy name still salvaged', () => {
    storageMock.setItem(AXIS_CFG_KEY, '{not json');
    storageMock.setItem(LEGACY_AXIS_CFG_KEY, legacyBlob);

    const s = loadAxisSettings();

    expect(s.portrait).toEqual(DEFAULT_PORTRAIT);
    expect(s.landscape).toEqual(DEFAULT_LANDSCAPE);
    expect(s.name).toBe('ACE');
  });

  it('sanitizes bad fields and fills missing buckets from defaults', () => {
    const s = parseStoredAxisSettings(
      JSON.stringify({
        portrait: {
          horiz: { source: 'warp', invert: 'yes', sens: 99 },
          vert: { source: 'rateY', invert: true, sens: 1.5 },
        },
        // landscape bucket missing entirely
      }),
      null,
    );

    expect(s.portrait.horiz.source).toBe(DEFAULT_PORTRAIT.horiz.source);
    expect(s.portrait.horiz.invert).toBe(DEFAULT_PORTRAIT.horiz.invert);
    expect(s.portrait.horiz.sens).toBe(MAX_SENS);
    expect(s.portrait.vert).toEqual({
      source: 'rateY',
      invert: true,
      sens: 1.5,
    });
    expect(s.landscape).toEqual(DEFAULT_LANDSCAPE);
  });

  it('adopts the default moveSens for blobs saved before it existed', () => {
    const s = parseStoredAxisSettings(
      JSON.stringify({
        portrait: {
          horiz: { source: 'rateY', invert: false, sens: 3 },
          vert: { source: 'yaw', invert: true, sens: 0.5 },
        },
        landscape: {
          horiz: { source: 'pitch', invert: false, sens: 1.1 },
          vert: { source: 'rateZ', invert: true, sens: 2 },
        },
      }),
      null,
    );

    expect(s.portrait.moveSens).toBe(DEFAULT_MOVE_SENS);
    expect(s.landscape.moveSens).toBe(DEFAULT_MOVE_SENS);
    // The point of the field-wise merge: no axis tuning is lost to the upgrade.
    expect(s.portrait.horiz.source).toBe('rateY');
    expect(s.landscape.vert.sens).toBe(2);
  });

  it('clamps and rejects bad moveSens values', () => {
    const pair = {
      horiz: { source: 'yaw', invert: false, sens: 1 },
      vert: { source: 'pitch', invert: false, sens: 1 },
    };
    const parse = (moveSens: unknown) =>
      parseStoredAxisSettings(
        JSON.stringify({ portrait: { ...pair, moveSens } }),
        null,
      ).portrait.moveSens;

    expect(parse(99)).toBe(MAX_MOVE_SENS);
    expect(parse(-5)).toBe(MIN_MOVE_SENS);
    expect(parse(0)).toBe(0); // off is a legitimate saved value, not "missing"
    expect(parse('loud')).toBe(DEFAULT_MOVE_SENS);
    expect(parse(null)).toBe(DEFAULT_MOVE_SENS);
  });

  it('round-trips through save + load', () => {
    const s = loadAxisSettings();
    s.portrait.horiz.sens = 3.3;
    s.name = 'ROUND';

    saveAxisSettings(s);

    expect(loadAxisSettings()).toEqual(s);
  });
});
