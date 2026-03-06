import type { LayoutItem } from 'react-grid-layout';

export type PanelId =
  | 'video-preview'
  | 'add-video'
  | 'buttons'
  | 'streams'
  | 'fx'
  | 'timeline'
  | 'block-properties';

export type MutableLayout = LayoutItem[];
export type DashboardBreakpoint = 'lg' | 'md' | 'sm' | 'xs' | 'xxs';
export type DashboardLayouts = Record<DashboardBreakpoint, MutableLayout>;

export const DASHBOARD_BREAKPOINTS: DashboardBreakpoint[] = [
  'lg',
  'md',
  'sm',
  'xs',
  'xxs',
];

export const DASHBOARD_COLS: Record<DashboardBreakpoint, number> = {
  lg: 24,
  md: 20,
  sm: 12,
  xs: 8,
  xxs: 4,
};

export interface PanelDefinition {
  id: PanelId;
  title: string;
  minW: number;
  minH: number;
}

export const PANEL_DEFINITIONS: Record<PanelId, PanelDefinition> = {
  'video-preview': {
    id: 'video-preview',
    title: 'Video Preview',
    minW: 6,
    minH: 6,
  },
  'add-video': {
    id: 'add-video',
    title: 'Add Video',
    minW: 4,
    minH: 4,
  },
  buttons: {
    id: 'buttons',
    title: 'Buttons',
    minW: 4,
    minH: 4,
  },
  streams: { id: 'streams', title: 'Streams', minW: 4, minH: 4 },
  fx: { id: 'fx', title: 'FX', minW: 4, minH: 4 },
  timeline: { id: 'timeline', title: 'Timeline', minW: 8, minH: 4 },
  'block-properties': {
    id: 'block-properties',
    title: 'Block Properties',
    minW: 4,
    minH: 6,
  },
};

export const ALL_PANEL_IDS: PanelId[] = Object.keys(
  PANEL_DEFINITIONS,
) as PanelId[];

export interface LayoutPreset {
  id: string;
  label: string;
  layout: MutableLayout;
}

export const LAYOUT_PRESETS: LayoutPreset[] = [
  {
    id: 'default',
    label: 'Default',
    layout: [
      { i: 'video-preview', x: 0, y: 0, w: 16, h: 20, minW: 6, minH: 6 },
      { i: 'add-video', x: 16, y: 0, w: 8, h: 8, minW: 4, minH: 4 },
      { i: 'buttons', x: 16, y: 8, w: 8, h: 6, minW: 4, minH: 2 },
      { i: 'streams', x: 16, y: 14, w: 8, h: 6, minW: 4, minH: 4 },
      { i: 'fx', x: 16, y: 20, w: 8, h: 8, minW: 4, minH: 4 },
      { i: 'timeline', x: 0, y: 20, w: 16, h: 8, minW: 8, minH: 4 },
      { i: 'block-properties', x: 0, y: 28, w: 8, h: 8, minW: 4, minH: 6 },
    ],
  },
  {
    id: 'wide-video',
    label: 'Wide Video',
    layout: [
      { i: 'video-preview', x: 0, y: 0, w: 24, h: 14, minW: 6, minH: 6 },
      { i: 'add-video', x: 0, y: 14, w: 6, h: 10, minW: 4, minH: 4 },
      { i: 'buttons', x: 6, y: 14, w: 6, h: 10, minW: 4, minH: 2 },
      { i: 'streams', x: 12, y: 14, w: 6, h: 10, minW: 4, minH: 4 },
      { i: 'fx', x: 18, y: 14, w: 6, h: 10, minW: 4, minH: 4 },
      { i: 'timeline', x: 0, y: 24, w: 16, h: 8, minW: 8, minH: 4 },
      { i: 'block-properties', x: 16, y: 24, w: 8, h: 8, minW: 4, minH: 6 },
    ],
  },
  {
    id: 'compact',
    label: 'Compact',
    layout: [
      { i: 'video-preview', x: 0, y: 0, w: 24, h: 10, minW: 6, minH: 6 },
      { i: 'add-video', x: 0, y: 10, w: 12, h: 6, minW: 4, minH: 4 },
      { i: 'buttons', x: 12, y: 10, w: 12, h: 6, minW: 4, minH: 2 },
      { i: 'streams', x: 0, y: 16, w: 12, h: 6, minW: 4, minH: 4 },
      { i: 'fx', x: 12, y: 16, w: 12, h: 6, minW: 4, minH: 4 },
      { i: 'timeline', x: 0, y: 22, w: 16, h: 6, minW: 8, minH: 4 },
      { i: 'block-properties', x: 16, y: 22, w: 8, h: 6, minW: 4, minH: 6 },
    ],
  },
  {
    id: 'equal-split',
    label: 'Equal Split',
    layout: [
      { i: 'video-preview', x: 0, y: 0, w: 12, h: 14, minW: 6, minH: 6 },
      { i: 'add-video', x: 12, y: 0, w: 12, h: 6, minW: 4, minH: 4 },
      { i: 'buttons', x: 12, y: 6, w: 6, h: 4, minW: 4, minH: 4 },
      { i: 'streams', x: 18, y: 6, w: 6, h: 4, minW: 4, minH: 4 },
      { i: 'fx', x: 12, y: 10, w: 12, h: 4, minW: 4, minH: 4 },
      { i: 'timeline', x: 0, y: 14, w: 16, h: 8, minW: 8, minH: 4 },
      { i: 'block-properties', x: 16, y: 14, w: 8, h: 8, minW: 4, minH: 6 },
    ],
  },
  {
    id: 'vertical-video',
    label: 'Vertical Video',
    layout: [
      { i: 'video-preview', x: 0, y: 0, w: 8, h: 28, minW: 6, minH: 6 },
      { i: 'add-video', x: 8, y: 0, w: 8, h: 8, minW: 4, minH: 4 },
      { i: 'buttons', x: 16, y: 0, w: 8, h: 8, minW: 4, minH: 2 },
      { i: 'streams', x: 8, y: 8, w: 8, h: 8, minW: 4, minH: 4 },
      { i: 'fx', x: 16, y: 8, w: 8, h: 8, minW: 4, minH: 4 },
      { i: 'timeline', x: 8, y: 16, w: 16, h: 6, minW: 8, minH: 4 },
      { i: 'block-properties', x: 8, y: 22, w: 8, h: 6, minW: 4, minH: 6 },
    ],
  },
];

