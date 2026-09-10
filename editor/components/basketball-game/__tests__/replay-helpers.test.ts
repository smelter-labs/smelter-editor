import { describe, expect, it } from 'vitest';
import type { BbCam, BbReplayState } from '@smelter-editor/types';
import {
  defaultEventsFile,
  fmtClipTime,
  replayClip,
  replayStatusLabel,
} from '../replay-helpers';

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

describe('defaultEventsFile', () => {
  const files = [
    'apidis/q2/events.json',
    'bb-synth.events.json',
    'other/events.json',
  ];
  it('takes the clip-specific file first', () => {
    expect(defaultEventsFile(files, cams({ fileName: 'bb-synth.mp4' }))).toBe(
      'bb-synth.events.json',
    );
  });
  it('falls back to events.json in the clip folder', () => {
    expect(
      defaultEventsFile(files, cams({ fileName: 'apidis/q2/cam7.mp4' })),
    ).toBe('apidis/q2/events.json');
  });
  it('else the first file, or nothing', () => {
    expect(
      defaultEventsFile(files, cams({ fileName: 'elsewhere/x.mp4' })),
    ).toBe('apidis/q2/events.json');
    expect(defaultEventsFile(files, null)).toBe('apidis/q2/events.json');
    expect(defaultEventsFile([], cams({ fileName: 'bb-synth.mp4' }))).toBe('');
  });
});

describe('replayStatusLabel', () => {
  const base: BbReplayState = {
    fileName: 'apidis/q2/events.json',
    active: true,
    basket: 'left',
    loop: true,
    total: 16,
    fired: 3,
    skipped: 0,
    nextEventTMs: 252_400,
    nextFireInMs: 6_400,
    clockRole: 'hoop',
  };
  it('formats fired / total, the next throw and the countdown', () => {
    expect(replayStatusLabel(base)).toBe('GT 3/16 · NEXT 4:12 IN 7S');
    expect(fmtClipTime(252_400)).toBe('4:12');
  });
  it('mentions skipped throws, a parked clock and the end', () => {
    expect(replayStatusLabel({ ...base, skipped: 2, nextFireInMs: null })).toBe(
      'GT 3/16 · 2 SKIPPED · NEXT 4:12 · NO FILE CAM',
    );
    expect(
      replayStatusLabel({
        ...base,
        fired: 16,
        nextEventTMs: null,
        nextFireInMs: null,
      }),
    ).toBe('GT 16/16 · DONE');
    expect(replayStatusLabel(null)).toBe('');
  });
});
