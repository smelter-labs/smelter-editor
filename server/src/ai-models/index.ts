import { ModelRegistry } from './registry';
import { MOTION_MANIFEST } from './motion/manifest';
import { PEOPLE_COUNTER_MANIFESTS } from './people-counter/manifest';
import { BUILDING_DETECTOR_MANIFEST } from './building-detector/manifest';
import { CAR_ADS_MANIFESTS } from './car-ads/manifest';
import { KETTLEBELL_COACH_MANIFEST } from './kettlebell-coach/manifest';

export function registerAIModels(): void {
  ModelRegistry.register(MOTION_MANIFEST);
  for (const manifest of PEOPLE_COUNTER_MANIFESTS) {
    ModelRegistry.register(manifest);
  }
  ModelRegistry.register(BUILDING_DETECTOR_MANIFEST);
  for (const manifest of CAR_ADS_MANIFESTS) {
    ModelRegistry.register(manifest);
  }
  ModelRegistry.register(KETTLEBELL_COACH_MANIFEST);
}

export {
  PEOPLE_COUNTER_MANIFESTS,
  PEOPLE_COUNTER_YOLO_ID,
  PEOPLE_COUNTER_YOLO_BIRDS_ID,
  isPeopleCounterModel,
  isMarkerSource,
} from './people-counter/manifest';
export {
  BUILDING_DETECTOR_MANIFEST,
  BUILDING_DETECTOR_ID,
  isBuildingDetectorModel,
} from './building-detector/manifest';
export {
  CAR_ADS_MANIFEST,
  CAR_ADS_MANIFESTS,
  CAR_ADS_ID,
  CAR_HUE_MANIFEST,
  CAR_HUE_ID,
  isCarAdsModel,
} from './car-ads/manifest';
export {
  KETTLEBELL_COACH_MANIFEST,
  KETTLEBELL_COACH_ID,
  isKettlebellCoachModel,
} from './kettlebell-coach/manifest';
export { ModelRegistry } from './registry';
export {
  computeSideChannelConfig,
  sideChannelConfigEqual,
  requiresSideChannelReconnect,
  WHIP_SIDE_CHANNEL_DELAY_MS,
} from './side-channel-config';
export type { SideChannelConfig } from './side-channel-config';
export {
  RoomAIController,
  manifestSupportsInput,
  defaultAIModelConfig,
} from './room-ai-controller';
export type { ModelResultEvent } from './base-sidecar';
export { BaseSidecar } from './base-sidecar';
