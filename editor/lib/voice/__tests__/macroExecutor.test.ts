import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMacroExecutionController,
  executeMacro,
  findMatchingMacro,
  getMacroById,
  type MacroExecutionStatus,
} from '../macroExecutor';
import type { MacroDefinition } from '../macroTypes';

class TestCustomEvent<T = unknown> extends Event {
  detail: T;

  constructor(type: string, eventInitDict?: CustomEventInit<T>) {
    super(type);
    this.detail = eventInitDict?.detail as T;
  }
}

function createMacro(
  steps: MacroDefinition['steps'],
  overrides: Partial<MacroDefinition> = {},
): MacroDefinition {
  return {
    id: 'test-macro',
    description: 'test macro',
    triggers: ['test macro'],
    steps,
    ...overrides,
  };
}

function installMacroStepAck(
  eventType: string,
  onDispatch?: (detail: Record<string, unknown>) => void,
) {
  window.addEventListener(eventType, ((event: Event) => {
    const detail = (event as CustomEvent<Record<string, unknown>>).detail;
    onDispatch?.(detail);
    window.dispatchEvent(
      new CustomEvent('smelter:voice:macro-step-complete', {
        detail: {
          requestId: detail.requestId,
        },
      }),
    );
  }) as EventListener);
}

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'CustomEvent',
    TestCustomEvent as unknown as typeof CustomEvent,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('findMatchingMacro', () => {
  describe('exact substring matching', () => {
    it('matches an exact trigger string', () => {
      const result = findMatchingMacro('galactic spaceship');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('galactic-spaceship');
    });

    it('matches when transcript contains the trigger', () => {
      const result = findMatchingMacro('please do galactic spaceship now');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('galactic-spaceship');
    });

    it('matches when trigger contains the transcript', () => {
      const result = findMatchingMacro('two cameras');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('dual-camera-setup');
    });
  });

  describe('fuzzy matching (Levenshtein fallback)', () => {
    it('matches a trigger with a small typo', () => {
      const result = findMatchingMacro('galactic spaceships');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('galactic-spaceship');
    });

    it('matches a trigger with a missing letter', () => {
      const result = findMatchingMacro('galactic spachip');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('galactic-spaceship');
    });

    it('matches a trigger with a substitution', () => {
      const result = findMatchingMacro('galactic camara');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('galactic-camera');
    });

    it('does not match completely unrelated text', () => {
      const result = findMatchingMacro('the weather is nice today');
      expect(result).toBeNull();
    });

    it('does not match short gibberish', () => {
      const result = findMatchingMacro('xyz abc');
      expect(result).toBeNull();
    });

    it('fuzzy matches a trigger surrounded by extra words', () => {
      const result = findMatchingMacro('please do galactic spaceships now');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('galactic-spaceship');
    });

    it('fuzzy matches a typo inside a longer sentence', () => {
      const result = findMatchingMacro('can you run galactic camara please');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('galactic-camera');
    });
  });

  describe('exact match takes priority over fuzzy', () => {
    it('prefers exact substring over a closer fuzzy match', () => {
      const result = findMatchingMacro('reset to camera');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('reset-to-camera');
    });
  });
});

