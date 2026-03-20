import type { BlockSettings, Keyframe } from '../../hooks/use-timeline-state';

export function extractMp4FileName(title: string): string | null {
  const match = title.match(/^\[MP4\]\s+(.+)$/);
  if (!match) return null;
  return match[1].split(/\s+/).join('_') + '.mp4';
}

export type SelectedTimelineClip = {
  trackId: string;
  clipId: string;
  inputId: string;
  startMs: number;
  endMs: number;
  blockSettings: BlockSettings;
  keyframes: Keyframe[];
  selectedKeyframeId?: string | null;
};

export function computeCommonBlockSettings(
  clips: SelectedTimelineClip[],
): BlockSettings {
  if (clips.length === 0) {
    return {
      volume: 1,
      showTitle: true,
      shaders: [],
      orientation: 'horizontal',
    };
  }
  if (clips.length === 1) return clips[0].blockSettings;

  const first = clips[0].blockSettings;
  const result: BlockSettings = { ...first };

  for (let i = 1; i < clips.length; i++) {
    const bs = clips[i].blockSettings;
    if (bs.volume !== result.volume) result.volume = -1;
    if (bs.showTitle !== result.showTitle) result.showTitle = first.showTitle;
    if (bs.orientation !== result.orientation)
      result.orientation = first.orientation;
    if (bs.borderColor !== result.borderColor) result.borderColor = undefined;
    if (bs.borderWidth !== result.borderWidth) result.borderWidth = undefined;
  }
  return result;
}

export function clampKeyframeToClipRange(
  valueMs: number,
  clipDurationMs: number,
): number {
  return Math.max(0, Math.min(Math.round(valueMs), clipDurationMs));
}

export function resolveNewKeyframeTimeMs(
  clip: Pick<SelectedTimelineClip, 'startMs' | 'endMs' | 'keyframes'>,
  desiredTimeMs: number,
): number {
  const clipDurationMs = Math.max(0, clip.endMs - clip.startMs);
  const clampedTimeMs = clampKeyframeToClipRange(desiredTimeMs, clipDurationMs);
  const occupiedTimes = new Set(
    clip.keyframes.map((keyframe) => Math.round(keyframe.timeMs)),
  );

  if (!occupiedTimes.has(clampedTimeMs)) {
    return clampedTimeMs;
  }

  const preferredStep = clampedTimeMs >= clipDurationMs ? -100 : 100;
  for (const step of [preferredStep, -preferredStep]) {
    let candidateTimeMs = clampedTimeMs;
    while (true) {
      candidateTimeMs += step;
      if (candidateTimeMs < 0 || candidateTimeMs > clipDurationMs) {
        break;
      }
      if (!occupiedTimes.has(candidateTimeMs)) {
        return candidateTimeMs;
      }
    }
  }

  return clampedTimeMs;
}
