import type { Layer } from '@/lib/types';
import type { VideoOverlayRect } from '@/components/control-panel/control-panel';
import type { SelectedTimelineClip } from '@/components/control-panel/components/BlockClipPropertiesPanel';
import { isInputLevelClip } from '@/components/control-panel/components/block-clip/block-clip-utils';

export type BuildVideoOverlayRectsOptions = {
  enabled: boolean;
  clips: SelectedTimelineClip[];
  playheadMs: number;
  layers: Layer[];
  colorMap: Map<string, { dot: string }>;
};

export function buildVideoOverlayRects({
  enabled,
  clips,
  playheadMs,
  layers,
  colorMap,
}: BuildVideoOverlayRectsOptions): VideoOverlayRect[] {
  if (!enabled || clips.length === 0) return [];

  const rects: VideoOverlayRect[] = [];

  for (const clip of clips) {
    if (
      !isInputLevelClip(clip) &&
      (playheadMs < clip.startMs || playheadMs >= clip.endMs)
    ) {
      continue;
    }

    for (const layer of layers) {
      const li = layer.inputs.find((i) => i.inputId === clip.inputId);
      if (li && li.width > 0 && li.height > 0) {
        const tc = clip.blockSettings.timelineColor;
        const fallback = colorMap.get(clip.inputId)?.dot;
        rects.push({
          x: li.x,
          y: li.y,
          width: li.width,
          height: li.height,
          color: tc || fallback || '#ffffff',
        });
        break;
      }
    }
  }

  return rects;
}
