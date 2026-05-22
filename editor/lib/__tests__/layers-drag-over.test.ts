import { describe, expect, it } from 'vitest';
import {
  applyDragEndToLayers,
  applyDragOverToLayers,
  findDragItem,
} from '../layers-drag-over';
import type { Layer } from '@/lib/types';

const makeInput = (inputId: string) => ({
  inputId,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
});

const makeLayers = (): Layer[] => [
  {
    id: 'layer-a',
    inputs: [makeInput('input-1'), makeInput('input-2')],
  },
  {
    id: 'layer-b',
    inputs: [makeInput('input-3')],
  },
];

describe('findDragItem', () => {
  it('finds layer drag items', () => {
    expect(findDragItem(makeLayers(), 'layer::layer-a')).toEqual({
      type: 'layer',
      layerId: 'layer-a',
    });
  });

  it('finds input drag items', () => {
    expect(findDragItem(makeLayers(), 'input-2')).toEqual({
      type: 'input',
      layerId: 'layer-a',
      inputId: 'input-2',
    });
  });
});

describe('applyDragOverToLayers', () => {
  it('returns null when active equals over', () => {
    expect(
      applyDragOverToLayers(makeLayers(), 'input-1', 'input-1'),
    ).toBeNull();
  });

  it('defers same-layer reorder to drag end', () => {
    expect(
      applyDragOverToLayers(makeLayers(), 'input-1', 'input-2'),
    ).toBeNull();
  });

  it('moves input across layers', () => {
    const result = applyDragOverToLayers(makeLayers(), 'input-1', 'input-3');
    expect(result?.[0].inputs.map((i) => i.inputId)).toEqual(['input-2']);
    expect(result?.[1].inputs.map((i) => i.inputId)).toEqual([
      'input-1',
      'input-3',
    ]);
  });

  it('defers layer reorder to drag end', () => {
    expect(
      applyDragOverToLayers(makeLayers(), 'layer::layer-a', 'layer::layer-b'),
    ).toBeNull();
  });

  it('drops input onto empty layer header', () => {
    const layers: Layer[] = [
      { id: 'layer-a', inputs: [makeInput('input-1')] },
      { id: 'layer-b', inputs: [] },
    ];
    const result = applyDragOverToLayers(layers, 'input-1', 'layer::layer-b');
    expect(result?.[0].inputs).toEqual([]);
    expect(result?.[1].inputs.map((i) => i.inputId)).toEqual(['input-1']);
  });
});

describe('applyDragEndToLayers', () => {
  it('returns null when active equals over', () => {
    expect(applyDragEndToLayers(makeLayers(), 'input-1', 'input-1')).toBeNull();
  });

  it('reorders inputs within the same layer', () => {
    const result = applyDragEndToLayers(makeLayers(), 'input-1', 'input-2');
    expect(result?.[0].inputs.map((i) => i.inputId)).toEqual([
      'input-2',
      'input-1',
    ]);
  });

  it('reorders layers', () => {
    const result = applyDragEndToLayers(
      makeLayers(),
      'layer::layer-a',
      'layer::layer-b',
    );
    expect(result?.map((l) => l.id)).toEqual(['layer-b', 'layer-a']);
  });

  it('returns null for cross-layer input drops (handled by drag-over)', () => {
    expect(applyDragEndToLayers(makeLayers(), 'input-1', 'input-3')).toBeNull();
  });
});
