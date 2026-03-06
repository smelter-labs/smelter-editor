import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LAYOUT,
  ALL_PANEL_IDS,
  createResponsiveLayoutsFromLg,
  loadLayouts,
  saveLayouts,
  clearLayout,
} from '../panel-registry';

function createLocalStorageMock() {
  const store = new Map<string, string>();

  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
  };
}

describe('panel-registry layout persistence', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', createLocalStorageMock());
  });

  it('saves and restores layouts for every breakpoint', () => {
    const layouts = createResponsiveLayoutsFromLg(DEFAULT_LAYOUT);
    layouts.sm[0].x = 3;
    layouts.xs[0].w = 6;

    saveLayouts(layouts);
    const restored = loadLayouts();

    expect(restored).not.toBeNull();
    expect(restored?.lg).toEqual(layouts.lg);
    expect(restored?.sm).toEqual(layouts.sm);
    expect(restored?.xs).toEqual(layouts.xs);
    expect(restored?.xxs).toEqual(layouts.xxs);
  });

  it('migrates legacy single-layout storage into responsive layouts', () => {
    localStorage.setItem(
      'smelter-dashboard-layout',
      JSON.stringify(DEFAULT_LAYOUT),
    );

    const restored = loadLayouts();

    expect(restored).not.toBeNull();
    expect(restored?.lg).toEqual(DEFAULT_LAYOUT);
    expect(restored?.md.length).toBeGreaterThan(0);
    expect(restored?.sm.length).toBeGreaterThan(0);
  });

  it('clears persisted layouts', () => {
    saveLayouts(createResponsiveLayoutsFromLg(DEFAULT_LAYOUT));

    clearLayout();

    expect(localStorage.removeItem).toHaveBeenCalledWith(
      'smelter-dashboard-layout',
    );
    expect(loadLayouts()).toBeNull();
  });

  it('adds missing panels instead of rejecting saved layout', () => {
    const incomplete = DEFAULT_LAYOUT.filter((item) => item.i !== 'fx');
    localStorage.setItem(
      'smelter-dashboard-layout',
      JSON.stringify(incomplete),
    );

    const restored = loadLayouts();

    expect(restored).not.toBeNull();
    const lgIds = new Set(restored!.lg.map((item) => item.i));
    for (const id of ALL_PANEL_IDS) {
      expect(lgIds.has(id)).toBe(true);
    }
  });

  it('removes panels that no longer exist in the registry', () => {
    const withExtra = [
      ...DEFAULT_LAYOUT,
      { i: 'obsolete-panel', x: 0, y: 50, w: 4, h: 4, minW: 2, minH: 2 },
    ];
    localStorage.setItem('smelter-dashboard-layout', JSON.stringify(withExtra));

    const restored = loadLayouts();

    expect(restored).not.toBeNull();
    const lgIds = restored!.lg.map((item) => item.i);
    expect(lgIds).not.toContain('obsolete-panel');
  });
});
