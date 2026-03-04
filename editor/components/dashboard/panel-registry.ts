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
      { i: 'buttons', x: 16, y: 8, w: 8, h: 6, minW: 4, minH: 2},
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
