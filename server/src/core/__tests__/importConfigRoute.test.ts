import { describe, expect, it } from 'vitest';
import { rebuildLayers } from '../importConfigLayers';

describe('rebuildLayers', () => {
  it('keeps WHIP placeholders when restoring layers from import config', () => {
    const restored = rebuildLayers(
      [
        {
          id: 'layer-1',
          inputs: [
            { inputIndex: 0, x: 1, y: 2, width: 3, height: 4 },
            { inputIndex: 1, x: 10, y: 20, width: 30, height: 40 },
          ],
        },
      ],
      { 0: 'input-real-0' },
      { 1: '__pending-whip-1__' },
    );

    expect(restored).toHaveLength(1);
    expect(restored[0]?.inputs.map((input) => input.inputId)).toEqual([
      'input-real-0',
      '__pending-whip-1__',
    ]);
  });

  it('drops layer entries that cannot be mapped to any input id', () => {
    const restored = rebuildLayers(
      [
        {
          id: 'layer-1',
          inputs: [{ inputIndex: 99, x: 1, y: 2, width: 3, height: 4 }],
        },
      ],
      {},
      {},
    );

    expect(restored[0]?.inputs).toEqual([]);
  });
});
