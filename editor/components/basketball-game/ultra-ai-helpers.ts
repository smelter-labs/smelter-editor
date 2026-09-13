import type { BbUltraAiStatus } from '@smelter-editor/types';

/**
 * The moderator panel's ULTRA AI chip (AI LOG head, next to OVERLAY): pure
 * label / tone / tooltip per server status, so the node vitest config can
 * cover them. Wording never mentions the events file: on the panel the mode
 * reads as a model, not as a replay.
 */

const LABEL: Record<BbUltraAiStatus, string> = {
  off: 'ULTRA AI · OFF',
  no_clip: 'ULTRA AI · NO CLIP',
  loading: 'ULTRA AI · LOADING',
  armed: 'ULTRA AI · ARMED',
  no_events: 'ULTRA AI · NO PLAYS',
};

const TITLE: Record<BbUltraAiStatus, string> = {
  off: "Score from the clip's annotated plays instead of the live model",
  no_clip: 'Waiting for a file camera (CAMERAS → USE FILE)',
  loading: 'Reading the plays of the attached clip…',
  armed:
    'Annotated plays fire at their clip time; the live model is superseded',
  no_events: 'This clip has no annotated plays — the live model is scoring',
};

export function ultraAiChipLabel(status: BbUltraAiStatus): string {
  return LABEL[status];
}

export function ultraAiChipTone(status: BbUltraAiStatus): 'electric' | 'amber' {
  return status === 'no_events' ? 'amber' : 'electric';
}

export function ultraAiChipTitle(
  status: BbUltraAiStatus,
  hasClip: boolean,
): string {
  if (status === 'off' && !hasClip) {
    return 'Turn on now; it arms itself once a file camera is attached (USE FILE)';
  }
  return TITLE[status];
}
