'use client';

import { useState, useCallback, useMemo, type ReactNode } from 'react';
import {
  ResponsiveGridLayout,
  useContainerWidth,
  type Layout,
} from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import PanelWrapper from './panel-wrapper';
import LayoutToolbar from './layout-toolbar';
import {
  type PanelId,
  type MutableLayout,
  ALL_PANEL_IDS,
  DEFAULT_LAYOUT,
  SMALL_LAYOUT,
  loadLayout,
  saveLayout,
  clearLayout,
} from './panel-registry';
import type { ResponsiveLayouts } from 'react-grid-layout';

interface DashboardLayoutProps {
  panels: Record<PanelId, ReactNode>;
}

const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 } as const;
const COLS = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 } as const;
const ROW_HEIGHT = 60;

function toMutable(layout: Layout): MutableLayout {
  return layout.map((item) => ({ ...item }));
}

function cloneLayout(layout: MutableLayout): MutableLayout {
  return layout.map((item) => ({ ...item }));
}

export default function DashboardLayout({ panels }: DashboardLayoutProps) {
  const { width, containerRef, mounted } = useContainerWidth({
    initialWidth: 1280,
  });

  const [currentLayout, setCurrentLayout] = useState<MutableLayout>(() => {
    return loadLayout() ?? cloneLayout(DEFAULT_LAYOUT);
  });

  const [isEditMode, setIsEditMode] = useState(false);

  const handleLayoutChange = useCallback(
    (_layout: Layout, allLayouts: ResponsiveLayouts) => {
      const lgLayout = allLayouts.lg;
      if (lgLayout) {
        const mutable = toMutable(lgLayout);
        setCurrentLayout(mutable);
        saveLayout(mutable);
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
  }, []);

  const layouts = useMemo<ResponsiveLayouts>(
    () => ({
      lg: currentLayout,
      sm: cloneLayout(SMALL_LAYOUT),
      xs: cloneLayout(SMALL_LAYOUT),
      xxs: cloneLayout(SMALL_LAYOUT),
    }),
    [currentLayout],
  );

  return (
    <div className='flex-1 flex flex-col min-h-0 h-full overflow-hidden'>
      <div className='flex items-center justify-end px-2 py-1 shrink-0'>
        <LayoutToolbar
          isEditMode={isEditMode}
          onToggleEditMode={handleToggleEditMode}
          onApplyPreset={handleApplyPreset}
          onReset={handleReset}
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
            {ALL_PANEL_IDS.map((panelId) => (
              <PanelWrapper
                key={panelId}
                panelId={panelId}
                isEditMode={isEditMode}>
                {panels[panelId]}
              </PanelWrapper>
            ))}
          </ResponsiveGridLayout>
        )}
      </div>
    </div>
  );
}
