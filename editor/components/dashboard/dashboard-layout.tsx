'use client';

import { useState, useCallback, useMemo, type ReactNode } from 'react';
import {
  ResponsiveGridLayout,
  useContainerWidth,
  type Layout,
} from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import PanelWrapper from './panel-wrapper';
import LayoutToolbar from './layout-toolbar';
import {
  type PanelId,
  type MutableLayout,
  type DashboardLayouts,
  PANEL_DEFINITIONS,
  ALL_PANEL_IDS,
  DASHBOARD_BREAKPOINTS,
  DASHBOARD_COLS,
  DEFAULT_RESPONSIVE_LAYOUTS,
  createResponsiveLayoutsFromLg,
  loadLayouts,
  saveLayouts,
  clearLayout,
  loadVisiblePanels,
  saveVisiblePanels,
} from './panel-registry';
import type { ResponsiveLayouts } from 'react-grid-layout';

interface DashboardLayoutProps {
  panels: Record<PanelId, ReactNode>;
}

const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 } as const;
const COLS = DASHBOARD_COLS;
const ROW_HEIGHT = 30;

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
  visible: Set<PanelId>,
): MutableLayout {
  return layout.filter((item) => visible.has(item.i as PanelId));
}

export default function DashboardLayout({ panels }: DashboardLayoutProps) {
  const { width, containerRef, mounted } = useContainerWidth({
    initialWidth: 1280,
  });

  const [currentLayouts, setCurrentLayouts] = useState<DashboardLayouts>(() => {
    return loadLayouts() ?? cloneResponsiveLayouts(DEFAULT_RESPONSIVE_LAYOUTS);
  });

  const [visiblePanels, setVisiblePanels] = useState<Set<PanelId>>(() => {
    return loadVisiblePanels();
  });

  const [isEditMode, setIsEditMode] = useState(false);

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

  const handleApplyPreset = useCallback((presetLayout: MutableLayout) => {
    const nextLayouts = createResponsiveLayoutsFromLg(cloneLayout(presetLayout));
    setCurrentLayouts(nextLayouts);
    saveLayouts(nextLayouts);
  }, []);

  const handleReset = useCallback(() => {
    clearLayout();
    setCurrentLayouts(cloneResponsiveLayouts(DEFAULT_RESPONSIVE_LAYOUTS));
    const allVisible = new Set(ALL_PANEL_IDS);
    setVisiblePanels(allVisible);
    saveVisiblePanels(allVisible);
  }, []);

  const handleTogglePanel = useCallback(
    (panelId: PanelId) => {
      setVisiblePanels((prev) => {
        const next = new Set(prev);
        if (next.has(panelId)) {
          if (next.size <= 1) return prev;
          next.delete(panelId);
        } else {
          next.add(panelId);
          const def = PANEL_DEFINITIONS[panelId];
          setCurrentLayouts((prevLayouts) => {
            const alreadyInLayout = DASHBOARD_BREAKPOINTS.some((bp) =>
              prevLayouts[bp].some((item) => item.i === panelId),
            );
            if (alreadyInLayout) return prevLayouts;

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
        }
        saveVisiblePanels(next);
        return next;
      });
    },
    [],
  );

  const visibleIds = useMemo(
    () => ALL_PANEL_IDS.filter((id) => visiblePanels.has(id)),
    [visiblePanels],
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

  return (
    <div className='flex-1 flex flex-col min-h-0 h-full overflow-hidden'>
      <div className='flex items-center justify-end px-2 py-1 shrink-0'>
        <LayoutToolbar
          isEditMode={isEditMode}
          onToggleEditMode={handleToggleEditMode}
          onApplyPreset={handleApplyPreset}
          onReset={handleReset}
          visiblePanels={visiblePanels}
          onTogglePanel={handleTogglePanel}
        />
      </div>

      <div ref={containerRef} className='flex-1 min-h-0 overflow-auto'>
        {mounted && (
          <ResponsiveGridLayout
            width={width}
            layouts={layouts}
            breakpoints={BREAKPOINTS}
            cols={COLS}
            rowHeight={ROW_HEIGHT}
            margin={[8, 8] as const}
            containerPadding={[4, 4] as const}
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
