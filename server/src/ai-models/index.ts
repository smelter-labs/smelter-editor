import { ModelRegistry } from './registry';
import { MOTION_MANIFEST } from './motion/manifest';

export function registerAIModels(): void {
  ModelRegistry.register(MOTION_MANIFEST);
}

export { ModelRegistry } from './registry';
export { computeSideChannelConfig, sideChannelConfigEqual, requiresSideChannelReconnect } from './side-channel-config';
export type { SideChannelConfig } from './side-channel-config';
export { RoomAIController, manifestSupportsInput, defaultAIModelConfig } from './room-ai-controller';
export type { ModelResultEvent } from './base-sidecar';
export { BaseSidecar } from './base-sidecar';
