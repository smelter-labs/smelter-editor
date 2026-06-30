import { BaseSidecar } from '../base-sidecar';
import { MOTION_MANIFEST } from './manifest';

export class MotionSidecar extends BaseSidecar {
  constructor() {
    super(MOTION_MANIFEST);
  }
}

/** Singleton motion sidecar (global — one Python process for all rooms). */
let motionSidecar: MotionSidecar | null = null;

export function getMotionSidecar(): MotionSidecar {
  if (!motionSidecar) {
    motionSidecar = new MotionSidecar();
  }
  return motionSidecar;
}

export async function ensureMotionSidecarStarted(): Promise<MotionSidecar> {
  const sidecar = getMotionSidecar();
  await sidecar.start();
  return sidecar;
}
