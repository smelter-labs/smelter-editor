import { ModelRegistry } from './registry';
import { MOTION_MANIFEST } from './motion/manifest';
import { PEOPLE_COUNTER_MANIFESTS } from './people-counter/manifest';
import { BUILDING_DETECTOR_MANIFEST } from './building-detector/manifest';

export function registerAIModels(): void {
  ModelRegistry.register(MOTION_MANIFEST);
  for (const manifest of PEOPLE_COUNTER_MANIFESTS) {
    ModelRegistry.register(manifest);
  }
  ModelRegistry.register(BUILDING_DETECTOR_MANIFEST);
}

export {
  PEOPLE_COUNTER_MANIFESTS,
  PEOPLE_COUNTER_YOLO_ID,
  PEOPLE_COUNTER_YOLO_BIRDS_ID,
  isPeopleCounterModel,
} from './people-counter/manifest';
export {
  BUILDING_DETECTOR_MANIFEST,
  BUILDING_DETECTOR_ID,
  isBuildingDetectorModel,
} from './building-detector/manifest';
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
