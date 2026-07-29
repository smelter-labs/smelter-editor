import { BaseSidecar } from '../base-sidecar';
import { BUILDING_DETECTOR_MANIFEST } from './manifest';

/** Building segmentation sidecar (one global Python process, shared by rooms). */
export class BuildingDetectorSidecar extends BaseSidecar {
  constructor() {
    super(BUILDING_DETECTOR_MANIFEST);
  }
}

let sidecar: BuildingDetectorSidecar | null = null;

export async function ensureBuildingDetectorSidecarStarted(): Promise<BuildingDetectorSidecar> {
  if (!sidecar) {
    sidecar = new BuildingDetectorSidecar();
  }
  await sidecar.start();
  return sidecar;
}
