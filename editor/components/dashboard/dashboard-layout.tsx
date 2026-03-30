'use client';

import {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { useDashboardToolbarRegister } from './dashboard-toolbar-context';
import {
  ResponsiveGridLayout,
  useContainerWidth,
  type Layout,
} from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import PanelWrapper from './panel-wrapper';
import {
  type PanelDefinition,
  type MutableLayout,
  type DashboardLayouts,
  STATIC_PANEL_IDS,
  DASHBOARD_BREAKPOINTS,
  DASHBOARD_BREAKPOINT_WIDTHS,
  DASHBOARD_COLS,
  DEFAULT_RESPONSIVE_LAYOUTS,
  MOTION_PANEL_MIN_W,
  MOTION_PANEL_MIN_H,
  LAYOUT_PRESETS,
  createResponsiveLayoutsFromLg,
  loadLayouts,
  saveLayouts,
  clearLayout,
  loadVisiblePanels,
  saveVisiblePanels,
} from './panel-registry';
import type { ResponsiveLayouts } from 'react-grid-layout';
import { useActions } from '@/components/control-panel/contexts/actions-context';

export type DashboardLayoutSavedData = {
  layouts: DashboardLayouts;
  visiblePanels: string[];
};

interface DashboardLayoutProps {
  panels: Record<string, ReactNode>;
  allPanelIds: string[];
  getPanelDefinition: (id: string) => PanelDefinition;
  videoAspectRatio?: number;
}

const BREAKPOINTS = DASHBOARD_BREAKPOINT_WIDTHS;
const COLS = DASHBOARD_COLS;
const ROW_HEIGHT = 30;
const MARGIN: readonly [number, number] = [8, 8];
const CONTAINER_PADDING: readonly [number, number] = [4, 4];
const VIDEO_PANEL_ID = 'video-preview';
const RESIZE_DEBOUNCE_MS = 300;

function getActiveBreakpoint(containerWidth: number): keyof typeof COLS {
  for (const bp of DASHBOARD_BREAKPOINTS) {
    if (containerWidth >= BREAKPOINTS[bp]) return bp;
  }
  return 'xxs';
}

function calcVideoHeight(
  containerWidth: number,
  videoPanelW: number,
  cols: number,
  ratio: number,
): number {
  const colWidth =
    (containerWidth - 2 * CONTAINER_PADDING[0] - MARGIN[0] * (cols - 1)) / cols;
  const panelPixelWidth =
    videoPanelW * colWidth + (videoPanelW - 1) * MARGIN[0];
  const targetPixelHeight = panelPixelWidth / ratio;
  return Math.max(
    1,
    Math.round((targetPixelHeight + MARGIN[1]) / (ROW_HEIGHT + MARGIN[1])),
  );
}

function toMutable(layout: Layout): MutableLayout {
  return layout.map((item) => ({
    i: item.i,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
    minW: item.minW,
    minH: item.minH,
    maxW: item.maxW,
    maxH: item.maxH,
  }));
}

function cloneLayout(layout: MutableLayout): MutableLayout {
  return layout.map((item) => ({
    i: item.i,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
    minW: item.minW,
    minH: item.minH,
    maxW: item.maxW,
    maxH: item.maxH,
  }));
}

function cloneResponsiveLayouts(layouts: DashboardLayouts): DashboardLayouts {
  return DASHBOARD_BREAKPOINTS.reduce((acc, breakpoint) => {
    acc[breakpoint] = cloneLayout(layouts[breakpoint]);
    return acc;
  }, {} as DashboardLayouts);
}

function filterLayout(
  layout: MutableLayout,
  visible: Set<string>,
): MutableLayout {
  return layout.filter((item) => visible.has(item.i));
}

export default function DashboardLayout({
  panels,
  allPanelIds,
  getPanelDefinition,
  videoAspectRatio,
}: DashboardLayoutProps) {
  const { dashboardLayoutStorage } = useActions();
  const { width, containerRef, mounted } = useContainerWidth({
    initialWidth: 1280,
  });

  const [currentLayouts, setCurrentLayouts] = useState<DashboardLayouts>(() => {
    return loadLayouts() ?? cloneResponsiveLayouts(DEFAULT_RESPONSIVE_LAYOUTS);
  });

  const [visiblePanels, setVisiblePanels] = useState<Set<string>>(() => {
    return loadVisiblePanels();
  });

  const [isEditMode, setIsEditMode] = useState(false);

  const prevPanelIdsRef = useRef<string[]>(allPanelIds);

  useEffect(() => {
    const prevIds = new Set(prevPanelIdsRef.current);
    const currentIds = new Set(allPanelIds);
    prevPanelIdsRef.current = allPanelIds;

    const newIds = allPanelIds.filter((id) => !prevIds.has(id));
    if (newIds.length === 0) return;

    setVisiblePanels((prev) => {
      const next = new Set(prev);
      for (const id of newIds) {
        next.add(id);
      }
      saveVisiblePanels(next);
      return next;
    });

    setCurrentLayouts((prevLayouts) => {
      const updated = { ...prevLayouts } as DashboardLayouts;
      let changed = false;

      for (const id of newIds) {
        const alreadyInLayout = DASHBOARD_BREAKPOINTS.some((bp) =>
          prevLayouts[bp].some((item) => item.i === id),
        );
        if (alreadyInLayout) continue;
        changed = true;

        for (const breakpoint of DASHBOARD_BREAKPOINTS) {
          const breakpointLayout = updated[breakpoint];
          const maxY = breakpointLayout.reduce(
            (max, item) => Math.max(max, item.y + item.h),
            0,
          );
          updated[breakpoint] = [
            ...breakpointLayout,
            {
              i: id,
              x: 0,
              y: maxY,
              w: Math.min(COLS[breakpoint], MOTION_PANEL_MIN_W + 4),
              h: MOTION_PANEL_MIN_H + 2,
              minW: Math.min(COLS[breakpoint], MOTION_PANEL_MIN_W),
              minH: MOTION_PANEL_MIN_H,
            },
          ];
        }
      }

      if (changed) {
        saveLayouts(updated);
      }
      return changed ? updated : prevLayouts;
    });
  }, [allPanelIds]);

  const mergeHiddenItems = useCallback(
    (layout: Layout, previousLayout: MutableLayout): MutableLayout => {
      const mutable = toMutable(layout);
      const hiddenItems = previousLayout.filter(
        (item) => !layout.some((nextItem) => nextItem.i === item.i),
      );
      return [...mutable, ...hiddenItems];
    },
    [],
  );

  const handleLayoutChange = useCallback(
    (_layout: Layout, allLayouts: ResponsiveLayouts) => {
      setCurrentLayouts((prev) => {
        const next = { ...prev } as DashboardLayouts;

        for (const breakpoint of DASHBOARD_BREAKPOINTS) {
          const nextLayout = allLayouts[breakpoint];
          if (nextLayout) {
            next[breakpoint] = mergeHiddenItems(nextLayout, prev[breakpoint]);
          }
        }

        saveLayouts(next);
        return next;
      });
    },
    [mergeHiddenItems],
  );

  const handleToggleEditMode = useCallback(() => {
    setIsEditMode((prev) => !prev);
  }, []);

  const handleApplyPreset = useCallback(
    (presetLayout: MutableLayout) => {
      const currentMotionItems = currentLayouts.lg.filter((item) =>
        allPanelIds.includes(item.i),
      );
      const motionItems = currentMotionItems.filter(
        (item) => !STATIC_PANEL_IDS.includes(item.i as never),
      );
      const presetWithMotion = [...cloneLayout(presetLayout), ...motionItems];
      const nextLayouts = createResponsiveLayoutsFromLg(presetWithMotion);
      setCurrentLayouts(nextLayouts);
      saveLayouts(nextLayouts);
    },
    [currentLayouts, allPanelIds],
  );

  const handleReset = useCallback(() => {
    clearLayout();
    setCurrentLayouts(cloneResponsiveLayouts(DEFAULT_RESPONSIVE_LAYOUTS));
    const allVisible = new Set<string>(STATIC_PANEL_IDS);
    for (const id of allPanelIds) {
      allVisible.add(id);
    }
    setVisiblePanels(allVisible);
    saveVisiblePanels(allVisible);
  }, [allPanelIds]);

  const getCurrentLayoutData = useCallback((): DashboardLayoutSavedData => {
    return {
      layouts: currentLayouts,
      visiblePanels: [...visiblePanels],
    };
  }, [currentLayouts, visiblePanels]);

  const handleApplyLoadedLayout = useCallback(
    (data: DashboardLayoutSavedData) => {
      const loaded = data as DashboardLayoutSavedData;
      if (loaded.layouts) {
        setCurrentLayouts(loaded.layouts);
        saveLayouts(loaded.layouts);
      }
      if (loaded.visiblePanels) {
        const newVisible = new Set(loaded.visiblePanels);
        setVisiblePanels(newVisible);
        saveVisiblePanels(newVisible);
      }
    },
    [],
  );

  const handleTogglePanel = useCallback(
    (panelId: string) => {
      setVisiblePanels((prev) => {
        const next = new Set(prev);
        if (next.has(panelId)) {
          if (next.size <= 1) return prev;
          next.delete(panelId);
        } else {
          next.add(panelId);
        }
        saveVisiblePanels(next);
        return next;
      });

      setCurrentLayouts((prevLayouts) => {
        const alreadyInLayout = DASHBOARD_BREAKPOINTS.some((bp) =>
          prevLayouts[bp].some((item) => item.i === panelId),
        );
        if (alreadyInLayout) return prevLayouts;

        const def = getPanelDefinition(panelId);
        const updated = { ...prevLayouts } as DashboardLayouts;
        for (const breakpoint of DASHBOARD_BREAKPOINTS) {
          const breakpointLayout = prevLayouts[breakpoint];
          const maxY = breakpointLayout.reduce(
            (max, item) => Math.max(max, item.y + item.h),
            0,
          );
          updated[breakpoint] = [
            ...breakpointLayout,
            {
              i: panelId,
              x: 0,
              y: maxY,
              w: Math.min(COLS[breakpoint], def.minW + 4),
              h: def.minH + 2,
              minW: Math.min(COLS[breakpoint], def.minW),
              minH: def.minH,
            },
          ];
        }
        saveLayouts(updated);
        return updated;
      });
    },
    [getPanelDefinition],
  );

  const { register, unregister } = useDashboardToolbarRegister();

  useEffect(() => {
    register({
      isEditMode,
      toggleEditMode: handleToggleEditMode,
      presets: LAYOUT_PRESETS,
      applyPreset: handleApplyPreset,
      reset: handleReset,
      allPanelIds,
      visiblePanels,
      togglePanel: handleTogglePanel,
      getPanelDefinition,
      dashboardLayoutStorage,
      getCurrentLayoutData,
      applyLoadedLayout: handleApplyLoadedLayout,
    });
    return () => unregister();
  }, [
    isEditMode,
    allPanelIds,
    visiblePanels,
    handleApplyPreset,
    handleReset,
    handleTogglePanel,
    getPanelDefinition,
    dashboardLayoutStorage,
    getCurrentLayoutData,
    handleApplyLoadedLayout,
    register,
    unregister,
    handleToggleEditMode,
  ]);

  const visibleIds = useMemo(
    () => allPanelIds.filter((id) => visiblePanels.has(id)),
    [allPanelIds, visiblePanels],
  );

  const layouts = useMemo<ResponsiveLayouts>(
    () =>
      DASHBOARD_BREAKPOINTS.reduce((acc, breakpoint) => {
        acc[breakpoint] = filterLayout(
          cloneLayout(currentLayouts[breakpoint]),
          visiblePanels,
        );
        return acc;
      }, {} as ResponsiveLayouts),
    [currentLayouts, visiblePanels],
  );

  useEffect(() => {
    if (!videoAspectRatio || !mounted) return;

    const timer = setTimeout(() => {
      const bp = getActiveBreakpoint(width);
      const cols = COLS[bp];

      setCurrentLayouts((prev) => {
        const layout = prev[bp];
        const videoItem = layout.find((item) => item.i === VIDEO_PANEL_ID);
        if (!videoItem) return prev;

        const targetH = calcVideoHeight(
          width,
          videoItem.w,
          cols,
          videoAspectRatio,
        );
        if (targetH === videoItem.h) return prev;

        const updated = { ...prev } as DashboardLayouts;
        for (const breakpoint of DASHBOARD_BREAKPOINTS) {
          const bpCols = COLS[breakpoint];
          updated[breakpoint] = prev[breakpoint].map((item) => {
            if (item.i !== VIDEO_PANEL_ID) return item;
            const h = calcVideoHeight(width, item.w, bpCols, videoAspectRatio);
            return { ...item, h };
          });
        }
        saveLayouts(updated);
        return updated;
      });
    }, RESIZE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [width, videoAspectRatio, mounted]);

  return (
    <div className='flex-1 flex flex-col min-h-0 h-full overflow-hidden'>
      <div ref={containerRef} className='flex-1 min-h-0 overflow-auto'>
        {mounted && (
          <ResponsiveGridLayout
            width={width}
            layouts={layouts}
            breakpoints={BREAKPOINTS}
            cols={COLS}
            rowHeight={ROW_HEIGHT}
            margin={MARGIN}
            containerPadding={CONTAINER_PADDING}
            dragConfig={{
              enabled: isEditMode,
              handle: '.dashboard-drag-handle',
              threshold: 3,
              bounded: false,
            }}
            resizeConfig={{
              enabled: isEditMode,
              handles: ['se', 's', 'e'] as const,
            }}
            onLayoutChange={handleLayoutChange}
            autoSize>
            {visibleIds.map((panelId) => (
              <PanelWrapper
                key={panelId}
                panelId={panelId}
                panelDefinition={getPanelDefinition(panelId)}
                isEditMode={isEditMode}
                panelContent={panels[panelId]}>
                {null}
              </PanelWrapper>
            ))}
          </ResponsiveGridLayout>
        )}
      </div>
    </div>
  );
}
