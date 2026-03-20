import type { TransitionConfig } from './transition.js';
import type {
  InputDisplayProperties,
  TextInputProperties,
  AbsolutePositionProperties,
  CropProperties,
  BorderProperties,
  SnakeGameDisplayProperties,
  EqualizerProperties,
} from './input.js';

export type TimelineBlockSettings = {
  timelineColor?: string;
  attachedInputIds?: string[];
  mp4PlayFromMs?: number;
  mp4Loop?: boolean;
  introTransition?: TransitionConfig;
  outroTransition?: TransitionConfig;
} & InputDisplayProperties &
  Partial<TextInputProperties> &
  Partial<AbsolutePositionProperties> &
  Partial<CropProperties> &
  Partial<BorderProperties> &
  Partial<SnakeGameDisplayProperties> &
  Partial<EqualizerProperties>;

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

export type TimelineConfig = {
  tracks: TimelineTrack[];
  totalDurationMs: number;
  keyframeInterpolationMode: TimelineKeyframeInterpolationMode;
};
