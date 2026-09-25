import { BaseSidecar } from '../base-sidecar';
import { OB_VAN_MANIFEST } from './manifest';

/** OB Van signal worker sidecar (one global Python process, shared by rooms). */
export class ObVanSidecar extends BaseSidecar {
  constructor() {
    super(OB_VAN_MANIFEST);
  }
}

let sidecar: ObVanSidecar | null = null;

export async function ensureObVanSidecarStarted(): Promise<ObVanSidecar> {
  if (!sidecar) {
    sidecar = new ObVanSidecar();
  }
  await sidecar.start();
  return sidecar;
}
