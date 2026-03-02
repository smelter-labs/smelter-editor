import { beforeEach, describe, expect, it } from 'vitest';
import { executeMacro } from '../macroExecutor';
import type { MacroDefinition } from '../macroTypes';

class TestCustomEvent<T = unknown> extends Event {
  detail: T;

  constructor(type: string, eventInitDict?: CustomEventInit<T>) {
    super(type);
    this.detail = eventInitDict?.detail as T;
  }
}

describe('macroExecutor', () => {
  beforeEach(() => {
    if (typeof globalThis.CustomEvent === 'undefined') {
      (globalThis as { CustomEvent: typeof CustomEvent }).CustomEvent =
        TestCustomEvent as unknown as typeof CustomEvent;
    }
    (globalThis as { window: EventTarget }).window = new EventTarget();
  });

  it('waits for HIDE_ALL_INPUTS completion before next step', async () => {
    const order: string[] = [];
    let capturedRequestId: string | undefined;

    window.addEventListener('smelter:voice:hide-all-inputs', (event) => {
      order.push('hide-all');
      const detail = (event as CustomEvent<{ requestId?: string }>).detail;
      capturedRequestId = detail?.requestId;
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('smelter:voice:macro-step-complete', {
            detail: { requestId: capturedRequestId },
          }),
        );
      }, 0);
    });
    window.addEventListener('smelter:voice:add-input', () => {
      order.push('add-input');
    });

    const macro: MacroDefinition = {
      id: 'hide-then-add',
      triggers: ['hide then add'],
      description: 'Hides all and then adds an input',
      steps: [
        { action: 'HIDE_ALL_INPUTS', delayAfterMs: 0 },
        {
          action: 'ADD_INPUT',
          params: { inputType: 'camera' },
          delayAfterMs: 0,
        },
      ],
    };

    await executeMacro(macro);

    expect(capturedRequestId).toBeTypeOf('string');
    expect(order).toEqual(['hide-all', 'add-input']);
  });

  it('passes requestId for REMOVE_ALL_INPUTS and resolves after completion', async () => {
    let capturedRequestId: string | undefined;

    window.addEventListener('smelter:voice:remove-all-inputs', (event) => {
      const detail = (event as CustomEvent<{ requestId?: string }>).detail;
      capturedRequestId = detail?.requestId;
      window.dispatchEvent(
        new CustomEvent('smelter:voice:macro-step-complete', {
          detail: { requestId: capturedRequestId },
        }),
      );
    });

    const macro: MacroDefinition = {
      id: 'remove-all',
      triggers: ['remove all'],
      description: 'Removes all',
      steps: [{ action: 'REMOVE_ALL_INPUTS', delayAfterMs: 0 }],
    };

    await executeMacro(macro);

    expect(capturedRequestId).toBeTypeOf('string');
  });
});
