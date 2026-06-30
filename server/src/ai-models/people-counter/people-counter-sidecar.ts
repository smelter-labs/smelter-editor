import { BaseSidecar } from '../base-sidecar';
import type { ModelManifest } from '../registry';
import { PEOPLE_COUNTER_MANIFESTS } from './manifest';

export class PeopleCounterSidecar extends BaseSidecar {
  constructor(manifest: ModelManifest) {
    super(manifest);
  }
}

/** One singleton sidecar per backend model id (one Python process each). */
const sidecars = new Map<string, PeopleCounterSidecar>();

export async function ensurePeopleCounterSidecarStarted(
  modelId: string,
): Promise<PeopleCounterSidecar> {
  let sidecar = sidecars.get(modelId);
  if (!sidecar) {
    const manifest = PEOPLE_COUNTER_MANIFESTS.find((m) => m.id === modelId);
    if (!manifest) {
      throw new Error(`Unknown people-counter model: ${modelId}`);
    }
    sidecar = new PeopleCounterSidecar(manifest);
    sidecars.set(modelId, sidecar);
  }
  await sidecar.start();
  return sidecar;
}
