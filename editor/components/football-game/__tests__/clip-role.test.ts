import { describe, expect, it } from 'vitest';
import { clipFitsRole } from '../clip-role';

describe('clipFitsRole', () => {
  it('the sidecar rig wins over the file name', () => {
    // A montage of the panorama that happens to be called cam1.mp4.
    expect(clipFitsRole('pano', 'fb-demo/x/cam1.mp4', 'pano')).toBe(true);
    expect(clipFitsRole('centre', 'fb-demo/x/cam1.mp4', 'pano')).toBe(false);
    expect(clipFitsRole('pano', 'fb/t/wide-pano.mp4', 'tricam')).toBe(false);
  });

  it('the name tells the three cameras apart', () => {
    expect(clipFitsRole('left', 'fb/t/cam0.mp4', 'tricam')).toBe(true);
    expect(clipFitsRole('right', 'fb/t/cam0.mp4', 'tricam')).toBe(false);
    expect(clipFitsRole('right', 'fb/t/stand.mp4', 'tricam')).toBe(true);
  });

  it('falls back to the name without a sidecar', () => {
    expect(clipFitsRole('pano', 'other/match.mp4', null)).toBe(true);
    expect(clipFitsRole('pano', 'other/cam2.mp4', undefined)).toBe(false);
    expect(clipFitsRole('right', 'other/cam2.mp4', null)).toBe(true);
  });
});
