import type { MacroDefinition, MacroStep, MacrosConfig } from './macroTypes';
import { macroStepToVoiceCommand } from './macroTypes';
import { normalize } from './normalize';
import macrosJson from './macros.json';

const macrosConfig: MacrosConfig = macrosJson as MacrosConfig;

export function findMatchingMacro(transcript: string): MacroDefinition | null {
  const normalized = normalize(transcript);

  for (const macro of macrosConfig.macros) {
    for (const trigger of macro.triggers) {
      const normalizedTrigger = normalize(trigger);
      if (
        normalized.includes(normalizedTrigger) ||
        normalizedTrigger.includes(normalized)
      ) {
        return macro;
      }
    }
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
  onError?: (error: Error, step: MacroStep, index: number) => void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeMacro(
  macro: MacroDefinition,
  callbacks: MacroExecutionCallbacks = {},
): Promise<void> {
  const { steps } = macro;
  const total = steps.length;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    try {
      callbacks.onStepStart?.(step, i, total);

      dispatchMacroStep(step);

      callbacks.onStepComplete?.(step, i, total);

      if (step.delayAfterMs > 0 && i < steps.length - 1) {
        await sleep(step.delayAfterMs);
      }
    } catch (error) {
      callbacks.onError?.(error as Error, step, i);
      throw error;
    }
  }

  callbacks.onMacroComplete?.(macro);
}

function dispatchMacroStep(step: MacroStep): void {
  const { action, params } = step;

  switch (action) {
    case 'ADD_INPUT':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:add-input', {
          detail: {
            inputType: params?.inputType,
            text: params?.text,
            textAlign: params?.textAlign,
            mp4FileName: params?.mp4Name,
            imageFileName: params?.imageName,
          },
        }),
      );
      break;

    case 'REMOVE_INPUT':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:remove-input', {
          detail: { inputIndex: params?.inputIndex },
        }),
      );
      break;

    case 'REMOVE_ALL_INPUTS':
      window.dispatchEvent(new CustomEvent('smelter:voice:remove-all-inputs'));
      break;

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
      break;

    case 'ADD_SHADER':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:add-shader', {
          detail: {
            inputIndex: params?.inputIndex,
            shader: params?.shader,
            targetColor: params?.targetColor,
          },
        }),
      );
      break;

    case 'REMOVE_SHADER':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:remove-shader', {
          detail: { inputIndex: params?.inputIndex, shader: params?.shader },
        }),
      );
      break;

    case 'SELECT_INPUT':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:select-input', {
          detail: { inputIndex: params?.inputIndex },
        }),
      );
      break;

    case 'DESELECT_INPUT':
      window.dispatchEvent(new CustomEvent('smelter:voice:deselect-input'));
      break;

    case 'NEXT_LAYOUT':
      window.dispatchEvent(new CustomEvent('smelter:voice:next-layout'));
      break;

    case 'PREVIOUS_LAYOUT':
      window.dispatchEvent(new CustomEvent('smelter:voice:previous-layout'));
      break;

    case 'SET_LAYOUT':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:set-layout', {
          detail: { layout: params?.layout },
        }),
      );
      break;

    case 'SET_TEXT_COLOR':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:set-text-color', {
          detail: { color: params?.color, inputIndex: params?.inputIndex },
        }),
      );
      break;

    case 'SET_TEXT_MAX_LINES':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:set-text-max-lines', {
          detail: {
            maxLines: params?.maxLines,
            inputIndex: params?.inputIndex,
          },
        }),
      );
      break;

    case 'SET_TEXT':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:set-text', {
          detail: { text: params?.text, inputIndex: params?.inputIndex },
        }),
      );
      break;
  }
}
