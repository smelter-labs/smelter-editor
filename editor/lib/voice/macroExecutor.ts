import type { MacroDefinition, MacroStep, MacrosConfig } from './macroTypes';
import { normalize } from './normalize';
import { levenshteinSimilarity } from './levenshtein';

import macrosJson from './macros.json';

const macrosConfig: MacrosConfig = macrosJson as MacrosConfig;

const FUZZY_MATCH_THRESHOLD = 0.8;
const MIN_TRIGGER_LENGTH_FOR_FUZZY = 8;

function isDestructiveMacro(macro: MacroDefinition): boolean {
  return macro.steps.some(
    (step) =>
      step.action === 'REMOVE_ALL_INPUTS' || step.action === 'HIDE_ALL_INPUTS',
  );
}

export function findMatchingMacro(transcript: string): MacroDefinition | null {
  const normalized = normalize(transcript);

  for (const macro of macrosConfig.macros) {
    for (const trigger of macro.triggers) {
      const normalizedTrigger = normalize(trigger);
      if (normalized.includes(normalizedTrigger)) {
        return macro;
      }
      if (
        normalizedTrigger.includes(normalized) &&
        normalized.length >= Math.max(10, normalizedTrigger.length * 0.6)
      ) {
        return macro;
      }
    }
  }

  let bestMatch: MacroDefinition | null = null;
  let bestSimilarity = 0;
  const transcriptWords = normalized.split(/\s+/);

  for (const macro of macrosConfig.macros) {
    if (isDestructiveMacro(macro)) {
      continue;
    }
    for (const trigger of macro.triggers) {
      const normalizedTrigger = normalize(trigger);
      if (normalizedTrigger.length < MIN_TRIGGER_LENGTH_FOR_FUZZY) {
        continue;
      }
      const triggerWords = normalizedTrigger.split(/\s+/);
      const windowSize = triggerWords.length;

      for (let i = 0; i <= transcriptWords.length - windowSize; i++) {
        const segment = transcriptWords.slice(i, i + windowSize).join(' ');
        const similarity = levenshteinSimilarity(segment, normalizedTrigger);
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestMatch = macro;
        }
      }

      if (transcriptWords.length < windowSize) {
        const similarity = levenshteinSimilarity(normalized, normalizedTrigger);
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestMatch = macro;
        }
      }
    }
  }

  if (bestSimilarity >= FUZZY_MATCH_THRESHOLD) {
    return bestMatch;
  }

  return null;
}

export function getAllMacros(): MacroDefinition[] {
  return macrosConfig.macros;
}

export function getMacroById(id: string): MacroDefinition | null {
  return macrosConfig.macros.find((m) => m.id === id) ?? null;
}

export type MacroExecutionCallbacks = {
  onStepStart?: (step: MacroStep, index: number, total: number) => void;
  onStepComplete?: (step: MacroStep, index: number, total: number) => void;
  onMacroComplete?: (macro: MacroDefinition) => void;
  onMacroStopped?: (
    macro: MacroDefinition,
    index: number,
    total: number,
  ) => void;
  onStatusChange?: (
    status: MacroExecutionStatus,
    index: number,
    total: number,
  ) => void;
  onError?: (error: Error, step: MacroStep, index: number) => void;
};

export type MacroExecutionStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'stopped'
  | 'error';

type CreateMacroExecutionControllerOptions = {
  autoPlay?: boolean;
};

