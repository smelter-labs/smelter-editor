import { describe, expect, it } from 'vitest';
import {
  isHiddenName,
  joinFolder,
  relDirOfPath,
} from '../upload-folder-helpers';

describe('joinFolder', () => {
  it('joins the current folder with a dropped folder path', () => {
    expect(joinFolder('demo', 'left-3-loop')).toBe('demo/left-3-loop');
    expect(joinFolder('', 'left-3-loop')).toBe('left-3-loop');
    expect(joinFolder('demo', '')).toBe('demo');
    expect(joinFolder('demo/', '/set/sub/')).toBe('demo/set/sub');
    expect(joinFolder('', undefined)).toBe('');
  });
});

describe('relDirOfPath', () => {
  it('keeps the picked folder name as the first segment', () => {
    expect(relDirOfPath('left-3-loop/cam7.mp4')).toBe('left-3-loop');
    expect(relDirOfPath('set/sub/cam7.events.json')).toBe('set/sub');
    expect(relDirOfPath('cam7.mp4')).toBe('');
    expect(relDirOfPath('')).toBe('');
  });
});

describe('isHiddenName', () => {
  it('skips dot files', () => {
    expect(isHiddenName('.DS_Store')).toBe(true);
    expect(isHiddenName('._cam7.mp4')).toBe(true);
    expect(isHiddenName('cam7.mp4')).toBe(false);
  });
});
