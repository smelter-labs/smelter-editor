import { describe, expect, it } from 'vitest';
import { OB_PANEL_TURN_CLOSE_MS } from '@smelter-editor/types';
import { ObTurnAggregator } from '../panelTurns';

const T0 = 1_000_000;

const seg = (
  text: string,
  ts: number,
  wallMs: number,
  airAtMs = wallMs + 8_000,
  durationMs = 1_000,
) => ({ text, ts, airAtMs, durationMs, wallMs });

describe('ObTurnAggregator', () => {
  it('stays open while segments keep coming, then closes the joined turn', () => {
    const agg = new ObTurnAggregator();
    agg.push(seg('What do you think', 100, T0));
    agg.push(seg('about the future?', 1_600, T0 + 1_200));
    // Still within the quiet window of the LAST segment.
    expect(agg.poll(T0 + 1_200 + OB_PANEL_TURN_CLOSE_MS - 1)).toBeNull();
    const turn = agg.poll(T0 + 1_200 + OB_PANEL_TURN_CLOSE_MS)!;
    expect(turn.text).toBe('What do you think about the future?');
    // Air-end = max over segments of airAt + duration.
    expect(turn.airEndMs).toBe(T0 + 1_200 + 8_000 + 1_000);
    // The buffer cleared.
    expect(agg.poll(T0 + 60_000)).toBeNull();
  });

  it('orders segments by pts even when they arrive shuffled', () => {
    const agg = new ObTurnAggregator();
    agg.push(seg('television?', 2_000, T0 + 100));
    agg.push(seg('what is', 100, T0 + 200));
    agg.push(seg('the future of', 1_000, T0 + 300));
    const turn = agg.poll(T0 + 300 + OB_PANEL_TURN_CLOSE_MS)!;
    expect(turn.text).toBe('what is the future of television?');
  });

  it('swallows too-short turns (Whisper hallucination guard)', () => {
    const agg = new ObTurnAggregator();
    agg.push(seg('Thanks.', 100, T0));
    expect(agg.poll(T0 + OB_PANEL_TURN_CLOSE_MS + 1)).toBeNull();
    // Single long word without a space is still noise.
    agg.push(seg('Mhmmmhmmmhmm', 200, T0));
    expect(agg.poll(T0 + OB_PANEL_TURN_CLOSE_MS + 1)).toBeNull();
    // And the buffer cleared both times.
    agg.push(seg('a real question then?', 300, T0 + 10_000));
    const turn = agg.poll(T0 + 10_000 + OB_PANEL_TURN_CLOSE_MS)!;
    expect(turn.text).toBe('a real question then?');
  });

  it('ignores empty segments and collapses whitespace', () => {
    const agg = new ObTurnAggregator();
    agg.push(seg('   ', 50, T0));
    agg.push(seg('  spaced   out  ', 100, T0));
    agg.push(seg('words here', 200, T0 + 100));
    const turn = agg.poll(T0 + 100 + OB_PANEL_TURN_CLOSE_MS)!;
    expect(turn.text).toBe('spaced out words here');
  });

  it('reset drops everything', () => {
    const agg = new ObTurnAggregator();
    agg.push(seg('about to be dropped', 100, T0));
    agg.reset();
    expect(agg.poll(T0 + 60_000)).toBeNull();
  });
});
