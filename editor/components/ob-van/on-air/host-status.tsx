'use client';

import React from 'react';
import type { ObCam, ObHostState } from '@smelter-editor/types';
import { Mono, OB } from '../ob-kit';

const GESTURE_LABEL: Record<string, string> = {
  open_palm: 'PALM',
  fist: 'FIST',
  thumbs_up: 'THUMB',
  peace: 'V',
};

/**
 * One line on the LLM plate: where host recognition stands — watching,
 * identifying, or locked to a camera — plus the last hand gesture it fired.
 * Hidden entirely while host detection is off.
 */
export function HostStatus({
  host,
  cams,
}: {
  host: ObHostState;
  cams: ObCam[];
}) {
  if (host.status === 'off') return null;
  const cam = cams.find((c) => c.id === host.camId);
  const confirmed = host.status === 'confirmed';
  const text = confirmed
    ? `HOST · CAM ${cam?.number ?? '?'} · ${Math.round(host.confidence * 100)}%`
    : host.status === 'identifying'
      ? 'HOST · IDENTIFYING…'
      : 'HOST · WATCHING';
  const gesture = host.lastGesture
    ? ` · ${GESTURE_LABEL[host.lastGesture.name] ?? host.lastGesture.name}`
    : '';
  return (
    <Mono
      size={9}
      weight={600}
      tracking={0.08}
      color={confirmed ? OB.amber : OB.dim}>
      {text}
      {gesture}
    </Mono>
  );
}
