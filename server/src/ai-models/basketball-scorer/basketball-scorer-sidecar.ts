import { BaseSidecar } from '../base-sidecar';
import { BASKETBALL_SCORER_MANIFEST } from './manifest';

/** Basketball scorer sidecar (one global Python process, shared by rooms). */
export class BasketballScorerSidecar extends BaseSidecar {
  constructor() {
    super(BASKETBALL_SCORER_MANIFEST);
  }
}

let sidecar: BasketballScorerSidecar | null = null;

export async function ensureBasketballScorerSidecarStarted(): Promise<BasketballScorerSidecar> {
  if (!sidecar) {
    sidecar = new BasketballScorerSidecar();
  }
  await sidecar.start();
  return sidecar;
}
