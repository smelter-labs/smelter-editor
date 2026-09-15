import { describe, expect, it } from 'vitest';
import {
  aiEventsChipLabel,
  aiEventsChipTitle,
  aiEventsChipTone,
} from '../ai-events-helpers';

describe('AI EVENTS chip', () => {
  it('labels every status', () => {
    expect(aiEventsChipLabel('off')).toBe('AI EVENTS · OFF');
    expect(aiEventsChipLabel('armed')).toBe('AI EVENTS · ARMED');
    expect(aiEventsChipLabel('no_events')).toBe('AI EVENTS · NO PLAYS');
  });
  it('turns amber when the clip has no plays', () => {
    expect(aiEventsChipTone('no_events')).toBe('amber');
    expect(aiEventsChipTone('armed')).toBe('electric');
  });
  it('explains what turning it on does without a clip', () => {
    expect(aiEventsChipTitle('off', false)).toMatch(/arms itself/i);
    expect(aiEventsChipTitle('armed', true)).toMatch(/fire/i);
  });
});
