import type {
  TimelineConfig,
  TimelineClip,
  TimelineKeyframe,
  TimelineTrack,
} from '@smelter-editor/types';
import type {
  TimelineState,
  Track,
  Clip,
  Keyframe,
} from '@/components/control-panel/hooks/use-timeline-state';

function toServerKeyframe(keyframe: Keyframe): TimelineKeyframe {
  const { mp4DurationMs: _mp4DurationMs, ...blockSettings } =
    keyframe.blockSettings;
  return {
    id: keyframe.id,
    timeMs: keyframe.timeMs,
    blockSettings,
  };
}

function toServerClip(clip: Clip): TimelineClip {
  const { mp4DurationMs: _mp4DurationMs, ...blockSettings } =
    clip.blockSettings;
  return {
    id: clip.id,
    inputId: clip.inputId,
    startMs: clip.startMs,
    endMs: clip.endMs,
    blockSettings,
    keyframes: clip.keyframes.map(toServerKeyframe),
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
    keyframeInterpolationMode: state.keyframeInterpolationMode,
  };
}
