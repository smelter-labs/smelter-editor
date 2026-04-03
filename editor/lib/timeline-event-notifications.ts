export type TimelineEventType = 'block-enter' | 'block-exit' | 'keyframe' | 'position-change';

export type TimelineEventNotification = {
  type: TimelineEventType;
  inputLabel: string;
  color: string;
  detail?: string;
};

export const TIMELINE_EVENT_NOTIFICATION = 'smelter:timeline:event-notification' as const;

export function emitTimelineEventNotification(detail: TimelineEventNotification) {
  window.dispatchEvent(new CustomEvent(TIMELINE_EVENT_NOTIFICATION, { detail }));
}
