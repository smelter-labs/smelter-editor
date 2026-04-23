import { describe, expect, it } from 'vitest';
import { __importConfigRouteTestUtils } from '../importConfigRoute';
import type { ImportConfigInput } from '@smelter-editor/types';
import { rebuildLayers } from '../importConfigLayers';

const baseInput: ImportConfigInput = {
  type: 'text-input',
  title: 'Text',
  description: '',
  volume: 1,
  shaders: [],
  text: 'hello',
};

describe('importConfigRoute buildRegisterOptions', () => {
  it('maps local-mp4 video source from mp4FileName', () => {
    const input: ImportConfigInput = {
      ...baseInput,
      type: 'local-mp4',
      mp4FileName: 'clips/intro.mp4',
    };

    const opts = __importConfigRouteTestUtils.buildRegisterOptions(input);
    expect(opts).toEqual({
      type: 'local-mp4',
      source: { fileName: 'clips/intro.mp4' },
    });
  });

  it('maps local-mp4 audio source from audioFileName', () => {
    const input: ImportConfigInput = {
      ...baseInput,
      type: 'local-mp4',
      audioFileName: 'music/theme.mp4',
    };

    const opts = __importConfigRouteTestUtils.buildRegisterOptions(input);
    expect(opts).toEqual({
      type: 'local-mp4',
      source: { audioFileName: 'music/theme.mp4' },
    });
  });

  it('throws for ambiguous local-mp4 source when both fields exist', () => {
    const input: ImportConfigInput = {
      ...baseInput,
      type: 'local-mp4',
      mp4FileName: 'clips/intro.mp4',
      audioFileName: 'music/theme.mp4',
    };

    expect(() =>
      __importConfigRouteTestUtils.buildRegisterOptions(input),
    ).toThrow(/either audioFileName or mp4FileName/i);
  });

  it('throws for invalid local-mp4 source when both fields are missing', () => {
    const input: ImportConfigInput = {
      ...baseInput,
      type: 'local-mp4',
      mp4FileName: undefined,
      audioFileName: undefined,
    };

    expect(() =>
      __importConfigRouteTestUtils.buildRegisterOptions(input),
    ).toThrow(/missing both audioFileName and mp4FileName/i);
  });

  it('uses imageFileName when provided', () => {
    const input: ImportConfigInput = {
      ...baseInput,
      type: 'image',
      imageId: 'pictures::logo',
      imageFileName: 'branding/logo.png',
    };

    const opts = __importConfigRouteTestUtils.buildRegisterOptions(input);
    expect(opts).toEqual({
      type: 'image',
      fileName: 'branding/logo.png',
    });
  });

  it('falls back to imageId for backwards compatibility', () => {
    const input: ImportConfigInput = {
      ...baseInput,
      type: 'image',
      imageId: 'pictures::legacy',
    };

    const opts = __importConfigRouteTestUtils.buildRegisterOptions(input);
    expect(opts).toEqual({
      type: 'image',
      imageId: 'pictures::legacy',
    });
  });
});

describe('importConfigRoute buildUpdateOptions', () => {
  it('includes imported title for text inputs', () => {
    const input: ImportConfigInput = {
      ...baseInput,
      title: 'Lower Third - Host',
      text: 'welcome',
    };

    const opts = __importConfigRouteTestUtils.buildUpdateOptions(input);

    expect(opts).toMatchObject({
      title: 'Lower Third - Host',
      volume: 1,
    });
  });
});

describe('importConfigRoute normalizeImportedInputTitles', () => {
  it('fills missing titles and deduplicates with # suffixes', () => {
    const inputs: ImportConfigInput[] = [
      { ...baseInput, title: '' },
      { ...baseInput, title: 'Text' },
      { ...baseInput, title: 'Text' },
      { ...baseInput, title: '   ' },
      { ...baseInput, title: 'Input #1' },
    ];

    const normalized =
      __importConfigRouteTestUtils.normalizeImportedInputTitles(inputs);

    expect(normalized.map((input) => input.title)).toEqual([
      'Input #1',
      'Text',
      'Text #1',
      'Input #2',
      'Input #1 #1',
    ]);
  });
});

