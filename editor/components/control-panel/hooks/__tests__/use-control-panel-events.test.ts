import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Input } from '@/lib/types';
import { applyTextColorFromVoice } from '../use-control-panel-events';

type UpdateInputFn = (typeof import('@/app/actions/actions'))['updateInput'];

class TestCustomEvent<T = unknown> extends Event {
  detail: T;

  constructor(type: string, eventInitDict?: CustomEventInit<T>) {
    super(type);
    this.detail = eventInitDict?.detail as T;
  }
}

function createInput(overrides: Partial<Input>): Input {
  return {
    inputId: 'input-1',
    type: 'text-input',
    hidden: false,
    volume: 1,
    ...overrides,
  } as Input;
}

describe('applyTextColorFromVoice', () => {
  beforeEach(() => {
    if (typeof globalThis.CustomEvent === 'undefined') {
      (globalThis as { CustomEvent: typeof CustomEvent }).CustomEvent =
        TestCustomEvent as unknown as typeof CustomEvent;
    }
  });

  it('updates input and syncs timeline clip settings in order', async () => {
    const order: string[] = [];
    const updateInputFn = vi.fn(async () => {
      order.push('update-input');
    });
    const handleRefreshState = vi.fn(async () => {
      order.push('refresh-state');
    });
    const dispatchEvent = vi.fn((event: Event) => {
      order.push('dispatch-timeline-patch');
      return true;
    });

    const didApply = await applyTextColorFromVoice({
      color: '#ff0000',
      inputs: [createInput({ inputId: 'text-1', volume: 0.8 })],
      selectedInputId: 'text-1',
      roomId: 'room-1',
      handleRefreshState,
      dispatchEvent,
      updateInputFn: updateInputFn as unknown as UpdateInputFn,
    });

    expect(didApply).toBe(true);
    expect(updateInputFn).toHaveBeenCalledWith('room-1', 'text-1', {
      textColor: '#ff0000',
      volume: 0.8,
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);

    const dispatchedEvent = dispatchEvent.mock.calls[0][0] as CustomEvent<{
      inputId: string;
      patch: { textColor: string };
    }>;
    expect(dispatchedEvent.type).toBe(
      'smelter:timeline:update-clip-settings-for-input',
    );
    expect(dispatchedEvent.detail).toEqual({
      inputId: 'text-1',
      patch: { textColor: '#ff0000' },
    });
    expect(handleRefreshState).toHaveBeenCalledTimes(1);
    expect(order).toEqual([
      'update-input',
      'dispatch-timeline-patch',
      'refresh-state',
    ]);
  });

  it('returns false when selected input is not text-input', async () => {
    const updateInputFn = vi.fn(async () => {});
    const handleRefreshState = vi.fn(async () => {});
    const dispatchEvent = vi.fn(() => true);

    const didApply = await applyTextColorFromVoice({
      color: '#00ff00',
      inputs: [createInput({ inputId: 'camera-1', type: 'whip' })],
      selectedInputId: 'camera-1',
      roomId: 'room-1',
      handleRefreshState,
      dispatchEvent,
      updateInputFn: updateInputFn as unknown as UpdateInputFn,
    });

    expect(didApply).toBe(false);
    expect(updateInputFn).not.toHaveBeenCalled();
    expect(dispatchEvent).not.toHaveBeenCalled();
    expect(handleRefreshState).not.toHaveBeenCalled();
  });
});
