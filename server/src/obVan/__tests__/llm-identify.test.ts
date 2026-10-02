import { describe, expect, it } from 'vitest';
import {
  OB_IDENTIFY_HOST_TOOL,
  identifyHost,
  parseIdentifyResult,
} from '../llm/identify';
import { FakeLlmClient, USAGE } from './llm-fixtures';

const INPUT = {
  imageB64: 'aGVsbG8=',
  hostDescription: 'wears a GOLD baseball cap',
  camLabel: 'CAM 3',
};

describe('identifyHost', () => {
  it('sends the snapshot as an image block with the strict tool', async () => {
    const client = new FakeLlmClient().tool({
      isHost: true,
      confidence: 0.85,
      reason: 'gold cap visible',
    });
    const usages: unknown[] = [];
    const result = await identifyHost(client, INPUT, {
      onUsage: (u) => usages.push(u),
    });
    expect(result).toEqual({
      isHost: true,
      confidence: 0.85,
      reason: 'gold cap visible',
    });
    expect(client.calls).toHaveLength(1);
    const call = client.calls[0];
    expect(call.images).toEqual([
      { mediaType: 'image/jpeg', dataB64: 'aGVsbG8=' },
    ]);
    expect(call.tool).toBe(OB_IDENTIFY_HOST_TOOL);
    expect(call.user).toContain('wears a GOLD baseball cap');
    expect(call.user).toContain('CAM 3');
    expect(usages).toEqual([USAGE]);
  });

  it('answers null when the model never calls the tool (usage still reported)', async () => {
    const client = new FakeLlmClient().reply({ text: 'I think so?' });
    const usages: unknown[] = [];
    const result = await identifyHost(client, INPUT, {
      onUsage: (u) => usages.push(u),
    });
    expect(result).toBeNull();
    expect(usages).toHaveLength(1);
  });

  it('propagates client errors', async () => {
    const client = new FakeLlmClient().reply(new Error('boom'));
    await expect(identifyHost(client, INPUT)).rejects.toThrow('boom');
  });
});

describe('parseIdentifyResult', () => {
  it('rejects malformed shapes', () => {
    expect(parseIdentifyResult(null)).toBeNull();
    expect(parseIdentifyResult('yes')).toBeNull();
    expect(parseIdentifyResult({ confidence: 0.9 })).toBeNull();
    expect(parseIdentifyResult({ isHost: 'true' })).toBeNull();
  });

  it('clamps confidence and truncates the reason', () => {
    expect(
      parseIdentifyResult({ isHost: false, confidence: 7, reason: 'x' }),
    ).toEqual({ isHost: false, confidence: 1, reason: 'x' });
    expect(
      parseIdentifyResult({ isHost: true, confidence: Number.NaN }),
    ).toEqual({ isHost: true, confidence: 0, reason: '' });
    const long = 'r'.repeat(500);
    expect(
      parseIdentifyResult({ isHost: true, confidence: 0.5, reason: long })
        ?.reason,
    ).toHaveLength(200);
  });
});