describe('importConfigRoute collectInputIdsToRemoveFromRoomSnapshot', () => {
  it('uses server snapshot ids and removes duplicates', () => {
    // Client-provided oldInputIds can be stale; import should trust server snapshot.
    const staleClientOldInputIds = ['room::text::only-one-old'];
    expect(staleClientOldInputIds).toHaveLength(1);

    const removalIds =
      __importConfigRouteTestUtils.collectInputIdsToRemoveFromRoomSnapshot([
        'room::text::a',
        'room::text::b',
        'room::text::a',
      ]);

    expect(removalIds).toEqual(['room::text::a', 'room::text::b']);
  });
});

describe('importConfigRoute referenced input filtering', () => {
  it('collects referenced indices from timeline, layers, and attached chain', () => {
    const config = {
      version: 1 as const,
      layout: 'grid' as const,
      resolution: { width: 1280, height: 720 },
      exportedAt: new Date().toISOString(),
      inputs: [
        { ...baseInput, title: 'A', attachedInputIndices: [2] }, // 0
        { ...baseInput, title: 'B' }, // 1 (orphan)
        { ...baseInput, title: 'C' }, // 2 (attached by 0)
      ],
      timeline: {
        totalDurationMs: 60_000,
        pixelsPerSecond: 100,
        tracks: [
          {
            label: 'Track 1',
            clips: [{ inputIndex: 0, startMs: 0, endMs: 1000 }],
          },
        ],
      },
      layers: [
        {
          id: 'layer-1',
          inputs: [{ inputIndex: 0, x: 0, y: 0, width: 100, height: 100 }],
        },
      ],
    };

    const referenced =
      __importConfigRouteTestUtils.collectReferencedInputIndices(config);

    expect([...referenced].sort((a, b) => a - b)).toEqual([0, 2]);
  });

  it('drops unreferenced text-inputs when timeline/layers exist', () => {
    const config = {
      version: 1 as const,
      layout: 'grid' as const,
      resolution: { width: 1280, height: 720 },
      exportedAt: new Date().toISOString(),
      inputs: [
        { ...baseInput, title: 'Used' },
        { ...baseInput, title: 'Unused duplicate' },
      ],
      timeline: {
        totalDurationMs: 60_000,
        pixelsPerSecond: 100,
        tracks: [
          {
            label: 'Track 1',
            clips: [{ inputIndex: 0, startMs: 0, endMs: 1000 }],
          },
        ],
      },
    };
    const referenced =
      __importConfigRouteTestUtils.collectReferencedInputIndices(config);

    expect(
      __importConfigRouteTestUtils.shouldImportInputFromConfig(
        config,
        referenced,
        0,
      ),
    ).toBe(true);
    expect(
      __importConfigRouteTestUtils.shouldImportInputFromConfig(
        config,
        referenced,
        1,
      ),
    ).toBe(false);
  });
});

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

  it('deduplicates repeated inputIndex entries within one layer', () => {
    const restored = rebuildLayers(
      [
        {
          id: 'layer-1',
          inputs: [
            { inputIndex: 9, x: 1, y: 2, width: 3, height: 4 },
            { inputIndex: 9, x: 10, y: 20, width: 30, height: 40 },
          ],
        },
      ],
      { 9: 'input-9' },
      {},
    );

    expect(restored).toHaveLength(1);
    expect(restored[0]?.inputs).toHaveLength(1);
    expect(restored[0]?.inputs[0]?.inputId).toBe('input-9');
    expect(restored[0]?.inputs[0]?.x).toBe(1);
    expect(restored[0]?.inputs[0]?.y).toBe(2);
  });
});
