'use client';

import React from 'react';
import { KbtSelect } from '../kbt-kit';
import type { CommentatorRig } from './use-commentator-rig';

/**
 * Webcam/mic dropdowns — the desktop replacement for the phone's FLIP chip.
 * Only rendered once a permission grant populated the device labels; a swap
 * while live replaces the published tracks without renegotiating.
 */
export function DevicePickers({ rig }: { rig: CommentatorRig }) {
  if (!rig.camOn || rig.videoDevices.length + rig.audioDevices.length === 0)
    return null;
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      {rig.videoDevices.length > 0 ? (
        <KbtSelect
          label='CAMERA'
          value={rig.videoDeviceId ?? ''}
          onChange={(id) => void rig.selectDevices({ videoId: id })}>
          {rig.videoDevices.map((d, i) => (
            <option key={d.deviceId || i} value={d.deviceId}>
              {d.label || `CAMERA ${i + 1}`}
            </option>
          ))}
        </KbtSelect>
      ) : null}
      {rig.audioDevices.length > 0 ? (
        <KbtSelect
          label='MICROPHONE'
          value={rig.audioDeviceId ?? ''}
          onChange={(id) => void rig.selectDevices({ audioId: id })}>
          {rig.audioDevices.map((d, i) => (
            <option key={d.deviceId || i} value={d.deviceId}>
              {d.label || `MICROPHONE ${i + 1}`}
            </option>
          ))}
        </KbtSelect>
      ) : null}
    </div>
  );
}
