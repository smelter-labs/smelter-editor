import { describe, expect, it } from 'vitest';
import {
  sanitizeBbEventsFileName,
  sanitizeBbMp4FileName,
} from '../mp4CamFileName';

describe('sanitizeBbMp4FileName', () => {
  it.each([
    ['bb-synth.mp4', 'bb-synth.mp4'],
    ['bb-test/hoop.mp4', 'bb-test/hoop.mp4'],
    ['  bb-test/court.MP4  ', 'bb-test/court.MP4'],
    ['a\\b.mp4', 'a/b.mp4'],
    ['a//b.mp4', 'a/b.mp4'],
    ['a/b/c.mp4', 'a/b/c.mp4'],
  ])('accepts %s → %s', (raw, expected) => {
    expect(sanitizeBbMp4FileName(raw)).toBe(expected);
  });

  it.each([
    [''],
    ['   '],
    ['../x.mp4'],
    ['a/../x.mp4'],
    ['./x.mp4'],
    ['/abs.mp4'],
    ['\\abs.mp4'],
    ['C:/clip.mp4'],
    ['a/b/c/d.mp4'],
    ['clip.mov'],
    ['clip'],
    ['.mp4'],
    ['bad\0name.mp4'],
    ['what?.mp4'],
    ['apidis/q2/events.json'],
  ])('rejects %j', (raw) => {
    expect(sanitizeBbMp4FileName(raw)).toBeNull();
  });
});

describe('sanitizeBbEventsFileName', () => {
  it.each([
    ['apidis/q2/events.json', 'apidis/q2/events.json'],
    ['bb-synth.events.JSON', 'bb-synth.events.JSON'],
  ])('accepts %s → %s', (raw, expected) => {
    expect(sanitizeBbEventsFileName(raw)).toBe(expected);
  });

  it.each([
    ['events.mp4'],
    ['../events.json'],
    ['/abs/events.json'],
    ['.json'],
    ['a/b/c/d/events.json'],
  ])('rejects %j', (raw) => {
    expect(sanitizeBbEventsFileName(raw)).toBeNull();
  });
});
