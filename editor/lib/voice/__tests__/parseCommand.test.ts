import { describe, it, expect } from 'vitest';
import { parseCommand } from '../parseCommand';
import { normalize } from '../normalize';

describe('normalize', () => {
  it('lowercases and removes punctuation', () => {
    expect(normalize('Hello, World!')).toBe('hello world');
  });

  it('replaces polite words', () => {
    expect(normalize('could you add camera please')).toBe('add camera');
  });

  it('converts number words to digits', () => {
    expect(normalize('input one')).toBe('input 1');
    expect(normalize('first input')).toBe('input 1');
    expect(normalize('input number 2')).toBe('input 2');
  });

  it('converts ordinals and words for 1-12', () => {
    expect(normalize('twelfth')).toBe('12');
    expect(normalize('third')).toBe('3');
  });

  it('normalizes aliases', () => {
    expect(normalize('screen share')).toBe('screenshare');
    expect(normalize('gray scale')).toBe('grayscale');
    expect(normalize('holo')).toBe('hologram');
    expect(normalize('feed 3')).toBe('input 3');
    expect(normalize('source 1')).toBe('input 1');
    expect(normalize('effect')).toBe('shader');
  });
});

describe('parseCommand', () => {
  describe('ADD_INPUT', () => {
    it('parses "add new camera input"', () => {
      const result = parseCommand('add new camera input');
      expect(result).toEqual({ intent: 'ADD_INPUT', inputType: 'camera' });
    });

    it('parses "could you create a mp4 input please"', () => {
      const result = parseCommand('could you create a mp4 input please');
      expect(result).toEqual({ intent: 'ADD_INPUT', inputType: 'mp4' });
    });

    it('parses "add screenshare"', () => {
      const result = parseCommand('add screen share');
      expect(result).toEqual({ intent: 'ADD_INPUT', inputType: 'screenshare' });
    });

    it('parses "new image input"', () => {
      const result = parseCommand('new image input');
      expect(result).toEqual({ intent: 'ADD_INPUT', inputType: 'image' });
    });

    it('parses "create text input"', () => {
      const result = parseCommand('create text input');
      expect(result).toEqual({ intent: 'ADD_INPUT', inputType: 'text' });
    });

    it('parses "add stream"', () => {
      const result = parseCommand('add stream');
      expect(result).toEqual({ intent: 'ADD_INPUT', inputType: 'stream' });
    });
  });

  describe('MOVE_INPUT', () => {
    it('parses "move input three up"', () => {
      const result = parseCommand('move input three up');
      expect(result).toEqual({
        intent: 'MOVE_INPUT',
        inputIndex: 3,
        direction: 'UP',
        steps: 1,
      });
    });

    it('parses "move input 2 down 2"', () => {
      const result = parseCommand('move input 2 down 2');
      expect(result).toEqual({
        intent: 'MOVE_INPUT',
        inputIndex: 2,
        direction: 'DOWN',
        steps: 2,
      });
    });

    it('parses "move first input higher"', () => {
      const result = parseCommand('move first input higher');
      expect(result).toEqual({
        intent: 'MOVE_INPUT',
        inputIndex: 1,
        direction: 'UP',
        steps: 1,
      });
    });

    it('parses "swap input 4 below"', () => {
      const result = parseCommand('swap input 4 below');
      expect(result).toEqual({
        intent: 'MOVE_INPUT',
        inputIndex: 4,
        direction: 'DOWN',
        steps: 1,
      });
    });

    it('parses "move feed 2 up by 3"', () => {
      const result = parseCommand('move feed 2 up by 3');
      expect(result).toEqual({
        intent: 'MOVE_INPUT',
        inputIndex: 2,
        direction: 'UP',
        steps: 3,
      });
    });

    it('returns CLARIFY when direction missing', () => {
      const result = parseCommand('move input 1');
      expect(result).toEqual({
        intent: 'CLARIFY',
        missing: ['direction'],
        question: 'Up or down?',
      });
    });
  });

  describe('ADD_SHADER', () => {
    it('parses "add HOLOGRAM shader to input one"', () => {
      const result = parseCommand('add HOLOGRAM shader to input one');
      expect(result).toEqual({
        intent: 'ADD_SHADER',
        inputIndex: 1,
        shader: 'HOLOGRAM',
      });
    });

    it('parses "put remove color on first input"', () => {
      const result = parseCommand('put remove color on first input');
      expect(result).toEqual({
        intent: 'ADD_SHADER',
        inputIndex: 1,
        shader: 'REMOVE_COLOR',
      });
    });

    it('parses "apply grayscale to input 5"', () => {
      const result = parseCommand('apply grayscale to input 5');
      expect(result).toEqual({
        intent: 'ADD_SHADER',
        inputIndex: 5,
        shader: 'GRAYSCALE',
      });
    });

    it('parses "add opacity shader to input 2"', () => {
      const result = parseCommand('add opacity shader to input 2');
      expect(result).toEqual({
        intent: 'ADD_SHADER',
        inputIndex: 2,
        shader: 'OPACITY',
      });
    });

    it('returns CLARIFY when inputIndex missing', () => {
      const result = parseCommand('add hologram shader');
      expect(result).toEqual({
        intent: 'CLARIFY',
        missing: ['inputIndex'],
        question: 'Which input number?',
      });
    });

    it('returns CLARIFY when shader missing', () => {
      const result = parseCommand('add shader to input 1');
      expect(result).toEqual({
        intent: 'CLARIFY',
        missing: ['shader'],
        question: 'Which shader?',
      });
    });
  });

  describe('REMOVE_SHADER', () => {
    it('parses "remove contrast shader from input two"', () => {
      const result = parseCommand('remove contrast shader from input two');
      expect(result).toEqual({
        intent: 'REMOVE_SHADER',
        inputIndex: 2,
        shader: 'CONTRAST',
      });
    });

    it('parses "delete brightness from input 3"', () => {
      const result = parseCommand('delete brightness from input 3');
      expect(result).toEqual({
        intent: 'REMOVE_SHADER',
        inputIndex: 3,
        shader: 'BRIGHTNESS',
      });
    });

    it('parses "remove shadow shader from source 1"', () => {
      const result = parseCommand('remove shadow shader from source 1');
      expect(result).toEqual({
        intent: 'REMOVE_SHADER',
        inputIndex: 1,
        shader: 'SHADOW',
      });
    });
  });

  describe('REMOVE_INPUT', () => {
    it('parses "remove first input"', () => {
      const result = parseCommand('remove first input');
      expect(result).toEqual({
        intent: 'REMOVE_INPUT',
        inputIndex: 1,
      });
    });

    it('parses "delete input 3"', () => {
      const result = parseCommand('delete input 3');
      expect(result).toEqual({
        intent: 'REMOVE_INPUT',
        inputIndex: 3,
      });
    });

    it('parses "remove input 5"', () => {
      const result = parseCommand('remove input 5');
      expect(result).toEqual({
        intent: 'REMOVE_INPUT',
        inputIndex: 5,
      });
    });
  });

  describe('Edge cases', () => {
    it('returns null for empty string', () => {
      expect(parseCommand('')).toBeNull();
    });

    it('returns null for gibberish', () => {
      expect(parseCommand('asdf jkl qwerty')).toBeNull();
    });

    it('handles grey scale (British spelling)', () => {
      const result = parseCommand('add grey scale to input 1');
      expect(result).toEqual({
        intent: 'ADD_SHADER',
        inputIndex: 1,
        shader: 'GRAYSCALE',
      });
    });

    it('handles holo as hologram alias', () => {
      const result = parseCommand('apply holo to input 2');
      expect(result).toEqual({
        intent: 'ADD_SHADER',
        inputIndex: 2,
        shader: 'HOLOGRAM',
      });
    });

    it('treats "effect" as "shader"', () => {
      const result = parseCommand('add grayscale effect to input 1');
      expect(result).toEqual({
        intent: 'ADD_SHADER',
        inputIndex: 1,
        shader: 'GRAYSCALE',
      });
    });

    it('returns CLARIFY when effect is used without shader name', () => {
      const result = parseCommand('add effect to input 1');
      expect(result).toEqual({
        intent: 'CLARIFY',
        missing: ['shader'],
        question: 'Which shader?',
      });
    });
  });
});
