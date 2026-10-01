'use client';

import React from 'react';
import { OB_CONFIG_LIMITS } from '@smelter-editor/types';
import type { ObUiConfig } from '@/lib/ob-van/ui-config';
import { Field, Meta, OB, TextField, Toggle } from '../ob-kit';

/**
 * HOST RECOGNITION (the FOLLOW preset's core, works with any preset): who
 * the host is, in words the vision model matches against camera snapshots.
 * A new face on a camera triggers one identify; a confirmed host is followed
 * on air and may drive effects with hand gestures.
 */
export function HostPlate({
  config,
  onConfig,
}: {
  config: ObUiConfig;
  onConfig: React.Dispatch<React.SetStateAction<ObUiConfig>>;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Toggle
        on={config.host.enabled}
        tone='program'
        label='FOLLOW THE HOST'
        onChange={(enabled) =>
          onConfig((c) => ({ ...c, host: { ...c.host, enabled } }))
        }
      />
      <Field label='WHO IS THE HOST' hint='what the vision model looks for'>
        <TextField
          value={config.host.description}
          onChange={(description) =>
            onConfig((c) => ({ ...c, host: { ...c.host, description } }))
          }
          maxLength={OB_CONFIG_LIMITS.hostDescription.max}
          label='Host description'
        />
      </Field>
      <Meta size={8.5} tracking={0.06} color={OB.dim2}>
        A NEW FACE ON A CAMERA IS SNAPSHOTTED AND MATCHED; THE SHOW CUTS TO THE
        HOST AND HAND GESTURES DRIVE FX (PALM = SPOTLIGHT · THUMB = NEON · V =
        VHS · FIST = CLEAR)
      </Meta>
    </div>
  );
}
