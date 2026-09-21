import { describe, expect, it } from 'vitest';
import { changedSections } from '../live-config-diff';

describe('changedSections', () => {
  const base = {
    perf: { hudHz: 10 },
    director: { zoom: 'normal', lookAheadMs: 500 },
    minimap: true,
    replay: true,
  };

  it('is empty when nothing changed', () => {
    expect(changedSections(base, structuredClone(base))).toEqual({});
  });

  it('carries only the section the host touched', () => {
    const next = { ...base, director: { zoom: 'tight', lookAheadMs: 500 } };
    // `minimap` / `replay` stay out: the moderator may have toggled them.
    expect(changedSections(base, next)).toEqual({
      director: { zoom: 'tight', lookAheadMs: 500 },
    });
  });

  it('carries a toggled flag', () => {
    expect(changedSections(base, { ...base, replay: false })).toEqual({
      replay: false,
    });
  });
});
