import { describe, expect, it } from 'vitest';
import {
  kbtWeightBadge,
  parseBodyKg,
  parseKettlebellKg,
  sanitizeKgInput,
} from '../kbt-weights';

describe('sanitizeKgInput', () => {
  it('keeps digits, maps comma to dot, drops everything else', () => {
    expect(sanitizeKgInput('32')).toBe('32');
    expect(sanitizeKgInput('72,5')).toBe('72.5');
    expect(sanitizeKgInput('7a2.5kg')).toBe('72.5');
  });

  it('allows at most one decimal separator', () => {
    expect(sanitizeKgInput('7.2.5')).toBe('7.25');
    expect(sanitizeKgInput('7,2,5')).toBe('7.25');
  });
});

describe('parseKg', () => {
  it('clamps to the shared ranges and rounds to 0.1 (server mirror)', () => {
    expect(parseKettlebellKg('200')).toBe(92);
    expect(parseKettlebellKg('1')).toBe(4);
    expect(parseKettlebellKg('32.44')).toBe(32.4);
    expect(parseBodyKg('10')).toBe(30);
    expect(parseBodyKg('500')).toBe(250);
    expect(parseBodyKg('72.5')).toBe(72.5);
  });

  it('treats blank and garbage as "use the default"', () => {
    expect(parseKettlebellKg('')).toBeUndefined();
    expect(parseKettlebellKg('   ')).toBeUndefined();
    expect(parseBodyKg('.')).toBeUndefined();
  });
});

describe('kbtWeightBadge', () => {
  it('prints entered weights and falls back to 24/80', () => {
    expect(kbtWeightBadge({ kettlebellKg: 32, bodyKg: 70 })).toBe(
      '32KG · BW 70',
    );
    expect(kbtWeightBadge({})).toBe('24KG · BW 80');
    expect(kbtWeightBadge({ kettlebellKg: null, bodyKg: 72.5 })).toBe(
      '24KG · BW 72.5',
    );
  });
});
