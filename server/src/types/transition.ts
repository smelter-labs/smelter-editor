export type TransitionType =
  | 'fade'
  | 'slide-left'
  | 'slide-right'
  | 'slide-up'
  | 'slide-down'
  | 'wipe-left'
  | 'wipe-right'
  | 'dissolve';

export type TransitionConfig = {
  type: TransitionType;
  durationMs: number;
};

export type ActiveTransition = TransitionConfig & {
  direction: 'in' | 'out';
  startedAtMs: number;
};
