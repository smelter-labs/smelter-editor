import { describe, expect, it } from 'vitest';
import { obPresetRuleset, type ObRule } from '@smelter-editor/types';
import {
  actionSummary,
  conditionSummary,
  isRuleEnabled,
  parseRulesetJson,
  ruleOrigin,
  ruleSummary,
  rulesetToJson,
  selectorLabel,
  setRuleCooldown,
  setRulePriority,
  toggleRule,
} from '../rules-editor';

const talk = obPresetRuleset('talk');

describe('rules edits', () => {
  it('toggles, clamps priority and cooldown, leaves the input alone', () => {
    const id = talk.rules[0].id;
    const off = toggleRule(talk, id);
    expect(isRuleEnabled(off.rules[0])).toBe(false);
    expect(isRuleEnabled(toggleRule(off, id).rules[0])).toBe(true);
    expect(isRuleEnabled(talk.rules[0])).toBe(true);
    expect(setRulePriority(talk, id, 140).rules[0].priority).toBe(100);
    expect(setRulePriority(talk, id, -3).rules[0].priority).toBe(0);
    expect(setRuleCooldown(talk, id, 999_999).rules[0].cooldownMs).toBe(
      120_000,
    );
  });

  it('parses RAW JSON: syntax errors are one line, valid JSON goes through the shared parser', () => {
    const bad = parseRulesetJson('{ nope', talk);
    expect(bad.ruleset).toBeNull();
    expect(bad.errors[0]).toMatch(/^JSON:/);
    const ok = parseRulesetJson(rulesetToJson(talk), talk);
    expect(ok.errors).toEqual([]);
    expect(ok.ruleset?.rules).toHaveLength(talk.rules.length);
    expect(parseRulesetJson('[1]', talk).errors).toEqual([
      'ruleset must be a JSON object',
    ]);
  });

  it('tells preset, edited and foreign rules apart', () => {
    const rule = talk.rules[0];
    expect(ruleOrigin(rule, talk, 'llm')).toBe('preset');
    expect(ruleOrigin({ ...rule, enabled: true }, talk, 'llm')).toBe('preset');
    expect(ruleOrigin({ ...rule, priority: 1 }, talk, 'llm')).toBe('edited');
    expect(ruleOrigin({ ...rule, id: 'new' }, talk, 'llm')).toBe('llm');
    expect(ruleOrigin(rule, null, 'custom')).toBe('custom');
  });
});

describe('rule summary', () => {
  it('describes selectors', () => {
    expect(selectorLabel('not-program')).toBe('BEST OFF-AIR');
    expect(selectorLabel('cam:3')).toBe('CAM 3');
    expect(selectorLabel('stage-left')).toBe('STAGE LEFT');
    expect(selectorLabel('trigger')).toBe('THAT CAM');
  });

  it('describes conditions in words', () => {
    expect(
      conditionSummary({
        all: [
          { signal: 'speech', cam: 'not-program', forMs: 1500 },
          { signal: 'hold', op: '>', value: 2500 },
        ],
      }),
    ).toBe('speech on BEST OFF-AIR for 1.5 s AND program held > 2.5 s');
    expect(
      conditionSummary({ signal: 'keyword', op: 'has', value: 'slides' }),
    ).toBe('keyword "slides"');
    expect(conditionSummary({ not: { signal: 'ball', cam: 'wide' } })).toBe(
      'NOT ball in view on WIDE',
    );
    expect(
      conditionSummary({ signal: 'dialogue', op: '==', value: false }),
    ).toBe('no back-and-forth');
  });

  it('describes actions and the meta line', () => {
    expect(
      actionSummary({
        shot: { kind: 'split', cams: ['program', 'trigger'] },
        transition: { type: 'dissolve', durationMs: 300 },
        lowerThird: { cam: 'trigger', mode: 'talent' },
      }),
    ).toBe('SPLIT PROGRAM + THAT CAM · DISS 300 ms · L3 THAT CAM');
    expect(actionSummary({})).toBe('nothing');
    const rule: ObRule = {
      id: 'r',
      name: 'R',
      priority: 85,
      cooldownMs: 15000,
      holdMs: 8000,
      when: { signal: 'burst' },
      then: { effects: { spotlight: true, grade: 'warm' } },
    };
    const s = ruleSummary(rule);
    expect(s.then).toBe('FX spotlight, grade warm');
    expect(s.meta).toBe(
      'P85 · cuts through min hold · cooldown 15 s · hold 8 s',
    );
  });

  it('summarises every preset rule without throwing', () => {
    for (const id of ['talk', 'match', 'stage', 'gig'] as const) {
      for (const rule of obPresetRuleset(id).rules) {
        const s = ruleSummary(rule);
        expect(s.when.length).toBeGreaterThan(0);
        expect(s.then).not.toBe('');
      }
    }
  });
});
