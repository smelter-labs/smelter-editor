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

  it('normalizes track aliases', () => {
    expect(normalize('lane 2')).toBe('track 2');
    expect(normalize('path 1')).toBe('track 1');
    expect(normalize('row 3')).toBe('track 3');
    expect(normalize('second truck')).toBe('track 2');
    expect(normalize('track number 4')).toBe('track 4');
    expect(normalize('3 track')).toBe('track 3');
  });

  it('normalizes block aliases', () => {
    expect(normalize('next clip')).toBe('next block');
    expect(normalize('previous segment')).toBe('previous block');
    expect(normalize('next blocks')).toBe('next block');
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
        shader: 'sw-hologram',
      });
    });

    it('parses "put remove color on first input"', () => {
      const result = parseCommand('put remove color on first input');
      expect(result).toEqual({
        intent: 'ADD_SHADER',
        inputIndex: 1,
        shader: 'remove-color',
      });
    });

    it('parses "apply grayscale to input 5"', () => {
      const result = parseCommand('apply grayscale to input 5');
      expect(result).toEqual({
        intent: 'ADD_SHADER',
        inputIndex: 5,
        shader: 'grayscale',
      });
    });

    it('parses "add opacity shader to input 2"', () => {
      const result = parseCommand('add opacity shader to input 2');
      expect(result).toEqual({
        intent: 'ADD_SHADER',
        inputIndex: 2,
        shader: 'opacity',
      });
    });

    it('returns CLARIFY when inputIndex missing', () => {
      const result = parseCommand('add hologram shader');
      expect(result).toEqual({
        intent: 'ADD_SHADER',
        inputIndex: null,
        shader: 'sw-hologram',
      });
    });

    it('returns CLARIFY when shader missing', () => {
      const result = parseCommand('add shader to input 1');
      expect(result).toBeNull();
    });
  });

  describe('REMOVE_SHADER', () => {
    it('parses "remove contrast shader from input two"', () => {
      const result = parseCommand('remove contrast shader from input two');
      expect(result).toEqual({
        intent: 'REMOVE_SHADER',
        inputIndex: 2,
        shader: 'brightness-contrast',
      });
    });

    it('parses "delete brightness from input 3"', () => {
      const result = parseCommand('delete brightness from input 3');
      expect(result).toEqual({
        intent: 'REMOVE_SHADER',
        inputIndex: 3,
        shader: 'brightness-contrast',
      });
    });

    it('parses "remove shadow shader from source 1"', () => {
      const result = parseCommand('remove shadow shader from source 1');
      expect(result).toEqual({
        intent: 'REMOVE_SHADER',
        inputIndex: 1,
        shader: 'soft-shadow',
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
        shader: 'grayscale',
      });
    });

    it('handles holo as hologram alias', () => {
      const result = parseCommand('apply holo to input 2');
      expect(result).toEqual({
        intent: 'ADD_SHADER',
        inputIndex: 2,
        shader: 'sw-hologram',
      });
    });

    it('treats "effect" as "shader"', () => {
      const result = parseCommand('add grayscale effect to input 1');
      expect(result).toEqual({
        intent: 'ADD_SHADER',
        inputIndex: 1,
        shader: 'grayscale',
      });
    });

    it('returns CLARIFY when effect is used without shader name', () => {
      const result = parseCommand('add effect to input 1');
      expect(result).toBeNull();
    });
  });

  describe('SELECT_TRACK', () => {
    it('parses "select track 2"', () => {
      expect(parseCommand('select track 2')).toEqual({
        intent: 'SELECT_TRACK',
        trackIndex: 2,
      });
    });

    it('parses "pick track one"', () => {
      expect(parseCommand('pick track one')).toEqual({
        intent: 'SELECT_TRACK',
        trackIndex: 1,
      });
    });

    it('parses "focus lane 3" via alias', () => {
      expect(parseCommand('focus lane 3')).toEqual({
        intent: 'SELECT_TRACK',
        trackIndex: 3,
      });
    });

    it('parses "select second truck" via alias', () => {
      expect(parseCommand('select second truck')).toEqual({
        intent: 'SELECT_TRACK',
        trackIndex: 2,
      });
    });

    it('parses "select path 1" via alias', () => {
      expect(parseCommand('select path 1')).toEqual({
        intent: 'SELECT_TRACK',
        trackIndex: 1,
      });
    });

    it('returns CLARIFY when track number missing', () => {
      expect(parseCommand('select track')).toEqual({
        intent: 'CLARIFY',
        missing: ['trackIndex'],
        question: 'Which track number?',
      });
    });
  });

  describe('REMOVE_TRACK', () => {
    it('parses "remove track 2"', () => {
      expect(parseCommand('remove track 2')).toEqual({
        intent: 'REMOVE_TRACK',
        trackIndex: 2,
      });
    });

    it('parses "delete track one"', () => {
      expect(parseCommand('delete track one')).toEqual({
        intent: 'REMOVE_TRACK',
        trackIndex: 1,
      });
    });

    it('parses "delete lane 3" via alias', () => {
      expect(parseCommand('delete lane 3')).toEqual({
        intent: 'REMOVE_TRACK',
        trackIndex: 3,
      });
    });

    it('returns CLARIFY when track number missing', () => {
      expect(parseCommand('remove track')).toEqual({
        intent: 'CLARIFY',
        missing: ['trackIndex'],
        question: 'Which track number?',
      });
    });
  });

  describe('NEXT_BLOCK / PREV_BLOCK', () => {
    it('parses "next block"', () => {
      expect(parseCommand('next block')).toEqual({ intent: 'NEXT_BLOCK' });
    });

    it('parses "forward block"', () => {
      expect(parseCommand('forward block')).toEqual({ intent: 'NEXT_BLOCK' });
    });

    it('parses "previous block"', () => {
      expect(parseCommand('previous block')).toEqual({ intent: 'PREV_BLOCK' });
    });

    it('parses "prev block"', () => {
      expect(parseCommand('prev block')).toEqual({ intent: 'PREV_BLOCK' });
    });

    it('parses "back block"', () => {
      expect(parseCommand('back block')).toEqual({ intent: 'PREV_BLOCK' });
    });

    it('parses "next clip" via alias', () => {
      expect(parseCommand('next clip')).toEqual({ intent: 'NEXT_BLOCK' });
    });

    it('parses "previous segment" via alias', () => {
      expect(parseCommand('previous segment')).toEqual({
        intent: 'PREV_BLOCK',
      });
    });
  });

  describe('New live operations commands', () => {
    it('parses set layout by name', () => {
      expect(parseCommand('set layout to picture in picture')).toEqual({
        intent: 'SET_LAYOUT',
        layout: 'picture-in-picture',
      });
    });

    it('parses hide/remove all commands', () => {
      expect(parseCommand('hide all inputs')).toEqual({
        intent: 'HIDE_ALL_INPUTS',
      });
      expect(parseCommand('delete all sources')).toEqual({
        intent: 'REMOVE_ALL_INPUTS',
      });
    });

    it('parses recording commands', () => {
      expect(parseCommand('start recording')).toEqual({
        intent: 'START_RECORDING',
      });
      expect(parseCommand('stop recording')).toEqual({
        intent: 'STOP_RECORDING',
      });
    });

    it('parses transition durations in ms and seconds', () => {
      expect(parseCommand('set transition duration to 900 ms')).toEqual({
        intent: 'SET_SWAP_DURATION',
        durationMs: 900,
      });
      expect(parseCommand('set fade in duration to 2 seconds')).toEqual({
        intent: 'SET_SWAP_FADE_IN_DURATION',
        durationMs: 2000,
      });
      expect(parseCommand('set fade out duration to 750')).toEqual({
        intent: 'SET_SWAP_FADE_OUT_DURATION',
        durationMs: 750,
      });
    });

    it('parses text scroll speed commands', () => {
      expect(parseCommand('set scroll speed to 120')).toEqual({
        intent: 'SET_TEXT_SCROLL_SPEED',
        scrollSpeed: 120,
      });
      expect(parseCommand('change text scrolling speed to 95')).toEqual({
        intent: 'SET_TEXT_SCROLL_SPEED',
        scrollSpeed: 95,
      });
    });

    it('parses outgoing transition and news strip toggles', () => {
      expect(parseCommand('enable outgoing transition')).toEqual({
        intent: 'SET_SWAP_OUTGOING_ENABLED',
        enabled: true,
      });
      expect(parseCommand('turn off outgoing transition')).toEqual({
        intent: 'SET_SWAP_OUTGOING_ENABLED',
        enabled: false,
      });
      expect(parseCommand('enable news strip')).toEqual({
        intent: 'SET_NEWS_STRIP_ENABLED',
        enabled: true,
      });
      expect(parseCommand('disable news strip')).toEqual({
        intent: 'SET_NEWS_STRIP_ENABLED',
        enabled: false,
      });
      expect(parseCommand('enable news strip fades')).toEqual({
        intent: 'SET_NEWS_STRIP_FADE_DURING_SWAP',
        enabled: true,
      });
      expect(parseCommand('turn off news strip fade')).toEqual({
        intent: 'SET_NEWS_STRIP_FADE_DURING_SWAP',
        enabled: false,
      });
    });

    it('parses text align commands', () => {
      expect(parseCommand('set align left')).toEqual({
        intent: 'SET_TEXT_ALIGN',
        textAlign: 'left',
      });
      expect(parseCommand('set text alignment center')).toEqual({
        intent: 'SET_TEXT_ALIGN',
        textAlign: 'center',
      });
      expect(parseCommand('align right')).toEqual({
        intent: 'SET_TEXT_ALIGN',
        textAlign: 'right',
      });
      expect(parseCommand('change alignment to centre')).toEqual({
        intent: 'SET_TEXT_ALIGN',
        textAlign: 'center',
      });
      expect(parseCommand('align text left')).toEqual({
        intent: 'SET_TEXT_ALIGN',
        textAlign: 'left',
      });
    });
  });
});
