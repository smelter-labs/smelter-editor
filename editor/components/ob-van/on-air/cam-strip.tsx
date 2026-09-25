'use client';

import React from 'react';
import type {
  ObCam,
  ObOperatorCommand,
  ObSignalSummary,
} from '@smelter-editor/types';
import { CamTile, Meta, OB } from '../ob-kit';
import type { ObPending } from '../use-ob-pending';

/**
 * The camera strip under the program monitor: up to eight tiles with tally
 * frames and live speech / level / motion meters. Clicking a tile previews
 * it (same as 1..8).
 */
export function CamStrip({
  cams,
  signals,
  pending,
}: {
  cams: ObCam[];
  signals: Record<string, ObSignalSummary>;
  pending: ObPending;
}) {
  const sorted = [...cams].sort((a, b) => a.number - b.number);
  if (sorted.length === 0)
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `1px dashed ${OB.rule2}`,
          borderRadius: 3,
        }}>
        <Meta>no cameras — add them on SETUP</Meta>
      </div>
    );
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gap: 6,
      }}>
      {sorted.map((cam) => {
        const cmd: ObOperatorCommand = {
          op: 'preview',
          shot: { kind: 'solo', cam: cam.id },
        };
        return (
          <CamTile
            key={cam.id}
            cam={cam}
            signals={signals[cam.id]}
            compact
            pending={pending.isPending(cmd)}
            onClick={() => pending.send(cmd)}
          />
        );
      })}
    </div>
  );
}
