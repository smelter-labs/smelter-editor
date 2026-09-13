import { describe, expect, it } from 'vitest';
import {
  AI_LOG_CAP,
  BbAiLog,
  metricsSummary,
  reasonText,
  stateLabel,
} from '../aiLog';

describe('BbAiLog', () => {
  it('logs one entry per state transition and skips returns to idle', () => {
    const log = new BbAiLog();
    const frame = (state: string, tracked = true, t = 0) =>
      log.onFrame({ state, zone: 'above', src: 'yolo', tracked, t }, 1000 + t);
    frame('idle');
    frame('idle');
    frame('flight', true, 100);
    frame('flight', true, 150);
    frame('rim', true, 200);
    frame('net', true, 300);
    frame('cooldown', true, 400);
    frame('idle', true, 1900);
    frame('flight', true, 2000);
    frame('idle', true, 2500); // a miss: candidate_end carries the why
    frame('idle', true, 2600);
    const batch = log.drain();
    expect(batch.map((e) => e.label)).toEqual([
      'FLIGHT',
      'RIM',
      'NET',
      'COOLDOWN',
      'FLIGHT',
    ]);
    expect(batch[0]).toMatchObject({
      kind: 'state',
      tone: 'electric',
      text: 'idle→flight · above · yolo',
      t: 100,
    });
    expect(batch.map((e) => e.id)).toEqual([1, 2, 3, 4, 5]);
    expect(log.drain()).toEqual([]);
    expect(log.snapshot().map((e) => e.label)).toEqual([
      'FLIGHT',
      'COOLDOWN',
      'NET',
      'RIM',
      'FLIGHT',
    ]);
  });

  it('logs the ball coming back only after a long gap', () => {
    const log = new BbAiLog();
    log.onFrame({ state: 'idle', tracked: true, src: 'crop' }, 1000);
    log.onFrame({ state: 'idle', tracked: false }, 1500);
    log.onFrame({ state: 'idle', tracked: true, src: 'crop' }, 2600);
    expect(log.drain()).toEqual([]); // 1.6 s gap: normal
    log.onFrame({ state: 'idle', tracked: false }, 3000);
    log.onFrame({ state: 'idle', tracked: false }, 5000);
    expect(log.drain()).toEqual([]); // nothing while it is gone
    log.onFrame({ state: 'idle', tracked: true, src: 'hsv' }, 5100);
    log.onFrame({ state: 'idle', tracked: true, src: 'hsv' }, 5200);
    expect(log.drain().map((e) => e.text)).toEqual([
      'found · hsv · after 2.5 s',
    ]);
  });

  it('never logs a find before the ball was ever seen', () => {
    const log = new BbAiLog();
    log.onFrame({ state: 'idle', tracked: false }, 1000);
    log.onFrame({ state: 'idle', tracked: true, src: 'yolo' }, 9000);
    expect(log.drain()).toEqual([]);
  });

  it('turns candidate_end into MAKE / MISS / DROP with the measurements', () => {
    const log = new BbAiLog();
    log.onCandidateEnd(
      {
        type: 'candidate_end',
        t: 12.5,
        made: true,
        reason: 'net_occluded',
        attempted: true,
        metrics: {
          dwell: 0.12,
          netSamples: 3,
          netCentred: 1,
          netLost: 2,
          entrySpeed: 1.42,
          netMinSpeed: 1.31,
          minDist: 0.31,
        },
      },
      1000,
    );
    log.onCandidateEnd(
      {
        type: 'candidate_end',
        made: false,
        reason: 'net_exit_no_evidence',
        attempted: true,
        metrics: { dwell: 0.05, netSamples: 2, belowBottom: true },
      },
      1100,
    );
    log.onCandidateEnd(
      {
        type: 'candidate_end',
        made: false,
        reason: 'flight_away',
        attempted: false,
        debounced: true,
        metrics: { minDist: 3.2, touchedRim: true },
      },
      1200,
    );
    log.onCandidateEnd(
      {
        type: 'candidate_end',
        made: false,
        reason: 'flight_lost',
        attempted: false,
      },
      1300,
    );
    const b = log.drain();
    expect(b[0]).toMatchObject({
      kind: 'candidate',
      tone: 'good',
      label: 'MAKE',
      t: 12.5,
      text: 'net_occluded · seen in the net, hidden by the mesh, out under it',
      detail: 'dwell 0.12s · net 3/1 lost 2 · v 1.42→1.31 · min 0.31rx',
    });
    expect(b[1]).toMatchObject({
      tone: 'amber',
      label: 'MISS',
      text: 'net_exit_no_evidence · left the net band, no make evidence',
      detail: 'dwell 0.05s · net 2/0 lost 0',
    });
    expect(b[2]).toMatchObject({
      tone: 'dim',
      label: 'DROP',
      text: 'flight_away · flew past the hoop · attempt debounced',
      detail: 'min 3.20rx · rim touched',
    });
    expect(b[3]).toMatchObject({
      label: 'DROP',
      text: 'flight_lost · lost in flight · too far for an attempt',
    });
    expect(b[3].detail).toBeUndefined();
  });

  it('caps the snapshot at AI_LOG_CAP, newest first', () => {
    const log = new BbAiLog();
    for (let i = 0; i < AI_LOG_CAP + 5; i++) {
      log.push({ kind: 'ai', tone: 'chalk', label: 'AI', text: `e${i}` }, i);
    }
    const snap = log.snapshot();
    expect(snap).toHaveLength(AI_LOG_CAP);
    expect(snap[0].text).toBe(`e${AI_LOG_CAP + 4}`);
    expect(snap[AI_LOG_CAP - 1].text).toBe('e5');
    expect(log.drain()).toHaveLength(AI_LOG_CAP + 5);
  });

  it('words reasons and states', () => {
    expect(reasonText('rim_exit')).toBe('left the rim without dropping');
    expect(reasonText('something_new')).toBe('something new');
    expect(stateLabel('rim')).toEqual({ label: 'RIM', tone: 'amber' });
    expect(stateLabel('weird')).toEqual({ label: 'WEIRD', tone: 'chalk' });
    expect(metricsSummary(undefined)).toBe('');
    expect(metricsSummary({ belowBottom: false, netSamples: 1 })).toBe(
      'net 1/0 lost 0 · exited above net bottom',
    );
  });
});
