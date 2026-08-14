// Gyro axis-mapping config shared by the shoot page (motion listener) and the
// calibration step UI. A selectable gyro signal for an aim axis — the user
// picks which one drives horizontal vs vertical (with invert + per-axis
// sensitivity), since auto-mapping can't know how they hold the phone.
//  - yaw:   rotation about world-up (swing/pan left-right), gravity-referenced
//  - pitch: rotation about the screen's right axis (nod up-down)
//  - rateX/Y/Z: raw gyro rate about device X (beta) / Y (gamma) / Z (alpha)
export type AxisSource = 'yaw' | 'pitch' | 'rateX' | 'rateY' | 'rateZ';
export type AxisCfg = { source: AxisSource; invert: boolean; sens: number };

export const AXIS_OPTIONS: { id: AxisSource; label: string }[] = [
  { id: 'yaw', label: 'Horizontal rotation — yaw (world)' },
  { id: 'pitch', label: 'Tilt — pitch (screen)' },
  { id: 'rateX', label: 'X axis — beta' },
  { id: 'rateY', label: 'Y axis — gamma' },
  { id: 'rateZ', label: 'Screen rotation — alpha' },
];

export const DEFAULT_HORIZ: AxisCfg = { source: 'yaw', invert: false, sens: 1 };
export const DEFAULT_VERT: AxisCfg = {
  source: 'pitch',
  invert: false,
  sens: 1,
};

export const AXIS_CFG_KEY = 'shootAxisCfg';

export const MIN_SENS = 0.3;
export const MAX_SENS = 4;

export function clampSens(v: number): number {
  return Math.max(MIN_SENS, Math.min(MAX_SENS, Math.round(v * 10) / 10));
}
