import { describe, it, expect } from 'vitest';
import { findMatchingMacro } from '../macroExecutor';

describe('findMatchingMacro', () => {
  describe('exact substring matching', () => {
    it('matches an exact trigger string', () => {
      const result = findMatchingMacro('galactic spaceship');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('galactic-spaceship');
    });

    it('matches when transcript contains the trigger', () => {
      const result = findMatchingMacro('please do galactic spaceship now');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('galactic-spaceship');
    });

    it('matches when trigger contains the transcript', () => {
      const result = findMatchingMacro('two cameras');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('dual-camera-setup');
    });
  });

  describe('fuzzy matching (Levenshtein fallback)', () => {
    it('matches a trigger with a small typo', () => {
      const result = findMatchingMacro('galactic spaceships');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('galactic-spaceship');
    });

    it('matches a trigger with a missing letter', () => {
      const result = findMatchingMacro('galactic spachip');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('galactic-spaceship');
    });

    it('matches a trigger with a substitution', () => {
      const result = findMatchingMacro('galactic camara');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('galactic-camera');
    });

    it('does not match completely unrelated text', () => {
      const result = findMatchingMacro('the weather is nice today');
      expect(result).toBeNull();
    });

    it('does not match short gibberish', () => {
      const result = findMatchingMacro('xyz abc');
      expect(result).toBeNull();
    });
  });

  describe('exact match takes priority over fuzzy', () => {
    it('prefers exact substring over a closer fuzzy match', () => {
      const result = findMatchingMacro('reset to camera');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('reset-to-camera');
    });
  });
});
