import type { CaptionBridge } from './CaptionBridge';

let bridge: CaptionBridge | null = null;

export function setCaptionBridge(instance: CaptionBridge): void {
  bridge = instance;
}

export function getCaptionBridge(): CaptionBridge | null {
  return bridge;
}
