import { describe, expect, it } from 'vitest';
import { SHOOTER_CHARACTERS } from '@smelter-editor/types';
import {
  DEFAULT_COMBO_CONFIG,
  comboConfigFor,
  comboMultiplier,
  comboPoints,
} from '../combo';

const cfg = { windowMs: 2000, growth: 0.5, max: 3 };

describe('comboMultiplier', () => {
  it('is x1 for the first kill of a chain, whatever the gap says', () => {
    expect(comboMultiplier(1, 0, cfg)).toBe(1);
    expect(comboMultiplier(1, 999999, cfg)).toBe(1);
    expect(comboMultiplier(0, 100, cfg)).toBe(1);
  });

  it('grows with the streak at a fixed gap', () => {
    const at = (streak: number) => comboMultiplier(streak, 500, cfg);
    expect(at(2)).toBeGreaterThan(at(1));
    expect(at(3)).toBeGreaterThan(at(2));
    expect(at(4)).toBeGreaterThan(at(3));
  });

  it('decays with the gap between kills at a fixed streak', () => {
    const at = (dt: number) => comboMultiplier(3, dt, cfg);
    expect(at(100)).toBeGreaterThan(at(1000));
    expect(at(1000)).toBeGreaterThan(at(1900));
    // An instant follow-up gets the full growth term.
    expect(at(0)).toBeCloseTo(1 + cfg.growth * 2, 10);
  });

  it('caps at the character maximum', () => {
    expect(comboMultiplier(50, 0, cfg)).toBe(cfg.max);
  });

  it('never dips below x1', () => {
    for (let streak = 1; streak <= 10; streak++) {
      for (const dt of [0, 500, 1999, 5000]) {
        expect(comboMultiplier(streak, dt, cfg)).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('separates the character flavors: short-window/high-cap vs forgiving', () => {
    const crane = comboConfigFor('crane-hunter');
    const spotter = comboConfigFor('pink-spotter');
    // Fast hands: the risky character out-earns the forgiving one.
    expect(comboMultiplier(4, 200, crane)).toBeGreaterThan(
      comboMultiplier(4, 200, spotter),
    );
    // Ceilings differ per character.
    expect(comboMultiplier(50, 0, crane)).toBe(crane.max);
    expect(comboMultiplier(50, 0, spotter)).toBe(spotter.max);
    expect(crane.max).toBeGreaterThan(spotter.max);
  });
});

describe('comboPoints', () => {
  it('rounds the multiplier and never awards less than one point', () => {
    expect(comboPoints(1)).toBe(1);
    expect(comboPoints(1.4)).toBe(1);
    expect(comboPoints(1.5)).toBe(2);
    expect(comboPoints(2.6)).toBe(3);
    expect(comboPoints(0)).toBe(1);
  });
});

describe('comboConfigFor', () => {
  it('reads the shared catalog and falls back for unknown ids', () => {
    for (const c of SHOOTER_CHARACTERS) {
      expect(comboConfigFor(c.id)).toEqual(c.combo);
    }
    expect(comboConfigFor(undefined)).toEqual(DEFAULT_COMBO_CONFIG);
    expect(comboConfigFor('no-such-hunter')).toEqual(DEFAULT_COMBO_CONFIG);
  });
});
