// Gyro axis-mapping config shared by the shoot page (motion listener) and the
// calibration step UI. A selectable gyro signal for an aim axis — the user
// picks which one drives horizontal vs vertical (with invert + per-axis
// sensitivity), since auto-mapping can't know how they hold the phone.
//  - yaw:   rotation about world-up (swing/pan left-right), gravity-referenced
//  - pitch: rotation about the screen's right axis (nod up-down)
//  - rateX/Y/Z: raw gyro rate about device X (beta) / Y (gamma) / Z (alpha)
//
// Settings are kept per screen orientation (portrait vs landscape): rateX/Y/Z
// are raw device-frame axes, so the same physical wrist motion maps to a
// different axis after rotating the phone. Storage is versioned — bumping the
// key to v2 deliberately reset everyone's pre-orientation tunings once (only
// the saved call-sign name is salvaged from the legacy blob); from then on
// whatever the user saves is respected again.
export type AxisSource = 'yaw' | 'pitch' | 'rateX' | 'rateY' | 'rateZ';
export type AxisCfg = { source: AxisSource; invert: boolean; sens: number };
export type OrientationKey = 'portrait' | 'landscape';
export type AxisPair = { horiz: AxisCfg; vert: AxisCfg };
export type AxisSettings = Record<OrientationKey, AxisPair>;
export type StoredAxisSettings = AxisSettings & { name?: string };

export const AXIS_OPTIONS: { id: AxisSource; label: string }[] = [
  { id: 'yaw', label: 'Horizontal rotation — yaw (world)' },
  { id: 'pitch', label: 'Tilt — pitch (screen)' },
  { id: 'rateX', label: 'X axis — beta' },
  { id: 'rateY', label: 'Y axis — gamma' },
  { id: 'rateZ', label: 'Screen rotation — alpha' },
];

export const DEFAULT_PORTRAIT: AxisPair = {
  horiz: { source: 'pitch', invert: true, sens: 2.5 },
  vert: { source: 'rateZ', invert: true, sens: 2.6 },
};
export const DEFAULT_LANDSCAPE: AxisPair = {
  horiz: { source: 'rateZ', invert: true, sens: 2.5 },
  vert: { source: 'rateX', invert: false, sens: 2.6 },
};

export const AXIS_CFG_KEY = 'shootAxisCfg-v2';
export const LEGACY_AXIS_CFG_KEY = 'shootAxisCfg';

export const MIN_SENS = 0.3;
export const MAX_SENS = 4;

export function clampSens(v: number): number {
  return Math.max(MIN_SENS, Math.min(MAX_SENS, Math.round(v * 10) / 10));
}

const clonePair = (p: AxisPair): AxisPair => ({
  horiz: { ...p.horiz },
  vert: { ...p.vert },
});

export function defaultAxisSettings(): AxisSettings {
  return {
    portrait: clonePair(DEFAULT_PORTRAIT),
    landscape: clonePair(DEFAULT_LANDSCAPE),
  };
}

// Field-wise merge over the fallback so an old/partial/tampered blob can never
// leak an unknown source into the motion math or an out-of-range sensitivity.
function sanitizeAxisCfg(v: unknown, fallback: AxisCfg): AxisCfg {
  const p = (v && typeof v === 'object' ? v : {}) as Partial<AxisCfg>;
  return {
    source: AXIS_OPTIONS.some((o) => o.id === p.source)
      ? (p.source as AxisSource)
      : fallback.source,
    invert: typeof p.invert === 'boolean' ? p.invert : fallback.invert,
    sens: Number.isFinite(p.sens) ? clampSens(p.sens as number) : fallback.sens,
  };
}

function sanitizePair(v: unknown, fallback: AxisPair): AxisPair {
  const p = (v && typeof v === 'object' ? v : {}) as Partial<AxisPair>;
  return {
    horiz: sanitizeAxisCfg(p.horiz, fallback.horiz),
    vert: sanitizeAxisCfg(p.vert, fallback.vert),
  };
}

// Pure parse of the raw storage strings, never throws. A present v2 blob wins;
// an absent/unparseable one falls back to the defaults, salvaging ONLY the
// name from the legacy pre-orientation blob (its axis tunings are the thing
// the v2 bump intentionally resets).
export function parseStoredAxisSettings(
  rawV2: string | null,
  rawLegacy: string | null,
): StoredAxisSettings {
  let v2: unknown = null;
  if (rawV2) {
    try {
      v2 = JSON.parse(rawV2);
    } catch {
      v2 = null;
    }
  }
  if (v2 && typeof v2 === 'object') {
    const p = v2 as Partial<StoredAxisSettings>;
    return {
      portrait: sanitizePair(p.portrait, DEFAULT_PORTRAIT),
      landscape: sanitizePair(p.landscape, DEFAULT_LANDSCAPE),
      ...(typeof p.name === 'string' && p.name ? { name: p.name } : {}),
    };
  }
  const result: StoredAxisSettings = defaultAxisSettings();
  if (rawLegacy) {
    try {
      const legacy = JSON.parse(rawLegacy) as { name?: unknown };
      if (typeof legacy.name === 'string' && legacy.name)
        result.name = legacy.name;
    } catch {
      /* ignore malformed legacy blob */
    }
  }
  return result;
}

// Load + one-shot migration: when no v2 blob exists yet, the defaults (plus
// any salvaged legacy name) are committed immediately so the reset happens
// exactly once even if the user never touches a setting, and the legacy key
// is dropped.
export function loadAxisSettings(): StoredAxisSettings {
  if (typeof window === 'undefined') return defaultAxisSettings();
  let rawV2: string | null = null;
  let rawLegacy: string | null = null;
  try {
    rawV2 = window.localStorage.getItem(AXIS_CFG_KEY);
    rawLegacy = window.localStorage.getItem(LEGACY_AXIS_CFG_KEY);
  } catch {
    /* ignore */
  }
  const result = parseStoredAxisSettings(rawV2, rawLegacy);
  try {
    if (rawV2 == null)
      window.localStorage.setItem(AXIS_CFG_KEY, JSON.stringify(result));
    if (rawLegacy != null) window.localStorage.removeItem(LEGACY_AXIS_CFG_KEY);
  } catch {
    /* ignore */
  }
  return result;
}

export function saveAxisSettings(s: StoredAxisSettings): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(AXIS_CFG_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