describe('macro execution controller', () => {
  it('waits for add-input completion and selects the newly created input', async () => {
    const events: Array<{ type: string; detail: Record<string, unknown> }> = [];

    window.addEventListener('smelter:voice:add-input', ((event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      events.push({ type: 'smelter:voice:add-input', detail });
      window.dispatchEvent(
        new CustomEvent('smelter:voice:macro-step-complete', {
          detail: {
            requestId: detail.requestId,
            inputId: 'input-42',
          },
        }),
      );
    }) as EventListener);

    window.addEventListener('smelter:inputs:select', ((event: Event) => {
      events.push({
        type: 'smelter:inputs:select',
        detail: (event as CustomEvent<Record<string, unknown>>).detail,
      });
    }) as EventListener);

    window.addEventListener('smelter:voice:add-shader', ((event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      events.push({
        type: 'smelter:voice:add-shader',
        detail,
      });
      window.dispatchEvent(
        new CustomEvent('smelter:voice:macro-step-complete', {
          detail: { requestId: detail.requestId },
        }),
      );
    }) as EventListener);

    await executeMacro(
      createMacro([
        {
          action: 'ADD_INPUT',
          delayAfterMs: 0,
          params: { inputType: 'camera' },
        },
        {
          action: 'ADD_SHADER',
          delayAfterMs: 0,
          params: { shader: 'sw-hologram' },
        },
      ]),
    );

    expect(events).toEqual([
      {
        type: 'smelter:voice:add-input',
        detail: expect.objectContaining({
          inputType: 'camera',
          requestId: expect.any(String),
        }),
      },
      {
        type: 'smelter:inputs:select',
        detail: { inputId: 'input-42' },
      },
      {
        type: 'smelter:voice:add-shader',
        detail: expect.objectContaining({
          shader: 'sw-hologram',
          requestId: expect.any(String),
        }),
      },
    ]);
  });

  it('supports step-by-step execution, play, and requestId propagation', async () => {
    const statuses: MacroExecutionStatus[] = [];
    const requestIds: string[] = [];

    installMacroStepAck('smelter:voice:remove-input', (detail) => {
      requestIds.push(String(detail.requestId));
    });

    const controller = createMacroExecutionController(
      createMacro([
        {
          action: 'REMOVE_INPUT',
          delayAfterMs: 0,
          params: { inputIndex: 1 },
        },
        {
          action: 'REMOVE_INPUT',
          delayAfterMs: 0,
          params: { inputIndex: 2 },
        },
      ]),
      {
        onStatusChange: (status) => statuses.push(status),
      },
      { autoPlay: false },
    );

    await controller.start();
    expect(controller.getStatus()).toBe('paused');

    await controller.nextStep();
    expect(controller.getCurrentStepIndex()).toBe(1);
    expect(controller.getStatus()).toBe('paused');

    await controller.play();
    expect(controller.getStatus()).toBe('completed');
    expect(requestIds).toHaveLength(2);
    expect(requestIds.every(Boolean)).toBe(true);
    expect(statuses).toContain('paused');
    expect(statuses.at(-1)).toBe('completed');
  });

  it('stops paused execution without dispatching more steps', async () => {
    let dispatchedSteps = 0;
    installMacroStepAck('smelter:voice:remove-input', () => {
      dispatchedSteps += 1;
    });

    const stopped = vi.fn();
    const controller = createMacroExecutionController(
      createMacro([
        {
          action: 'REMOVE_INPUT',
          delayAfterMs: 0,
          params: { inputIndex: 1 },
        },
      ]),
      {
        onMacroStopped: stopped,
      },
      { autoPlay: false },
    );

    await controller.start();
    controller.stop();
    await controller.nextStep();

    expect(controller.getStatus()).toBe('stopped');
    expect(controller.isDone()).toBe(true);
    expect(dispatchedSteps).toBe(0);
    expect(stopped).toHaveBeenCalledTimes(1);
  });
});

describe('galactic macro definitions', () => {
  it('uses selection context instead of hard-coded indices for galactic camera', () => {
    const macro = getMacroById('galactic-camera');

    expect(macro?.continueListening).toBe(true);
    expect(
      macro?.steps
        .slice(1)
        .every((step) => step.params?.inputIndex === undefined),
    ).toBe(true);
  });

  it('uses selection context instead of hard-coded indices for galactic text', () => {
    const macro = getMacroById('galactic-text');

    expect(macro?.continueListening).toBe(true);
    expect(
      macro?.steps
        .slice(1)
        .every((step) => step.params?.inputIndex === undefined),
    ).toBe(true);
  });
});