export const DEFAULT_LAYOUT: MutableLayout = LAYOUT_PRESETS[0].layout;

export const SMALL_LAYOUT: MutableLayout = [
  { i: 'video-preview', x: 0, y: 0, w: 12, h: 10, minW: 4, minH: 4 },
  { i: 'add-video', x: 0, y: 10, w: 12, h: 6, minW: 4, minH: 4 },
  { i: 'buttons', x: 0, y: 16, w: 12, h: 4, minW: 4, minH: 2 },
  { i: 'streams', x: 0, y: 20, w: 12, h: 6, minW: 4, minH: 4 },
  { i: 'fx', x: 0, y: 26, w: 12, h: 6, minW: 4, minH: 4 },
  { i: 'timeline', x: 0, y: 32, w: 12, h: 6, minW: 4, minH: 4 },
  { i: 'block-properties', x: 0, y: 38, w: 12, h: 6, minW: 4, minH: 6 },
];

const STORAGE_KEY = 'smelter-dashboard-layout';

function normalizeLayoutItem(item: LayoutItem): LayoutItem {
  return {
    i: item.i,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
    minW: item.minW,
    minH: item.minH,
    maxW: item.maxW,
    maxH: item.maxH,
  };
}

function normalizeLayout(layout: MutableLayout): MutableLayout {
  return layout.map(normalizeLayoutItem);
}

function scaleLayoutToCols(layout: MutableLayout, cols: number): MutableLayout {
  const baseCols = DASHBOARD_COLS.lg;

  return normalizeLayout(
    layout.map((item) => {
      const scaledMinW = Math.min(
        cols,
        Math.max(1, Math.round(((item.minW ?? 1) / baseCols) * cols)),
      );
      const scaledW = Math.min(
        cols,
        Math.max(
          scaledMinW,
          Math.round((item.w / baseCols) * cols) || scaledMinW,
        ),
      );
      const scaledX = Math.min(
        Math.max(0, Math.round((item.x / baseCols) * cols)),
        Math.max(0, cols - scaledW),
      );

      return {
        ...item,
        x: scaledX,
        w: scaledW,
        minW: scaledMinW,
        maxW: item.maxW ? Math.min(cols, item.maxW) : undefined,
      };
    }),
  );
}

