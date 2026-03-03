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
    minW: 3,
    minH: 3,
  },
  'add-video': {
    id: 'add-video',
    title: 'Add Video',
    minW: 2,
    minH: 2,
  },
  buttons: {
    id: 'buttons',
    title: 'Buttons',
    minW: 2,
    minH: 2,
  },
  streams: { id: 'streams', title: 'Streams', minW: 2, minH: 2 },
  fx: { id: 'fx', title: 'FX', minW: 2, minH: 2 },
  timeline: { id: 'timeline', title: 'Timeline', minW: 4, minH: 2 },
  'block-properties': {
    id: 'block-properties',
    title: 'Block Properties',
    minW: 2,
    minH: 3,
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
      { i: 'video-preview', x: 0, y: 0, w: 8, h: 10, minW: 3, minH: 3 },
      { i: 'add-video', x: 8, y: 0, w: 4, h: 4, minW: 2, minH: 2 },
      { i: 'buttons', x: 8, y: 4, w: 4, h: 3, minW: 2, minH: 2 },
      { i: 'streams', x: 8, y: 7, w: 4, h: 3, minW: 2, minH: 2 },
      { i: 'fx', x: 8, y: 10, w: 4, h: 4, minW: 2, minH: 2 },
      { i: 'timeline', x: 0, y: 10, w: 8, h: 4, minW: 4, minH: 2 },
      { i: 'block-properties', x: 0, y: 14, w: 4, h: 4, minW: 2, minH: 3 },
    ],
  },
  {
    id: 'wide-video',
    label: 'Wide Video',
    layout: [
      { i: 'video-preview', x: 0, y: 0, w: 12, h: 7, minW: 3, minH: 3 },
      { i: 'add-video', x: 0, y: 7, w: 3, h: 5, minW: 2, minH: 2 },
      { i: 'buttons', x: 3, y: 7, w: 3, h: 5, minW: 2, minH: 2 },
      { i: 'streams', x: 6, y: 7, w: 3, h: 5, minW: 2, minH: 2 },
      { i: 'fx', x: 9, y: 7, w: 3, h: 5, minW: 2, minH: 2 },
      { i: 'timeline', x: 0, y: 12, w: 8, h: 4, minW: 4, minH: 2 },
      { i: 'block-properties', x: 8, y: 12, w: 4, h: 4, minW: 2, minH: 3 },
    ],
  },
  {
    id: 'compact',
    label: 'Compact',
    layout: [
      { i: 'video-preview', x: 0, y: 0, w: 12, h: 5, minW: 3, minH: 3 },
      { i: 'add-video', x: 0, y: 5, w: 6, h: 3, minW: 2, minH: 2 },
      { i: 'buttons', x: 6, y: 5, w: 6, h: 3, minW: 2, minH: 2 },
      { i: 'streams', x: 0, y: 8, w: 6, h: 3, minW: 2, minH: 2 },
      { i: 'fx', x: 6, y: 8, w: 6, h: 3, minW: 2, minH: 2 },
      { i: 'timeline', x: 0, y: 11, w: 8, h: 3, minW: 4, minH: 2 },
      { i: 'block-properties', x: 8, y: 11, w: 4, h: 3, minW: 2, minH: 3 },
    ],
  },
  {
    id: 'equal-split',
    label: 'Equal Split',
    layout: [
      { i: 'video-preview', x: 0, y: 0, w: 6, h: 7, minW: 3, minH: 3 },
      { i: 'add-video', x: 6, y: 0, w: 6, h: 3, minW: 2, minH: 2 },
      { i: 'buttons', x: 6, y: 3, w: 3, h: 2, minW: 2, minH: 2 },
      { i: 'streams', x: 9, y: 3, w: 3, h: 2, minW: 2, minH: 2 },
      { i: 'fx', x: 6, y: 5, w: 6, h: 2, minW: 2, minH: 2 },
      { i: 'timeline', x: 0, y: 7, w: 8, h: 4, minW: 4, minH: 2 },
      { i: 'block-properties', x: 8, y: 7, w: 4, h: 4, minW: 2, minH: 3 },
    ],
  },
];

export const DEFAULT_LAYOUT: MutableLayout = LAYOUT_PRESETS[0].layout;

export const SMALL_LAYOUT: MutableLayout = [
  { i: 'video-preview', x: 0, y: 0, w: 6, h: 5, minW: 2, minH: 2 },
  { i: 'add-video', x: 0, y: 5, w: 6, h: 3, minW: 2, minH: 2 },
  { i: 'buttons', x: 0, y: 8, w: 6, h: 2, minW: 2, minH: 2 },
  { i: 'streams', x: 0, y: 10, w: 6, h: 3, minW: 2, minH: 2 },
  { i: 'fx', x: 0, y: 13, w: 6, h: 3, minW: 2, minH: 2 },
  { i: 'timeline', x: 0, y: 16, w: 6, h: 3, minW: 2, minH: 2 },
  { i: 'block-properties', x: 0, y: 19, w: 6, h: 3, minW: 2, minH: 3 },
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

export function loadLayout(): MutableLayout | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as MutableLayout;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const ids = new Set(parsed.map((item) => item.i));
    const allPresent = ALL_PANEL_IDS.every((id) => ids.has(id));
    if (!allPresent) return null;
    return normalizeLayout(parsed);
  } catch {
    return null;
  }
}

export function saveLayout(layout: MutableLayout): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeLayout(layout)));
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