export type MacroExecutionController = {
  start: () => Promise<void>;
  nextStep: () => Promise<void>;
  play: () => Promise<void>;
  stop: () => void;
  getStatus: () => MacroExecutionStatus;
  getCurrentStepIndex: () => number;
  isDone: () => boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createMacroRequestId(): string {
  return `macro-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type MacroStepCompletionDetail = {
  requestId?: string;
  error?: string;
  inputId?: string;
};

type MacroExecutionContext = {
  currentInputId?: string;
};

type MacroStepDispatchResult = {
  detail: MacroStepCompletionDetail;
  resolvedParams?: MacroStep['params'];
};

async function dispatchAndWaitForCompletionDetail(
  dispatch: (requestId: string) => void,
  timeoutMs = 30_000,
): Promise<MacroStepCompletionDetail> {
  const requestId = createMacroRequestId();
  return new Promise<MacroStepCompletionDetail>((resolve, reject) => {
    const timeout = setTimeout(() => {
      window.removeEventListener(
        'smelter:voice:macro-step-complete',
        onComplete as EventListener,
      );
      reject(new Error(`Macro step timed out for requestId=${requestId}`));
    }, timeoutMs);

    const onComplete = (e: CustomEvent<MacroStepCompletionDetail>) => {
      if (e.detail?.requestId !== requestId) {
        return;
      }
      clearTimeout(timeout);
      window.removeEventListener(
        'smelter:voice:macro-step-complete',
        onComplete as EventListener,
      );
      if (e.detail?.error) {
        reject(new Error(e.detail.error));
        return;
      }
      resolve(e.detail ?? {});
    };

    window.addEventListener(
      'smelter:voice:macro-step-complete',
      onComplete as EventListener,
    );
    dispatch(requestId);
  });
}

export async function executeMacro(
  macro: MacroDefinition,
  callbacks: MacroExecutionCallbacks = {},
): Promise<void> {
  const controller = createMacroExecutionController(macro, callbacks, {
    autoPlay: true,
  });
  await controller.start();
}

function resolveStepParams(
  step: MacroStep,
  context: MacroExecutionContext,
): MacroStep['params'] {
  const params = step.params;
  if (!params) {
    return undefined;
  }

  if (params.inputId || params.inputIndex !== undefined) {
    return params;
  }

  if (!context.currentInputId) {
    return params;
  }

  return {
    ...params,
    inputId: context.currentInputId,
  };
}

function updateMacroExecutionContext(
  action: MacroStep['action'],
  context: MacroExecutionContext,
  detail: MacroStepCompletionDetail,
  params?: MacroStep['params'],
) {
  const resolvedInputId = detail.inputId ?? params?.inputId;

  if (action === 'DESELECT_INPUT' || action === 'REMOVE_ALL_INPUTS') {
    context.currentInputId = undefined;
    return;
  }

  if (action === 'REMOVE_INPUT' && resolvedInputId === context.currentInputId) {
    context.currentInputId = undefined;
    return;
  }

  if (resolvedInputId) {
    context.currentInputId = resolvedInputId;
  }
}

async function dispatchMacroStep(
  step: MacroStep,
  context: MacroExecutionContext,
): Promise<MacroStepDispatchResult> {
  const { action } = step;
  const params = resolveStepParams(step, context);

  switch (action) {
    case 'ADD_INPUT': {
      const detail = await dispatchAndWaitForCompletionDetail((requestId) =>
        window.dispatchEvent(
          new CustomEvent('smelter:voice:add-input', {
            detail: {
              requestId,
              inputType: params?.inputType,
              text: params?.text,
              textAlign: params?.textAlign,
              mp4FileName: params?.mp4Name,
              imageFileName: params?.imageName,
            },
          }),
        ),
      );
      if (detail.inputId) {
        window.dispatchEvent(
          new CustomEvent('smelter:inputs:select', {
            detail: { inputId: detail.inputId },
          }),
        );
      }
      return { detail, resolvedParams: params };
    }

    case 'REMOVE_INPUT':
      return {
        detail: await dispatchAndWaitForCompletionDetail((requestId) =>
          window.dispatchEvent(
            new CustomEvent('smelter:voice:remove-input', {
              detail: {
                inputIndex: params?.inputIndex,
                inputId: params?.inputId,
                requestId,
              },
            }),
          ),
        ),
        resolvedParams: params,
      };

    case 'HIDE_ALL_INPUTS':
      return {
        detail: await dispatchAndWaitForCompletionDetail((requestId) =>
          window.dispatchEvent(
            new CustomEvent('smelter:voice:hide-all-inputs', {
              detail: { requestId },
            }),
          ),
        ),
        resolvedParams: params,
      };

    case 'REMOVE_ALL_INPUTS':
      return {
        detail: await dispatchAndWaitForCompletionDetail((requestId) =>
          window.dispatchEvent(
            new CustomEvent('smelter:voice:remove-all-inputs', {
              detail: { requestId },
            }),
          ),
        ),
        resolvedParams: params,
      };

    case 'MOVE_INPUT':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:move-input', {
          detail: {
            inputIndex: params?.inputIndex,
            direction: params?.direction?.toLowerCase(),
            steps: params?.steps ?? 1,
          },
        }),
      );
      return { detail: {}, resolvedParams: params };

    case 'ADD_SHADER':
      return {
        detail: await dispatchAndWaitForCompletionDetail((requestId) =>
          window.dispatchEvent(
            new CustomEvent('smelter:voice:add-shader', {
              detail: {
                requestId,
                inputIndex: params?.inputIndex,
                inputId: params?.inputId,
                shader: params?.shader,
                targetColor: params?.targetColor,
                shaderParams: params?.shaderParams,
              },
            }),
          ),
        ),
        resolvedParams: params,
      };

    case 'REMOVE_SHADER':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:remove-shader', {
          detail: {
            inputIndex: params?.inputIndex,
            inputId: params?.inputId,
            shader: params?.shader,
          },
        }),
      );
      return { detail: {}, resolvedParams: params };

    case 'SELECT_INPUT':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:select-input', {
          detail: { inputIndex: params?.inputIndex, inputId: params?.inputId },
        }),
      );
      return { detail: {}, resolvedParams: params };

    case 'DESELECT_INPUT':
      window.dispatchEvent(new CustomEvent('smelter:voice:deselect-input'));
      return { detail: {}, resolvedParams: params };

    case 'SELECT_TRACK':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:select-track', {
          detail: { trackIndex: params?.trackIndex },
        }),
      );
      return { detail: {}, resolvedParams: params };

    case 'REMOVE_TRACK':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:remove-track', {
          detail: { trackIndex: params?.trackIndex },
        }),
      );
      return { detail: {}, resolvedParams: params };

    case 'NEXT_BLOCK':
      window.dispatchEvent(new CustomEvent('smelter:voice:next-block'));
      return { detail: {}, resolvedParams: params };

    case 'PREV_BLOCK':
      window.dispatchEvent(new CustomEvent('smelter:voice:prev-block'));
      return { detail: {}, resolvedParams: params };

    case 'NEXT_LAYOUT':
      window.dispatchEvent(new CustomEvent('smelter:voice:next-layout'));
      return { detail: {}, resolvedParams: params };

    case 'PREVIOUS_LAYOUT':
      window.dispatchEvent(new CustomEvent('smelter:voice:previous-layout'));
      return { detail: {}, resolvedParams: params };

    case 'SET_LAYOUT':
      return {
        detail: await dispatchAndWaitForCompletionDetail((requestId) =>
          window.dispatchEvent(
            new CustomEvent('smelter:voice:set-layout', {
              detail: { layout: params?.layout, requestId },
            }),
          ),
        ),
        resolvedParams: params,
      };

    case 'SET_TEXT_COLOR':
      return {
        detail: await dispatchAndWaitForCompletionDetail((requestId) =>
          window.dispatchEvent(
            new CustomEvent('smelter:voice:set-text-color', {
              detail: {
                color: params?.color,
                inputIndex: params?.inputIndex,
                inputId: params?.inputId,
                requestId,
              },
            }),
          ),
        ),
        resolvedParams: params,
      };

    case 'SET_TEXT_MAX_LINES':
      return {
        detail: await dispatchAndWaitForCompletionDetail((requestId) =>
          window.dispatchEvent(
            new CustomEvent('smelter:voice:set-text-max-lines', {
              detail: {
                maxLines: params?.maxLines,
                inputIndex: params?.inputIndex,
                inputId: params?.inputId,
                requestId,
              },
            }),
          ),
        ),
        resolvedParams: params,
      };

    case 'SET_TEXT':
      return {
        detail: await dispatchAndWaitForCompletionDetail((requestId) =>
          window.dispatchEvent(
            new CustomEvent('smelter:voice:set-text', {
              detail: {
                text: params?.text,
                inputIndex: params?.inputIndex,
                inputId: params?.inputId,
                requestId,
              },
            }),
          ),
        ),
        resolvedParams: params,
      };

    case 'SET_TEXT_FONT_SIZE':
      return {
        detail: await dispatchAndWaitForCompletionDetail((requestId) =>
          window.dispatchEvent(
            new CustomEvent('smelter:voice:set-text-font-size', {
              detail: {
                fontSize: params?.fontSize,
                inputIndex: params?.inputIndex,
                inputId: params?.inputId,
                requestId,
              },
            }),
          ),
        ),
        resolvedParams: params,
      };

    case 'SET_TEXT_SCROLL_SPEED':
      return {
        detail: await dispatchAndWaitForCompletionDetail((requestId) =>
          window.dispatchEvent(
            new CustomEvent('smelter:voice:set-text-scroll-speed', {
              detail: {
                scrollSpeed: params?.scrollSpeed,
                inputIndex: params?.inputIndex,
                inputId: params?.inputId,
                requestId,
              },
            }),
          ),
        ),
        resolvedParams: params,
      };

    case 'SET_TEXT_ALIGN':
      return {
        detail: await dispatchAndWaitForCompletionDetail((requestId) =>
          window.dispatchEvent(
            new CustomEvent('smelter:voice:set-text-align', {
              detail: {
                textAlign: params?.textAlign,
                inputIndex: params?.inputIndex,
                inputId: params?.inputId,
                requestId,
              },
            }),
          ),
        ),
        resolvedParams: params,
      };

    case 'START_RECORDING':
      return {
        detail: await dispatchAndWaitForCompletionDetail((requestId) =>
          window.dispatchEvent(
            new CustomEvent('smelter:voice:start-recording', {
              detail: { requestId },
            }),
          ),
        ),
        resolvedParams: params,
      };

    case 'STOP_RECORDING':
      return {
        detail: await dispatchAndWaitForCompletionDetail((requestId) =>
          window.dispatchEvent(
            new CustomEvent('smelter:voice:stop-recording', {
              detail: { requestId },
            }),
          ),
        ),
        resolvedParams: params,
      };

    case 'SET_SWAP_DURATION':
      return {
        detail: await dispatchAndWaitForCompletionDetail((requestId) =>
          window.dispatchEvent(
            new CustomEvent('smelter:voice:set-swap-duration', {
              detail: { durationMs: params?.durationMs, requestId },
            }),
          ),
        ),
        resolvedParams: params,
      };

    case 'SET_SWAP_FADE_IN_DURATION':
      return {
        detail: await dispatchAndWaitForCompletionDetail((requestId) =>
          window.dispatchEvent(
            new CustomEvent('smelter:voice:set-swap-fade-in-duration', {
              detail: { durationMs: params?.durationMs, requestId },
            }),
          ),
        ),
        resolvedParams: params,
      };

    case 'SET_SWAP_FADE_OUT_DURATION':
      return {
        detail: await dispatchAndWaitForCompletionDetail((requestId) =>
          window.dispatchEvent(
            new CustomEvent('smelter:voice:set-swap-fade-out-duration', {
              detail: { durationMs: params?.durationMs, requestId },
            }),
          ),
        ),
        resolvedParams: params,
      };

    case 'SET_SWAP_OUTGOING_ENABLED':
      return {
        detail: await dispatchAndWaitForCompletionDetail((requestId) =>
          window.dispatchEvent(
            new CustomEvent('smelter:voice:set-swap-outgoing-enabled', {
              detail: { enabled: params?.enabled, requestId },
            }),
          ),
        ),
        resolvedParams: params,
      };

    case 'SET_NEWS_STRIP_ENABLED':
      return {
        detail: await dispatchAndWaitForCompletionDetail((requestId) =>
          window.dispatchEvent(
            new CustomEvent('smelter:voice:set-news-strip-enabled', {
              detail: { enabled: params?.enabled, requestId },
            }),
          ),
        ),
        resolvedParams: params,
      };

    case 'SET_NEWS_STRIP_FADE_DURING_SWAP':
      return {
        detail: await dispatchAndWaitForCompletionDetail((requestId) =>
          window.dispatchEvent(
            new CustomEvent('smelter:voice:set-news-strip-fade-during-swap', {
              detail: { enabled: params?.enabled, requestId },
            }),
          ),
        ),
        resolvedParams: params,
      };

  }
}

export function createMacroExecutionController(
  macro: MacroDefinition,
  callbacks: MacroExecutionCallbacks = {},
  options: CreateMacroExecutionControllerOptions = {},
): MacroExecutionController {
  const { steps } = macro;
  const total = steps.length;
  const autoPlay = options.autoPlay ?? true;

  let status: MacroExecutionStatus = 'idle';
  let currentStepIndex = 0;
  let stopRequested = false;
  let operationChain = Promise.resolve();
  const executionContext: MacroExecutionContext = {};

  const setStatus = (nextStatus: MacroExecutionStatus) => {
    if (status === nextStatus) return;
    status = nextStatus;
    callbacks.onStatusChange?.(status, currentStepIndex, total);
  };

  const executeSingleStep = async (
    index: number,
    applyDelay: boolean,
  ): Promise<void> => {
    const step = steps[index];
    if (!step) {
      return;
    }

    callbacks.onStepStart?.(step, index, total);

    try {
      const dispatchResult = await dispatchMacroStep(step, executionContext);
      updateMacroExecutionContext(
        step.action,
        executionContext,
        dispatchResult.detail,
        dispatchResult.resolvedParams,
      );
      callbacks.onStepComplete?.(step, index, total);
      currentStepIndex = index + 1;

      if (
        applyDelay &&
        step.delayAfterMs > 0 &&
        index < steps.length - 1 &&
        !stopRequested
      ) {
        await sleep(step.delayAfterMs);
      }
    } catch (error) {
      setStatus('error');
      callbacks.onError?.(error as Error, step, index);
      throw error;
    }
  };

  const completeMacro = () => {
    setStatus('completed');
    callbacks.onMacroComplete?.(macro);
  };

  const stop = () => {
    if (status === 'completed' || status === 'stopped' || status === 'error') {
      return;
    }
    stopRequested = true;
    setStatus('stopped');
    callbacks.onMacroStopped?.(macro, currentStepIndex, total);
  };

  const playInternal = async () => {
    if (status === 'completed' || status === 'stopped' || status === 'error') {
      return;
    }

    setStatus('running');
    while (currentStepIndex < total) {
      if (stopRequested) {
        return;
      }
      await executeSingleStep(currentStepIndex, true);
    }

    if (!stopRequested) {
      completeMacro();
    }
  };

  const start = async () => {
    if (status !== 'idle') {
      return;
    }

    if (total === 0) {
      completeMacro();
      return;
    }

    if (autoPlay) {
      await playInternal();
      return;
    }

    setStatus('paused');
  };

  const nextStep = () => {
    operationChain = operationChain.then(async () => {
      if (status !== 'paused') {
        return;
      }
      if (currentStepIndex >= total) {
        completeMacro();
        return;
      }

      await executeSingleStep(currentStepIndex, false);
      if (currentStepIndex >= total) {
        completeMacro();
      } else if (!stopRequested) {
        setStatus('paused');
      }
    });

    return operationChain;
  };

  const play = () => {
    operationChain = operationChain.then(async () => {
      if (status !== 'paused' && status !== 'running') {
        return;
      }
      await playInternal();
    });

    return operationChain;
  };

  return {
    start,
    nextStep,
    play,
    stop,
    getStatus: () => status,
    getCurrentStepIndex: () => currentStepIndex,
    isDone: () =>
      status === 'completed' || status === 'stopped' || status === 'error',
  };
}
