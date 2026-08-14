import { BaseSidecar } from '../base-sidecar';
import { KETTLEBELL_COACH_MANIFEST } from './manifest';

/** Kettlebell coach sidecar (one global Python process, shared by rooms). */
export class KettlebellCoachSidecar extends BaseSidecar {
  constructor() {
    super(KETTLEBELL_COACH_MANIFEST);
  }
}

let sidecar: KettlebellCoachSidecar | null = null;

export async function ensureKettlebellCoachSidecarStarted(): Promise<KettlebellCoachSidecar> {
  if (!sidecar) {
    sidecar = new KettlebellCoachSidecar();
  }
  await sidecar.start();
  return sidecar;
}
