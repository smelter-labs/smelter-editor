import { ModelRegistry } from './registry';
import { MOTION_MANIFEST } from './motion/manifest';
import { PEOPLE_COUNTER_MANIFESTS } from './people-counter/manifest';

export function registerAIModels(): void {
  ModelRegistry.register(MOTION_MANIFEST);
  for (const manifest of PEOPLE_COUNTER_MANIFESTS) {
    ModelRegistry.register(manifest);
  }
}

export {
  PEOPLE_COUNTER_MANIFESTS,
  PEOPLE_COUNTER_YOLO_ID,
  PEOPLE_COUNTER_YOLO_BIRDS_ID,
  isPeopleCounterModel,
} from './people-counter/manifest';
export { ModelRegistry } from './registry';
export {
  computeSideChannelConfig,
  sideChannelConfigEqual,
  requiresSideChannelReconnect,
} from './side-channel-config';
export type { SideChannelConfig } from './side-channel-config';
export {
  RoomAIController,
  manifestSupportsInput,
  defaultAIModelConfig,
} from './room-ai-controller';
export type { ModelResultEvent } from './base-sidecar';
export { BaseSidecar } from './base-sidecar';
