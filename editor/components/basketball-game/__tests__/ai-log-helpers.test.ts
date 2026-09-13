import { describe, expect, it } from 'vitest';
import type {
  BbAiLogEntry,
  BbBallEvent,
  BbShotEvent,
} from '@smelter-editor/types';
import { aiLogTime, aiStatus, mergeAiLog } from '../ai-log-helpers';
import { aiEvidenceLabel } from '../bb-kit-helpers';

const entry = (id: number, label = 'FLIGHT'): BbAiLogEntry => ({
  id,
  atMs: id * 1000,
  kind: 'state',
  tone: 'electric',
  label,
  text: `e${id}`,
});

const ball = (over: Partial<BbBallEvent>): BbBallEvent => ({
  type: 'bb_ball',
  roomId: 'r',
  tracked: true,
  zone: 'above',
  source: 'yolo',
  state: 'flight',
  procMs: 31.6,
  ...over,
});

describe('mergeAiLog', () => {
  it('replaces on reset, prepends batches newest-first, dedupes by id', () => {
    const reset = mergeAiLog(
      [entry(9)],
      {
        type: 'bb_ai_log',
        roomId: 'r',
        reset: true,
        entries: [entry(2), entry(1)],
      },
      60,
    );
    expect(reset.map((e) => e.id)).toEqual([2, 1]);
    const merged = mergeAiLog(
      reset,
      {
        type: 'bb_ai_log',
        roomId: 'r',
        entries: [entry(2), entry(3), entry(4)],
      },
      60,
    );
    expect(merged.map((e) => e.id)).toEqual([4, 3, 2, 1]);
    // nothing new → same array (no re-render churn)
    expect(
      mergeAiLog(
        merged,
        { type: 'bb_ai_log', roomId: 'r', entries: [entry(3)] },
        60,
      ),
    ).toBe(merged);
    expect(
      mergeAiLog(
        merged,
        { type: 'bb_ai_log', roomId: 'r', entries: [entry(5)] },
        3,
      ).map((e) => e.id),
    ).toEqual([5, 4, 3]);
  });
});

describe('aiLogTime', () => {
  it('formats ages compactly', () => {
    expect(aiLogTime(10_000, 13_400)).toBe('3s');
    expect(aiLogTime(0, 72_000)).toBe('1m12s');
    expect(aiLogTime(0, 14 * 60_000)).toBe('14m');
    expect(aiLogTime(0, 2 * 3_600_000)).toBe('2h');
    expect(aiLogTime(5_000, 1_000)).toBe('0s');
  });
});

describe('aiStatus', () => {
  it('reads the feed state off the last bb_ball', () => {
    expect(aiStatus(null, 0, 1000, false)).toEqual({
      text: 'AI IDLE · NO HOOP CAM',
      tone: 'idle',
    });
    expect(aiStatus(null, 0, 1000, true)).toEqual({
      text: 'WAITING FOR WORKER',
      tone: 'idle',
    });
    expect(aiStatus(ball({}), 1000, 1500, true)).toEqual({
      text: 'TRACKING · FLIGHT · ABOVE · YOLO · 32 MS',
      tone: 'live',
    });
    expect(
      aiStatus(
        ball({ tracked: false, zone: 'none', state: 'net' }),
        1000,
        1500,
        true,
      ),
    ).toEqual({
      text: 'NET · BALL HIDDEN · 32 MS',
      tone: 'electric',
    });
    expect(
      aiStatus(
        ball({
          tracked: false,
          zone: 'none',
          state: 'idle',
          procMs: undefined,
        }),
        1000,
        1500,
        true,
      ),
    ).toEqual({ text: 'IDLE · NO BALL', tone: 'idle' });
    expect(aiStatus(ball({}), 1000, 5000, true)).toEqual({
      text: 'NO FEED · 4s',
      tone: 'paused',
    });
  });
});

describe('aiEvidenceLabel', () => {
  const shot = (over: Partial<BbShotEvent>): BbShotEvent =>
    ({
      id: 's',
      index: 1,
      atMs: 0,
      team: null,
      points: 1,
      aiTeam: 'A',
      aiConfidence: 0.9,
      source: 'ai',
      status: 'pending',
      period: 'reg',
      clockMs: 0,
      ...over,
    }) as BbShotEvent;
  it('names the evidence, flags weak ones, appends the measurements', () => {
    expect(aiEvidenceLabel(shot({}))).toBeNull();
    expect(aiEvidenceLabel(shot({ evidence: 'net_occluded' }))).toBe(
      'WHY: NET_OCCLUDED',
    );
    expect(
      aiEvidenceLabel(
        shot({
          evidence: 'net_pass',
          aiReason: 'dwell 0.08s · net 2/2 lost 0',
        }),
      ),
    ).toBe('WHY: NET_PASS · WEAK · dwell 0.08s · net 2/2 lost 0');
    expect(
      aiEvidenceLabel(shot({ source: 'manual', evidence: 'x' })),
    ).toBeNull();
  });
});
