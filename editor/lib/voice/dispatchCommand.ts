import type {
  VoiceCommand,
  VoiceInput,
  ClarifyCommand,
  Shader,
  InputType,
} from './commandTypes';

export type DispatchResult =
  | { success: true; inputs: VoiceInput[] }
  | { success: false; clarify: ClarifyCommand };

let inputIdCounter = 0;

function generateId(): string {
  return `voice-input-${++inputIdCounter}`;
}

export function dispatchCommand(
  command: VoiceCommand,
  currentInputs: VoiceInput[],
): DispatchResult {
  const inputs = [...currentInputs];

  if (command.intent === 'CLARIFY') {
    return { success: false, clarify: command };
  }

  if (command.intent === 'ADD_INPUT') {
    const newInput: VoiceInput = {
      id: generateId(),
      type: command.inputType,
      shaders: [],
    };
    inputs.push(newInput);
    return { success: true, inputs };
  }

  if (command.intent === 'REMOVE_INPUT') {
    const idx = command.inputIndex - 1;
    if (idx < 0 || idx >= inputs.length) {
      return {
        success: false,
        clarify: {
          intent: 'CLARIFY',
          missing: ['inputIndex'],
          question: `Input ${command.inputIndex} does not exist. Choose 1..${inputs.length}.`,
        },
      };
    }
    inputs.splice(idx, 1);
    return { success: true, inputs };
  }

  if (command.intent === 'MOVE_INPUT') {
    const idx = command.inputIndex - 1;
    if (idx < 0 || idx >= inputs.length) {
      return {
        success: false,
        clarify: {
          intent: 'CLARIFY',
          missing: ['inputIndex'],
          question: `Input ${command.inputIndex} does not exist. Choose 1..${inputs.length}.`,
        },
      };
    }

    const steps = command.steps ?? 1;
    let newIdx: number;

    if (command.direction === 'UP') {
      newIdx = Math.max(0, idx - steps);
    } else {
      newIdx = Math.min(inputs.length - 1, idx + steps);
    }

    if (newIdx !== idx) {
      const [item] = inputs.splice(idx, 1);
      inputs.splice(newIdx, 0, item);
    }

    return { success: true, inputs };
  }

  if (command.intent === 'ADD_SHADER') {
    if (command.inputIndex == null) {
      return {
        success: false,
        clarify: {
          intent: 'CLARIFY',
          missing: ['inputIndex'],
          question: `Which input should receive the shader? Choose 1..${inputs.length}.`,
        },
      };
    }
    const idx = command.inputIndex - 1;
    if (idx < 0 || idx >= inputs.length) {
      return {
        success: false,
        clarify: {
          intent: 'CLARIFY',
          missing: ['inputIndex'],
          question: `Input ${command.inputIndex} does not exist. Choose 1..${inputs.length}.`,
        },
      };
    }

    if (!inputs[idx].shaders.includes(command.shader)) {
      inputs[idx] = {
        ...inputs[idx],
        shaders: [...inputs[idx].shaders, command.shader],
      };
    }

    return { success: true, inputs };
  }

  if (command.intent === 'REMOVE_SHADER') {
    if (command.inputIndex == null) {
      return {
        success: false,
        clarify: {
          intent: 'CLARIFY',
          missing: ['inputIndex'],
          question: `Which input should have the shader removed? Choose 1..${inputs.length}.`,
        },
      };
    }
    const idx = command.inputIndex - 1;
    if (idx < 0 || idx >= inputs.length) {
      return {
        success: false,
        clarify: {
          intent: 'CLARIFY',
          missing: ['inputIndex'],
          question: `Input ${command.inputIndex} does not exist. Choose 1..${inputs.length}.`,
        },
      };
    }

    inputs[idx] = {
      ...inputs[idx],
      shaders: inputs[idx].shaders.filter((s) => s !== command.shader),
    };

    return { success: true, inputs };
  }

  return { success: true, inputs };
}

export function resetIdCounter(): void {
  inputIdCounter = 0;
}
