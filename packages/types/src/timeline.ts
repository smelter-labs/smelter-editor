import type { TransitionConfig } from './transition.js';
import type {
  InputDisplayProperties,
  TextInputProperties,
  AbsolutePositionProperties,
  CropProperties,
  BorderProperties,
  SnakeGameDisplayProperties,
} from './input.js';

export type TimelineBlockSettings = {
  timelineColor?: string;
  attachedInputIds?: string[];
  mp4PlayFromMs?: number;
  mp4Loop?: boolean;
  introTransition?: TransitionConfig;
  outroTransition?: TransitionConfig;
  forceInterpolation?: TimelineKeyframeInterpolationMode;
} & InputDisplayProperties &
  Partial<TextInputProperties> &
  Partial<AbsolutePositionProperties> &
  Partial<CropProperties> &
  Partial<BorderProperties> &
  Partial<SnakeGameDisplayProperties>;

export type TimelineKeyframe = {
  id: string;
  timeMs: number;
  blockSettings: TimelineBlockSettings;
};

export type TimelineClip = {
  id: string;
  inputId: string;
  startMs: number;
  endMs: number;
  blockSettings: TimelineBlockSettings;
  keyframes: TimelineKeyframe[];
};

export type TimelineTrack = {
  id: string;
  clips: TimelineClip[];
};

export type TimelineKeyframeInterpolationMode = 'step' | 'smooth';
export type TimelineInputOrderMode = 'layer' | 'timeline';

export type TimelineConfig = {
  tracks: TimelineTrack[];
  totalDurationMs: number;
  keyframeInterpolationMode: TimelineKeyframeInterpolationMode;
  inputOrderMode?: TimelineInputOrderMode;
};

export const OUTPUT_TRACK_INPUT_ID = '__output__';
export const OUTPUT_TRACK_ID = '__output_track__';
export const OUTPUT_CLIP_ID = '__output_clip__';

export function isOutputTrackClip(clip: TimelineClip): boolean {
  return clip.inputId === OUTPUT_TRACK_INPUT_ID;
}
