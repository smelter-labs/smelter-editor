import type { TimelineConfig, TimelineClip, TimelineTrack } from '@smelter-editor/types';
import type {
  TimelineState,
  Track,
  Clip,
} from '@/components/control-panel/hooks/use-timeline-state';

function toServerClip(clip: Clip): TimelineClip {
  const { mp4DurationMs: _mp4DurationMs, ...blockSettings } =
    clip.blockSettings;
  return {
    id: clip.id,
    inputId: clip.inputId,
    startMs: clip.startMs,
    endMs: clip.endMs,
    blockSettings,
  };
}

function toServerTrack(track: Track): TimelineTrack {
  return {
    id: track.id,
    clips: track.clips.map(toServerClip),
  };
}

export function toServerTimelineConfig(state: TimelineState): TimelineConfig {
  return {
    tracks: state.tracks.map(toServerTrack),
    totalDurationMs: state.totalDurationMs,
  };
}
