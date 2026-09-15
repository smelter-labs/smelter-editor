import { describe, expect, it } from 'vitest';
import type { FbCam, FbCamRole } from '@smelter-editor/types';
import { fmtClipTime, replayClip } from '../replay-helpers';

const cam = (role: FbCamRole, fileName?: string): FbCam => ({
  role,
  connected: !!fileName,
  source: 'file',
  ...(fileName ? { fileName } : {}),
});
const cams = (over: Partial<Record<FbCamRole, string>>) => ({
  pano: cam('pano', over.pano),
  left: cam('left', over.left),
  centre: cam('centre', over.centre),
  right: cam('right', over.right),
});

describe('replayClip', () => {
  it('prefers the panorama, then centre, left, right', () => {
    expect(replayClip(cams({ pano: 'fb/p.mp4', centre: 'fb/c.mp4' }))).toBe(
      'fb/p.mp4',
    );
    expect(replayClip(cams({ left: 'fb/l.mp4', centre: 'fb/c.mp4' }))).toBe(
      'fb/c.mp4',
    );
    expect(replayClip(cams({ right: 'fb/r.mp4' }))).toBe('fb/r.mp4');
  });
  it('is null without a file cam', () => {
    expect(replayClip(cams({}))).toBeNull();
    expect(replayClip(null)).toBeNull();
  });
});

describe('fmtClipTime', () => {
  it('formats m:ss', () => {
    expect(fmtClipTime(0)).toBe('0:00');
    expect(fmtClipTime(65_400)).toBe('1:05');
  });
});
