import type { FbAiEventsStatus } from '@smelter-editor/types';

/**
 * The moderator panel's AI EVENTS chip (AI LOG head, next to OVERLAY): pure
 * label / tone / tooltip per server status, so the node vitest config can
 * cover them. Wording never mentions the events file: on the panel the mode
 * reads as a model, not as a replay.
 */

const LABEL: Record<FbAiEventsStatus, string> = {
  off: 'AI EVENTS · OFF',
  no_clip: 'AI EVENTS · NO CLIP',
  loading: 'AI EVENTS · LOADING',
  armed: 'AI EVENTS · ARMED',
  no_events: 'AI EVENTS · NO PLAYS',
};

const TITLE: Record<FbAiEventsStatus, string> = {
  off: "Score from the clip's annotated plays instead of the live model",
  no_clip: 'Waiting for a file camera (CAMERAS → USE FILE)',
  loading: 'Reading the plays of the attached clip…',
  armed:
    'Annotated plays fire at their clip time; the live model is superseded',
  no_events: 'This clip has no annotated plays — the live model is scoring',
};

export function aiEventsChipLabel(status: FbAiEventsStatus): string {
  return LABEL[status];
}

export function aiEventsChipTone(
  status: FbAiEventsStatus,
): 'electric' | 'amber' {
  return status === 'no_events' ? 'amber' : 'electric';
}

export function aiEventsChipTitle(
  status: FbAiEventsStatus,
  hasClip: boolean,
): string {
  if (status === 'off' && !hasClip) {
    return 'Turn on now; it arms itself once a file camera is attached (USE FILE)';
  }
  return TITLE[status];
}
