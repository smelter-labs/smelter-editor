import { describe, expect, it } from 'vitest';
import type { BbCam } from '@smelter-editor/types';
import { fmtClipTime, replayClip } from '../replay-helpers';

const cam = (over: Partial<BbCam>): BbCam =>
  ({
    role: 'hoop',
    name: 'Hoop cam (file)',
    joined: true,
    connected: true,
    camConnected: true,
    source: 'file',
    calibrated: false,
    ...over,
  }) as BbCam;

const cams = (
  hoop: Partial<BbCam>,
  court: Partial<BbCam> = { joined: false },
) => ({
  hoop: cam({ role: 'hoop', ...hoop }),
  court: cam({ role: 'court', ...court }),
});

describe('replayClip', () => {
  it('prefers the hoop file cam, then the court, else null', () => {
    expect(
      replayClip(
        cams(
          { fileName: 'apidis/q2/cam7.mp4' },
          { fileName: 'apidis/q2/cam1.mp4' },
        ),
      ),
    ).toBe('apidis/q2/cam7.mp4');
    expect(
      replayClip(cams({ source: 'whip' }, { fileName: 'apidis/q2/cam1.mp4' })),
    ).toBe('apidis/q2/cam1.mp4');
    expect(replayClip(cams({ joined: false }))).toBeNull();
    expect(replayClip(null)).toBeNull();
  });
});

describe('fmtClipTime', () => {
  it('formats m:ss', () => {
    expect(fmtClipTime(252_400)).toBe('4:12');
    expect(fmtClipTime(0)).toBe('0:00');
    expect(fmtClipTime(-5)).toBe('0:00');
  });
});
