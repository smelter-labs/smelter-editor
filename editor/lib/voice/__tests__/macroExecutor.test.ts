import { beforeEach, describe, expect, it } from 'vitest';
import { createMacroExecutionController, executeMacro } from '../macroExecutor';
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

  it('runs one step at a time in step mode', async () => {
    const order: string[] = [];

    window.addEventListener('smelter:voice:add-input', (event) => {
      const detail = (
        event as CustomEvent<{ inputType?: string; mp4FileName?: string }>
      ).detail;
      order.push(`add-${detail?.inputType ?? 'unknown'}`);
    });

    const macro: MacroDefinition = {
      id: 'step-mode',
      triggers: ['step mode'],
      description: 'Step mode',
      steps: [
        {
          action: 'ADD_INPUT',
          params: { inputType: 'camera' },
          delayAfterMs: 0,
        },
        { action: 'ADD_INPUT', params: { inputType: 'mp4' }, delayAfterMs: 0 },
      ],
    };

    const controller = createMacroExecutionController(
      macro,
      {},
      { autoPlay: false },
    );
    await controller.start();

    expect(controller.getStatus()).toBe('paused');
    expect(order).toEqual([]);

    await controller.nextStep();
    expect(order).toEqual(['add-camera']);
    expect(controller.getStatus()).toBe('paused');

    await controller.nextStep();
    expect(order).toEqual(['add-camera', 'add-mp4']);
    expect(controller.getStatus()).toBe('completed');
  });

  it('plays remaining steps after pause', async () => {
    const order: string[] = [];

    window.addEventListener('smelter:voice:add-input', (event) => {
      const detail = (
        event as CustomEvent<{ inputType?: string; mp4FileName?: string }>
      ).detail;
      order.push(`add-${detail?.inputType ?? 'unknown'}`);
    });

    const macro: MacroDefinition = {
      id: 'step-play',
      triggers: ['step play'],
      description: 'Step play',
      steps: [
        {
          action: 'ADD_INPUT',
          params: { inputType: 'camera' },
          delayAfterMs: 0,
        },
        { action: 'ADD_INPUT', params: { inputType: 'mp4' }, delayAfterMs: 0 },
        {
          action: 'ADD_INPUT',
          params: { inputType: 'image' },
          delayAfterMs: 0,
        },
      ],
    };

    const controller = createMacroExecutionController(
      macro,
      {},
      { autoPlay: false },
    );
    await controller.start();
    await controller.nextStep();
    await controller.play();

    expect(order).toEqual(['add-camera', 'add-mp4', 'add-image']);
    expect(controller.getStatus()).toBe('completed');
  });

  it('stops macro and does not execute further steps', async () => {
    const order: string[] = [];
    let stoppedAt = -1;

    window.addEventListener('smelter:voice:add-input', (event) => {
      const detail = (
        event as CustomEvent<{ inputType?: string; mp4FileName?: string }>
      ).detail;
      order.push(`add-${detail?.inputType ?? 'unknown'}`);
    });

    const macro: MacroDefinition = {
      id: 'step-stop',
      triggers: ['step stop'],
      description: 'Step stop',
      steps: [
        {
          action: 'ADD_INPUT',
          params: { inputType: 'camera' },
          delayAfterMs: 0,
        },
        { action: 'ADD_INPUT', params: { inputType: 'mp4' }, delayAfterMs: 0 },
      ],
    };

    const controller = createMacroExecutionController(
      macro,
      {
        onMacroStopped: (_macro, index) => {
          stoppedAt = index;
        },
      },
      { autoPlay: false },
    );
    await controller.start();
    controller.stop();
    await controller.nextStep();

    expect(order).toEqual([]);
    expect(controller.getStatus()).toBe('stopped');
    expect(stoppedAt).toBe(0);
  });
});
