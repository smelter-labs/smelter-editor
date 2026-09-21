import { describe, expect, it } from 'vitest';
import { sanitizeFbMp4FileName } from '../mp4CamFileName';

describe('sanitizeFbMp4FileName', () => {
  it('accepts library clips in folders', () => {
    expect(sanitizeFbMp4FileName('fb/pano-2013-11-28/pano.mp4')).toBe(
      'fb/pano-2013-11-28/pano.mp4',
    );
    expect(sanitizeFbMp4FileName('  fb-demo/pano-3x40s/pano.MP4 ')).toBe(
      'fb-demo/pano-3x40s/pano.MP4',
    );
  });

  it('refuses traversal, absolute paths and other files', () => {
    for (const bad of [
      '../secrets.mp4',
      'fb/../../etc/passwd.mp4',
      '/etc/passwd.mp4',
      'C:\\clips\\pano.mp4',
      'fb/pano.json',
      '.mp4',
      '',
      'fb/pa\0no.mp4',
    ]) {
      expect(sanitizeFbMp4FileName(bad), bad).toBeNull();
    }
  });

  it('refuses a path deeper than the library limit', () => {
    expect(sanitizeFbMp4FileName('fb/demo/x/y.mp4')).toBeNull();
  });
});
