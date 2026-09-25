import {
  OB_CAM_ROLES,
  isObCamRole,
  type ObCamRole,
  type ObFixedCamRole,
} from '@smelter-editor/types';

// OB Van camera roles as the editor shows them: labels for the chips and
// selects, the custom:<name> encoding, and which roles get transcribed when
// the event runs with captions.

export const ROLE_LABEL: Record<ObFixedCamRole, string> = {
  wide: 'WIDE',
  speaker: 'SPEAKER',
  guest: 'GUEST',
  audience: 'AUDIENCE',
  slides: 'SLIDES',
  'stage-left': 'STAGE LEFT',
  'stage-right': 'STAGE RIGHT',
  'goal-left': 'GOAL LEFT',
  'goal-right': 'GOAL RIGHT',
};

/** One-line hint under a role chip on the phone. */
export const ROLE_HINT: Record<ObFixedCamRole, string> = {
  wide: 'the whole room or stage',
  speaker: 'the main speaker, head and shoulders',
  guest: 'a second voice — panel guest, interviewee',
  audience: 'the crowd, reactions, questions',
  slides: 'the projector screen',
  'stage-left': 'left side of the stage',
  'stage-right': 'right side of the stage',
  'goal-left': 'behind the left goal',
  'goal-right': 'behind the right goal',
};

export const FIXED_ROLES: readonly ObFixedCamRole[] = OB_CAM_ROLES;

/** Roles transcribed when captions are on (server rule, mirrored for copy). */
export const TRANSCRIBED_ROLES: readonly ObFixedCamRole[] = [
  'speaker',
  'guest',
  'wide',
];

const CUSTOM_PREFIX = 'custom:';
const CUSTOM_NAME_RE = /[^\w .-]/g;

export function isCustomRole(role: ObCamRole): role is `custom:${string}` {
  return role.startsWith(CUSTOM_PREFIX);
}

/** Clean a free-text role name to what `isObCamRole` accepts (≤ 24 chars). */
export function sanitizeCustomRoleName(name: string): string {
  return name.replace(CUSTOM_NAME_RE, '').trim().slice(0, 24);
}

/** `custom:<name>` for a typed name, or null when nothing usable is left. */
export function customRole(name: string): ObCamRole | null {
  const clean = sanitizeCustomRoleName(name);
  if (!clean) return null;
  const role = `${CUSTOM_PREFIX}${clean}`;
  return isObCamRole(role) ? role : null;
}

export function customRoleName(role: ObCamRole): string {
  return isCustomRole(role) ? role.slice(CUSTOM_PREFIX.length) : '';
}

export function roleLabel(role: ObCamRole): string {
  if (isCustomRole(role)) return customRoleName(role).toUpperCase();
  return ROLE_LABEL[role] ?? String(role).toUpperCase();
}

export function isTranscribedRole(role: ObCamRole): boolean {
  return (TRANSCRIBED_ROLES as readonly string[]).includes(role);
}

/** Parse anything (select value, stored session) to a role, else `fallback`. */
export function toRole(v: unknown, fallback: ObCamRole = 'wide'): ObCamRole {
  return isObCamRole(v) ? v : fallback;
}
