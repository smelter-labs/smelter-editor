import type { AIModelConfig } from '@smelter-editor/types';
import { CAPTIONS_SIDE_CHANNEL_DELAY_MS } from '../captions/constants';
import { ModelRegistry } from './registry';

export type SideChannelConfig = {
  video?: true;
  audio?: true;
  delayMs?: number;
};

export function computeSideChannelConfig(
  aiModels: Record<string, AIModelConfig>,
  transcription: boolean,
): SideChannelConfig | undefined {
  let needsVideo = false;
  let needsAudio = false;
  let maxDelay = 0;

  for (const [modelId, config] of Object.entries(aiModels)) {
    if (!config.enabled) continue;
    const manifest = ModelRegistry.get(modelId);
    if (!manifest) continue;
    if (manifest.needsVideo) needsVideo = true;
    if (manifest.needsAudio) needsAudio = true;
    const delay = config.delayMs ?? manifest.defaultDelayMs;
    maxDelay = Math.max(maxDelay, delay);
  }

  if (transcription) {
    needsAudio = true;
    maxDelay = Math.max(maxDelay, CAPTIONS_SIDE_CHANNEL_DELAY_MS);
  }

  if (!needsVideo && !needsAudio) return undefined;

  return {
    ...(needsVideo && { video: true as const }),
    ...(needsAudio && { audio: true as const }),
    ...(maxDelay > 0 && { delayMs: maxDelay }),
  };
}

export function sideChannelConfigEqual(
  a: SideChannelConfig | undefined,
  b: SideChannelConfig | undefined,
): boolean {
  const av = a?.video ?? false;
  const bv = b?.video ?? false;
  const aa = a?.audio ?? false;
  const ba = b?.audio ?? false;
  const ad = a?.delayMs ?? 0;
  const bd = b?.delayMs ?? 0;
  return av === bv && aa === ba && ad === bd;
}

/** Reconnect only when side channel requirements increase. */
export function requiresSideChannelReconnect(
  current: SideChannelConfig | undefined,
  next: SideChannelConfig | undefined,
): boolean {
  const cv = current?.video ?? false;
  const ca = current?.audio ?? false;
  const cd = current?.delayMs ?? 0;
  const nv = next?.video ?? false;
  const na = next?.audio ?? false;
  const nd = next?.delayMs ?? 0;
  return nv !== cv || na !== ca || nd !== cd;
}