export function createResponsiveLayoutsFromLg(
  lgLayout: MutableLayout,
): DashboardLayouts {
  return {
    lg: normalizeLayout(lgLayout),
    md: scaleLayoutToCols(lgLayout, DASHBOARD_COLS.md),
    sm: scaleLayoutToCols(SMALL_LAYOUT, DASHBOARD_COLS.sm),
    xs: scaleLayoutToCols(SMALL_LAYOUT, DASHBOARD_COLS.xs),
    xxs: scaleLayoutToCols(SMALL_LAYOUT, DASHBOARD_COLS.xxs),
  };
}

export const DEFAULT_RESPONSIVE_LAYOUTS: DashboardLayouts =
  createResponsiveLayoutsFromLg(DEFAULT_LAYOUT);

function isLayoutArray(layout: unknown): layout is MutableLayout {
  return (
    Array.isArray(layout) &&
    layout.length > 0 &&
    layout.every((item) => item && typeof item === 'object' && 'i' in item)
  );
}

function ensureAllPanels(layout: MutableLayout, cols: number): MutableLayout {
  const ids = new Set(layout.map((item) => item.i));
  const maxY = layout.reduce((max, item) => Math.max(max, item.y + item.h), 0);

  for (const panelId of ALL_PANEL_IDS) {
    if (!ids.has(panelId)) {
      const def = PANEL_DEFINITIONS[panelId];
      layout.push({
        i: panelId,
        x: 0,
        y: maxY,
        w: Math.min(cols, def.minW + 4),
        h: def.minH + 2,
        minW: Math.min(cols, def.minW),
        minH: def.minH,
      });
    }
  }

  return layout.filter((item) => ALL_PANEL_IDS.includes(item.i as PanelId));
}

export function loadLayouts(): DashboardLayouts | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as DashboardLayouts | MutableLayout;

    if (Array.isArray(parsed) && isLayoutArray(parsed)) {
      const patched = ensureAllPanels(
        normalizeLayout(parsed),
        DASHBOARD_COLS.lg,
      );
      return createResponsiveLayoutsFromLg(patched);
    }

    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const layouts = {} as DashboardLayouts;
    let anyValid = false;
    for (const breakpoint of DASHBOARD_BREAKPOINTS) {
      const layout = parsed[breakpoint as keyof typeof parsed];
      if (!isLayoutArray(layout)) {
        return null;
      }
      layouts[breakpoint] = ensureAllPanels(
        normalizeLayout(layout),
        DASHBOARD_COLS[breakpoint],
      );
      anyValid = true;
    }

    return anyValid ? layouts : null;
  } catch {
    return null;
  }
}

export function saveLayouts(layouts: DashboardLayouts): void {
  if (typeof window === 'undefined') return;
  try {
    const normalized = DASHBOARD_BREAKPOINTS.reduce((acc, breakpoint) => {
      acc[breakpoint] = normalizeLayout(layouts[breakpoint]);
      return acc;
    }, {} as DashboardLayouts);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // localStorage full or unavailable
  }
}

export function clearLayout(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}

const VISIBLE_PANELS_KEY = 'smelter-dashboard-visible-panels';

export function loadVisiblePanels(): Set<PanelId> {
  if (typeof window === 'undefined') return new Set(ALL_PANEL_IDS);
  try {
    const stored = localStorage.getItem(VISIBLE_PANELS_KEY);
    if (!stored) return new Set(ALL_PANEL_IDS);
    const parsed = JSON.parse(stored) as string[];
    if (!Array.isArray(parsed)) return new Set(ALL_PANEL_IDS);
    const valid = parsed.filter((id) =>
      ALL_PANEL_IDS.includes(id as PanelId),
    ) as PanelId[];
    return new Set(valid.length > 0 ? valid : ALL_PANEL_IDS);
  } catch {
    return new Set(ALL_PANEL_IDS);
  }
}

export function saveVisiblePanels(ids: Set<PanelId>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(VISIBLE_PANELS_KEY, JSON.stringify([...ids]));
  } catch {
    // localStorage full or unavailable
  }
}
