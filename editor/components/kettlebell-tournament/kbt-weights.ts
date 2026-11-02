import {
  KBT_BODY_KG_MAX,
  KBT_BODY_KG_MIN,
  KBT_DEFAULT_BODY_KG,
  KBT_DEFAULT_KETTLEBELL_KG,
  KBT_KETTLEBELL_KG_MAX,
  KBT_KETTLEBELL_KG_MIN,
} from '@smelter-editor/types';

/**
 * Weighted-scoring helpers shared by the phone wizard and the host screens.
 * parseKg mirrors the server's kbt_join clamp exactly, so the number the
 * athlete sees is the number the server stores.
 */

/** Keep only digits and one decimal separator while the athlete types. */
export function sanitizeKgInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.,]/g, '').replace(/,/g, '.');
  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) return cleaned;
  return (
    cleaned.slice(0, firstDot + 1) +
    cleaned.slice(firstDot + 1).replace(/\./g, '')
  );
}

/** Field value → kg clamped to [min, max] and rounded to 0.1, or undefined
 * for blank/garbage (= use the tournament default). */
export function parseKg(
  raw: string,
  min: number,
  max: number,
): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return undefined;
  return Math.round(Math.min(max, Math.max(min, n)) * 10) / 10;
}

export function parseKettlebellKg(raw: string): number | undefined {
  return parseKg(raw, KBT_KETTLEBELL_KG_MIN, KBT_KETTLEBELL_KG_MAX);
}

export function parseBodyKg(raw: string): number | undefined {
  return parseKg(raw, KBT_BODY_KG_MIN, KBT_BODY_KG_MAX);
}

/** "32KG · BW 70" badge text, defaults resolved like the server's blankScore. */
export function kbtWeightBadge(p: {
  kettlebellKg?: number | null;
  bodyKg?: number | null;
}): string {
  const bell = p.kettlebellKg ?? KBT_DEFAULT_KETTLEBELL_KG;
  const body = p.bodyKg ?? KBT_DEFAULT_BODY_KG;
  return `${bell}KG · BW ${body}`;
}
