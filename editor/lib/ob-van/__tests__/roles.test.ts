import { describe, expect, it } from 'vitest';
import {
  customRole,
  customRoleName,
  isCustomRole,
  isTranscribedRole,
  roleLabel,
  sanitizeCustomRoleName,
  toRole,
} from '../roles';

describe('roles', () => {
  it('labels fixed and custom roles', () => {
    expect(roleLabel('stage-left')).toBe('STAGE LEFT');
    expect(roleLabel('custom:drums')).toBe('DRUMS');
  });

  it('builds custom roles the server accepts', () => {
    expect(customRole('  Drum kit!! ')).toBe('custom:Drum kit');
    expect(customRole('***')).toBeNull();
    expect(sanitizeCustomRoleName('x'.repeat(40))).toHaveLength(24);
    const role = customRole('bass');
    expect(role && isCustomRole(role)).toBe(true);
    expect(role && customRoleName(role)).toBe('bass');
  });

  it('parses unknown values to a fallback', () => {
    expect(toRole('speaker')).toBe('speaker');
    expect(toRole('custom:ok')).toBe('custom:ok');
    expect(toRole('nope')).toBe('wide');
    expect(toRole(42, 'guest')).toBe('guest');
  });

  it('knows the transcribed roles', () => {
    expect(isTranscribedRole('speaker')).toBe(true);
    expect(isTranscribedRole('wide')).toBe(true);
    expect(isTranscribedRole('audience')).toBe(false);
  });
});
