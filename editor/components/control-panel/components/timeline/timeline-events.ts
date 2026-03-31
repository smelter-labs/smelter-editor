import type { BlockSettings, Keyframe } from '../../hooks/use-timeline-state';

export const TIMELINE_EVENTS = {
  UPDATE_CLIP_SETTINGS: 'smelter:timeline:update-clip-settings',
  RESIZE_CLIP: 'smelter:timeline:resize-clip',
  ADD_KEYFRAME: 'smelter:timeline:add-keyframe',
  UPDATE_KEYFRAME: 'smelter:timeline:update-keyframe',
  MOVE_KEYFRAME: 'smelter:timeline:move-keyframe',
  DELETE_KEYFRAME: 'smelter:timeline:delete-keyframe',
  SELECT_KEYFRAME: 'smelter:timeline:select-keyframe',
  UPDATE_CLIP_SETTINGS_FOR_INPUT: 'smelter:timeline:update-clip-settings-for-input',
  PURGE_INPUT_IDS: 'smelter:timeline:purge-input-ids',
  CLEANUP_SPURIOUS_WHIP_TRACK: 'smelter:timeline:cleanup-spurious-whip-track',
  SWAP_CLIP_INPUT: 'smelter:timeline:swap-clip-input',
  SELECT_CLIP: 'smelter:timeline:select-clip',
  SELECTED_CLIP: 'smelter:timeline:selected-clip',
} as const;

export type TimelineEventMap = {
  [TIMELINE_EVENTS.UPDATE_CLIP_SETTINGS]: {
    trackId: string;
    clipId: string;
    patch: Partial<BlockSettings>;
  };
  [TIMELINE_EVENTS.RESIZE_CLIP]: {
    trackId: string;
    clipId: string;
    edge: 'left' | 'right';
    newMs: number;
  };
  [TIMELINE_EVENTS.ADD_KEYFRAME]: {
    trackId: string;
    clipId: string;
    timeMs: number;
  };
  [TIMELINE_EVENTS.UPDATE_KEYFRAME]: {
    trackId: string;
    clipId: string;
    keyframeId: string;
    patch: Partial<BlockSettings>;
  };
  [TIMELINE_EVENTS.MOVE_KEYFRAME]: {
    trackId: string;
    clipId: string;
    keyframeId: string;
    timeMs: number;
  };
  [TIMELINE_EVENTS.DELETE_KEYFRAME]: {
    trackId: string;
    clipId: string;
    keyframeId: string;
  };
  [TIMELINE_EVENTS.SELECT_KEYFRAME]: {
    trackId: string;
    clipId: string;
    keyframeId: string | null;
  };
  [TIMELINE_EVENTS.UPDATE_CLIP_SETTINGS_FOR_INPUT]: {
    inputId: string;
    patch: Partial<BlockSettings>;
  };
  [TIMELINE_EVENTS.PURGE_INPUT_IDS]: {
    inputIds: string[];
  };
  [TIMELINE_EVENTS.CLEANUP_SPURIOUS_WHIP_TRACK]: {
    inputId: string;
  };
  [TIMELINE_EVENTS.SWAP_CLIP_INPUT]: {
    trackId: string;
    clipId: string;
    newInputId: string;
    sourceUpdates?: Partial<BlockSettings>;
  };
  [TIMELINE_EVENTS.SELECT_CLIP]: {
    inputId?: string;
    trackIndex?: number;
    trackId?: string;
    clipId?: string;
  } | null;
  [TIMELINE_EVENTS.SELECTED_CLIP]: {
    clips: {
      trackId: string;
      clipId: string;
      inputId: string;
      startMs: number;
      endMs: number;
      blockSettings: BlockSettings;
      keyframes: Keyframe[];
      selectedKeyframeId?: string | null;
    }[];
  };
};

export function emitTimelineEvent<K extends keyof TimelineEventMap>(
  name: K,
  detail: TimelineEventMap[K],
): void {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function listenTimelineEvent<K extends keyof TimelineEventMap>(
  name: K,
  handler: (detail: TimelineEventMap[K]) => void,
): () => void {
  const wrapped = (e: Event) => {
    handler((e as CustomEvent<TimelineEventMap[K]>).detail);
  };
  window.addEventListener(name, wrapped);
  return () => window.removeEventListener(name, wrapped);
}
