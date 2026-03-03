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
  ALL_PANEL_IDS,
  DEFAULT_LAYOUT,
  SMALL_LAYOUT,
  PANEL_DEFINITIONS,
  loadLayout,
  saveLayout,
  clearLayout,
  loadVisiblePanels,
  saveVisiblePanels,
} from './panel-registry';
import type { ResponsiveLayouts } from 'react-grid-layout';

interface DashboardLayoutProps {
  panels: Record<PanelId, ReactNode>;
}

const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 } as const;
const COLS = { lg: 24, md: 20, sm: 12, xs: 8, xxs: 4 } as const;
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

  const [currentLayout, setCurrentLayout] = useState<MutableLayout>(() => {
    return loadLayout() ?? cloneLayout(DEFAULT_LAYOUT);
  });

  const [visiblePanels, setVisiblePanels] = useState<Set<PanelId>>(() => {
    return loadVisiblePanels();
  });

  const [isEditMode, setIsEditMode] = useState(false);

  const handleLayoutChange = useCallback(
    (_layout: Layout, allLayouts: ResponsiveLayouts) => {
      const lgLayout = allLayouts.lg;
      if (lgLayout) {
        const mutable = toMutable(lgLayout);
        setCurrentLayout((prev) => {
          const hiddenItems = prev.filter(
            (item) => !lgLayout.some((l) => l.i === item.i),
          );
          const merged = [...mutable, ...hiddenItems];
          saveLayout(merged);
          return merged;
        });
      }
    },
    [],
  );

  const handleToggleEditMode = useCallback(() => {
    setIsEditMode((prev) => !prev);
  }, []);

  const handleApplyPreset = useCallback((presetLayout: MutableLayout) => {
    const copy = cloneLayout(presetLayout);
    setCurrentLayout(copy);
    saveLayout(copy);
  }, []);

  const handleReset = useCallback(() => {
    clearLayout();
    setCurrentLayout(cloneLayout(DEFAULT_LAYOUT));
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
          const alreadyInLayout = currentLayout.some(
            (item) => item.i === panelId,
          );
          if (!alreadyInLayout) {
            const def = PANEL_DEFINITIONS[panelId];
            const maxY = currentLayout.reduce(
              (max, item) => Math.max(max, item.y + item.h),
              0,
            );
            const newItem = {
              i: panelId,
              x: 0,
              y: maxY,
              w: def.minW + 4,
              h: def.minH + 2,
              minW: def.minW,
              minH: def.minH,
            };
            setCurrentLayout((prevLayout) => {
              const updated = [...prevLayout, newItem];
              saveLayout(updated);
              return updated;
            });
          }
        }
        saveVisiblePanels(next);
        return next;
      });
    },
    [currentLayout],
  );

  const visibleIds = useMemo(
    () => ALL_PANEL_IDS.filter((id) => visiblePanels.has(id)),
    [visiblePanels],
  );

  const layouts = useMemo<ResponsiveLayouts>(
    () => ({
      lg: filterLayout(cloneLayout(currentLayout), visiblePanels),
      sm: filterLayout(cloneLayout(SMALL_LAYOUT), visiblePanels),
      xs: filterLayout(cloneLayout(SMALL_LAYOUT), visiblePanels),
      xxs: filterLayout(cloneLayout(SMALL_LAYOUT), visiblePanels),
    }),
    [currentLayout, visiblePanels],
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
