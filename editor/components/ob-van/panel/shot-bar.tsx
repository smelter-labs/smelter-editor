'use client';

import React from 'react';
import type { ObOperatorCommand, ObState } from '@smelter-editor/types';
import { Chip, Meta } from '../ob-kit';
import type { ObPending } from '../use-ob-pending';
import { buildShotOptions } from './shot-builder';

/**
 * SOLO / SPLIT / PIP / QUAD / GRID / SLIDES / VIRTUAL — each builds a shot
 * from the preview + program cameras and puts it on PREVIEW; the operator
 * then TAKEs it. The kind on preview now is outlined green.
 */
export function ShotBar({
  state,
  pending,
}: {
  state: ObState;
  pending: ObPending;
}) {
  const options = buildShotOptions({
    cams: state.cams,
    preview: state.preview,
    program: state.program.shot,
  });
  return (
    <div
      role='group'
      aria-label='shots'
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
        minWidth: 0,
      }}>
      <Meta size={9} style={{ width: 44, flexShrink: 0 }}>
        SHOT
      </Meta>
      {options.map((o) => {
        const cmd: ObOperatorCommand | null = o.shot
          ? { op: 'shot', shot: o.shot, mode: 'preview' }
          : null;
        const onPreview = state.preview?.kind === o.kind;
        return (
          <Chip
            key={o.kind}
            label={o.label}
            tone={onPreview ? 'preview' : 'default'}
            disabled={cmd == null}
            pending={cmd != null && pending.isPending(cmd)}
            onClick={cmd ? () => pending.send(cmd) : undefined}
            title={o.why}
          />
        );
      })}
    </div>
  );
}
