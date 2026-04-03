import { describe, it, expect, vi } from 'vitest';

vi.mock('../../snakeGame/publicSnakeGameState', () => ({
  toPublicSnakeGameInputState: vi.fn().mockReturnValue({
    gameBackgroundColor: '#000',
    gameCellGap: 2,
    snakePlayerColors: ['red'],
  }),
}));

import { toPublicInputState } from '../publicInputState';
import { toPublicSnakeGameInputState } from '../../snakeGame/publicSnakeGameState';

function makeBaseInput(overrides: Record<string, unknown> = {}) {
  return {
    inputId: 'test-input-1',
    status: 'connected' as const,
    hidden: false,
    motionEnabled: false,
    showTitle: true,
    volume: 0.8,
    shaders: [],
    borderColor: '#fff',
    borderWidth: 0,
    metadata: { title: 'Test Input', description: 'A test' },
    ...overrides,
  };
}

describe('toPublicInputState', () => {
  describe('base properties', () => {
    it('maps all shared properties correctly', () => {
      const input = {
        ...makeBaseInput({
          attachedInputIds: ['att-1'],
          activeTransition: { type: 'fade', durationMs: 500, direction: 'in' },
          absolutePosition: true,
          absoluteTop: 10,
          absoluteLeft: 20,
          absoluteWidth: 300,
          absoluteHeight: 200,
          absoluteTransitionDurationMs: 100,
          absoluteTransitionEasing: 'linear',
          cropTop: 0.1,
          cropLeft: 0.2,
          cropRight: 0.05,
          cropBottom: 0.15,
          motionScore: 42,
          nativeWidth: 1920,
          nativeHeight: 1080,
        }),
        type: 'hls' as const,
        hlsUrl: 'http://example.com/stream.m3u8',
      };

      const result = toPublicInputState(input);

      expect(result.inputId).toBe('test-input-1');
      expect(result.title).toBe('Test Input');
      expect(result.description).toBe('A test');
      expect(result.showTitle).toBe(true);
      expect(result.volume).toBe(0.8);
      expect(result.shaders).toEqual([]);
      expect(result.borderColor).toBe('#fff');
      expect(result.borderWidth).toBe(0);
      expect(result.attachedInputIds).toEqual(['att-1']);
      expect(result.hidden).toBe(false);
      expect(result.activeTransition).toEqual({
        type: 'fade',
        durationMs: 500,
        direction: 'in',
      });
      expect(result.absolutePosition).toBe(true);
      expect(result.absoluteTop).toBe(10);
      expect(result.absoluteLeft).toBe(20);
      expect(result.absoluteWidth).toBe(300);
      expect(result.absoluteHeight).toBe(200);
      expect(result.cropTop).toBe(0.1);
      expect(result.cropLeft).toBe(0.2);
      expect(result.cropRight).toBe(0.05);
      expect(result.cropBottom).toBe(0.15);
      expect(result.motionScore).toBe(42);
      expect(result.nativeWidth).toBe(1920);
      expect(result.nativeHeight).toBe(1080);
    });
  });

  describe('local-mp4', () => {
    it('returns sourceState "always-live" with mp4 dimensions', () => {
      const input = {
        ...makeBaseInput(),
        type: 'local-mp4' as const,
        mp4FilePath: '/tmp/video.mp4',
        mp4VideoWidth: 1920,
        mp4VideoHeight: 1080,
      };
      const result = toPublicInputState(input);
      expect(result.sourceState).toBe('always-live');
      expect(result).toHaveProperty('sourceWidth', 1920);
      expect(result).toHaveProperty('sourceHeight', 1080);
    });
  });

  describe('image', () => {
    it('returns sourceState "always-live" with imageId', () => {
      const input = {
        ...makeBaseInput(),
        type: 'image' as const,
        imageId: 'img-123',
      };
      const result = toPublicInputState(input);
      expect(result.sourceState).toBe('always-live');
      expect(result).toHaveProperty('imageId', 'img-123');
    });
  });

  describe('twitch-channel', () => {
    it('returns sourceState "live" when monitor.isLive() is true', () => {
      const input = {
        ...makeBaseInput(),
        type: 'twitch-channel' as const,
        channelId: 'twitch-ch-1',
        hlsUrl: 'http://hls/twitch/ch1',
        monitor: { isLive: () => true, stop: vi.fn(), onUpdate: vi.fn() },
      };
      const result = toPublicInputState(input);
      expect(result.sourceState).toBe('live');
      expect(result).toHaveProperty('channelId', 'twitch-ch-1');
    });

    it('returns sourceState "offline" when monitor.isLive() is false', () => {
      const input = {
        ...makeBaseInput(),
        type: 'twitch-channel' as const,
        channelId: 'twitch-ch-1',
        hlsUrl: 'http://hls/twitch/ch1',
        monitor: { isLive: () => false, stop: vi.fn(), onUpdate: vi.fn() },
      };
      const result = toPublicInputState(input);
      expect(result.sourceState).toBe('offline');
    });
  });

  describe('kick-channel', () => {
    it('returns sourceState "live" when monitor.isLive() is true', () => {
      const input = {
        ...makeBaseInput(),
        type: 'kick-channel' as const,
        channelId: 'kick-ch-1',
        hlsUrl: 'http://hls/kick/ch1',
        monitor: { isLive: () => true, stop: vi.fn(), onUpdate: vi.fn() },
      };
      const result = toPublicInputState(input);
      expect(result.sourceState).toBe('live');
      expect(result).toHaveProperty('channelId', 'kick-ch-1');
    });

    it('returns sourceState "offline" when monitor.isLive() is false', () => {
      const input = {
        ...makeBaseInput(),
        type: 'kick-channel' as const,
        channelId: 'kick-ch-1',
        hlsUrl: 'http://hls/kick/ch1',
        monitor: { isLive: () => false, stop: vi.fn(), onUpdate: vi.fn() },
      };
      const result = toPublicInputState(input);
      expect(result.sourceState).toBe('offline');
    });
  });

  describe('hls', () => {
    it('returns sourceState "always-live"', () => {
      const input = {
        ...makeBaseInput(),
        type: 'hls' as const,
        hlsUrl: 'http://example.com/stream.m3u8',
      };
      const result = toPublicInputState(input);
      expect(result.sourceState).toBe('always-live');
    });
  });

  describe('whip', () => {
    it('returns sourceState "live" when monitor.isLive() is true', () => {
      const input = {
        ...makeBaseInput(),
        type: 'whip' as const,
        whipUrl: 'http://whip/test',
        monitor: {
          isLive: () => true,
          stop: vi.fn(),
          touch: vi.fn(),
          getUsername: vi.fn(),
          getLastAckTimestamp: vi.fn(),
        },
      };
      const result = toPublicInputState(input);
      expect(result.sourceState).toBe('live');
    });

    it('returns sourceState "offline" when monitor.isLive() is false', () => {
      const input = {
        ...makeBaseInput(),
        type: 'whip' as const,
        whipUrl: 'http://whip/test',
        monitor: {
          isLive: () => false,
          stop: vi.fn(),
          touch: vi.fn(),
          getUsername: vi.fn(),
          getLastAckTimestamp: vi.fn(),
        },
      };
      const result = toPublicInputState(input);
      expect(result.sourceState).toBe('offline');
    });
  });

  describe('text-input', () => {
    it('includes all text-specific properties', () => {
      const input = {
        ...makeBaseInput(),
        type: 'text-input' as const,
        text: 'Hello World',
        textAlign: 'center' as const,
        textColor: '#ff0000',
        textMaxLines: 3,
        textScrollSpeed: 50,
        textScrollLoop: true,
        textScrollNudge: 10,
        textFontSize: 24,
      };
      const result = toPublicInputState(input);
      expect(result.sourceState).toBe('always-live');
      expect(result).toHaveProperty('text', 'Hello World');
      expect(result).toHaveProperty('textAlign', 'center');
      expect(result).toHaveProperty('textColor', '#ff0000');
      expect(result).toHaveProperty('textMaxLines', 3);
      expect(result).toHaveProperty('textScrollSpeed', 50);
      expect(result).toHaveProperty('textScrollLoop', true);
      expect(result).toHaveProperty('textScrollNudge', 10);
      expect(result).toHaveProperty('textFontSize', 24);
    });
  });

  describe('game', () => {
    it('delegates to toPublicSnakeGameInputState and merges result', () => {
      const snakeGameState = {
        backgroundColor: '#000',
        cellGap: 2,
        boardBorderColor: '#fff',
        boardBorderWidth: 1,
        gridLineColor: '#333',
        gridLineAlpha: 0.5,
        cells: [],
      };
      const input = {
        ...makeBaseInput(),
        type: 'game' as const,
        snakeGameState,
        snakeEventShaders: undefined,
        snake1Shaders: [],
        snake2Shaders: [],
        activeEffects: [],
        effectTimers: [],
      };
      const result = toPublicInputState(input);
      expect(result.sourceState).toBe('always-live');
      expect(toPublicSnakeGameInputState).toHaveBeenCalledWith(input);
      expect(result).toHaveProperty('gameBackgroundColor', '#000');
      expect(result).toHaveProperty('snakePlayerColors', ['red']);
    });
  });

  describe('hands', () => {
    it('returns sourceState "always-live" with handsSourceInputId', () => {
      const input = {
        ...makeBaseInput(),
        type: 'hands' as const,
        sourceInputId: 'source-input-42',
        handsStore: {} as any,
      };
      const result = toPublicInputState(input);
      expect(result.sourceState).toBe('always-live');
      expect(result).toHaveProperty('handsSourceInputId', 'source-input-42');
    });
  });

  describe('unknown type', () => {
    it('throws "Unknown input state"', () => {
      const input = {
        ...makeBaseInput(),
        type: 'nonexistent' as any,
      };
      expect(() => toPublicInputState(input)).toThrow('Unknown input state');
    });
  });
});
