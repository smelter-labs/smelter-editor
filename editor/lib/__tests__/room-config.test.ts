import { describe, it, expect } from 'vitest';
import {
  exportRoomConfig,
  parseRoomConfig,
  type RoomConfigTransitionSettings,
} from '../room-config';
import type { Input, Layout } from '@/app/actions/actions';

describe('parseRoomConfig', () => {
  it('parses valid config v1', () => {
    const json = JSON.stringify({
      version: 1,
      layout: 'picture-in-picture',
      inputs: [
        {
          type: 'text-input',
          title: 'Text',
          description: '',
          volume: 1,
          shaders: [],
        },
      ],
      exportedAt: new Date().toISOString(),
    });
    const config = parseRoomConfig(json);
    expect(config.version).toBe(1);
    expect(config.layout).toBe('picture-in-picture');
    expect(config.inputs).toHaveLength(1);
    expect(config.inputs[0].type).toBe('text-input');
  });

  it('throws on unsupported version', () => {
    const json = JSON.stringify({
      version: 2,
      layout: 'grid',
      inputs: [],
      exportedAt: new Date().toISOString(),
    });
    expect(() => parseRoomConfig(json)).toThrow('Unsupported config version');
  });

  it('throws on invalid format (missing layout)', () => {
    const json = JSON.stringify({
      version: 1,
      inputs: [],
      exportedAt: new Date().toISOString(),
    });
    expect(() => parseRoomConfig(json)).toThrow('Invalid config format');
  });

  it('throws on invalid format (inputs not array)', () => {
    const json = JSON.stringify({
      version: 1,
      layout: 'grid',
      inputs: null,
      exportedAt: new Date().toISOString(),
    });
    expect(() => parseRoomConfig(json)).toThrow('Invalid config format');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseRoomConfig('not json')).toThrow();
  });
});

describe('exportRoomConfig', () => {
  const minimalInput: Input = {
    id: 0,
    inputId: 'room::text::1',
    title: 'Text',
    description: '',
    volume: 1,
    type: 'text-input',
    sourceState: 'always-live',
    status: 'connected',
    shaders: [],
    orientation: 'horizontal',
  };

  it('exports config with inputs and layout', () => {
    const inputs: Input[] = [minimalInput];
    const layout: Layout = 'grid';
    const config = exportRoomConfig(inputs, layout);
    expect(config.version).toBe(1);
    expect(config.layout).toBe('grid');
    expect(config.inputs).toHaveLength(1);
    expect(config.inputs[0].type).toBe('text-input');
    expect(config.inputs[0].title).toBe('Text');
    expect(config.exportedAt).toBeDefined();
  });

  it('includes resolution and transitionSettings when provided', () => {
    const resolution = { width: 1920, height: 1080 };
    const transitionSettings: RoomConfigTransitionSettings = {
      swapDurationMs: 500,
      swapOutgoingEnabled: true,
    };
    const config = exportRoomConfig(
      [minimalInput],
      'picture-in-picture',
      resolution,
      transitionSettings,
    );
    expect(config.resolution).toEqual(resolution);
    expect(config.transitionSettings).toEqual(transitionSettings);
  });

  it('extracts mp4 file name from title for local-mp4', () => {
    const mp4Input: Input = {
      ...minimalInput,
      id: 1,
      inputId: 'room::local::2',
      type: 'local-mp4',
      title: '[MP4] My Video',
      description: '',
    };
    const config = exportRoomConfig([mp4Input], 'grid');
    expect(config.inputs[0].mp4FileName).toBe('my_video.mp4');
  });
});
