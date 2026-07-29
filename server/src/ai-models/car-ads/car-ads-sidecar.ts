import { BaseSidecar } from '../base-sidecar';
import type { ModelManifest } from '../registry';
import { CAR_ADS_MANIFESTS } from './manifest';

/** Car detection sidecar — one Python process per backend, shared by rooms. */
export class CarAdsSidecar extends BaseSidecar {
  constructor(manifest: ModelManifest) {
    super(manifest);
  }
}

/** One singleton sidecar per backend model id (one Python process each). */
const sidecars = new Map<string, CarAdsSidecar>();

export async function ensureCarAdsSidecarStarted(
  modelId: string,
): Promise<CarAdsSidecar> {
  let sidecar = sidecars.get(modelId);
  if (!sidecar) {
    const manifest = CAR_ADS_MANIFESTS.find((m) => m.id === modelId);
    if (!manifest) {
      throw new Error(`Unknown car-ads model: ${modelId}`);
    }
    sidecar = new CarAdsSidecar(manifest);
    sidecars.set(modelId, sidecar);
  }
  await sidecar.start();
  return sidecar;
}
