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

const VALID_TRANSITION_TYPES: ReadonlySet<string> = new Set<TransitionType>([
  'fade',
  'slide-left',
  'slide-right',
  'slide-up',
  'slide-down',
  'wipe-left',
  'wipe-right',
  'dissolve',
]);

export function isTransitionType(value: string): value is TransitionType {
  return VALID_TRANSITION_TYPES.has(value);
}

export function parseTransitionConfig(
  stored: { type: string; durationMs: number } | undefined,
): TransitionConfig | undefined {
  if (!stored || !isTransitionType(stored.type)) return undefined;
  return { type: stored.type, durationMs: stored.durationMs };
}

export type ActiveTransition = TransitionConfig & {
  direction: 'in' | 'out';
  startedAtMs: number;
};
