'use client';

import React from 'react';
import type { ObSignalSummary, ObState } from '@smelter-editor/types';
import { OB } from '../ob-kit';
import { ProgramMonitor } from '../program-monitor';
import { PreviewSlate } from './preview-slate';

/**
 * PROGRAM (the room's WHEP output, red frame, audio off by default — a
 * panel next to the stage would feed back) beside the PREVIEW slate (green
 * frame, same 16:9 size). Stacked on narrow screens.
 */
export function MonitorRow({
  state,
  signals,
  clockOffsetMs,
  whepUrl,
  desk,
}: {
  state: ObState;
  signals: Record<string, ObSignalSummary>;
  clockOffsetMs: number;
  whepUrl: string | null;
  desk: boolean;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: desk ? 'repeat(2, minmax(0, 1fr))' : '1fr',
        gap: desk ? 12 : 10,
        width: '100%',
        // On the desk the monitors shrink with the window height so the
        // buses, keys and bars stay above the fold (1024×768 target).
        maxWidth: desk
          ? 'max(760px, calc((100vh - 530px) * 32 / 9 + 12px))'
          : undefined,
        margin: desk ? '0 auto' : undefined,
      }}>
      <ProgramMonitor whepUrl={whepUrl} muted frame={OB.program} />
      <PreviewSlate
        state={state}
        signals={signals}
        clockOffsetMs={clockOffsetMs}
      />
    </div>
  );
}
