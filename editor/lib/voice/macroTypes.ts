import type {
  InputType,
  Shader,
  Direction,
  VoiceCommand,
} from './commandTypes';

export type MacroActionParams = {
  inputType?: InputType;
  inputIndex?: number;
  shader?: Shader;
  direction?: Direction;
  steps?: number;
  layout?: string;
  color?: string;
  maxLines?: number;
  fontSize?: number;
  targetColor?: string;
  text?: string;
  textAlign?: 'left' | 'center' | 'right';
  mp4Name?: string;
  imageName?: string;
};

export type MacroStep = {
  action: MacroAction;
  params?: MacroActionParams;
  delayAfterMs: number;
};

export type MacroAction =
  | 'ADD_INPUT'
  | 'REMOVE_INPUT'
  | 'REMOVE_ALL_INPUTS'
  | 'MOVE_INPUT'
  | 'ADD_SHADER'
  | 'REMOVE_SHADER'
  | 'SELECT_INPUT'
  | 'DESELECT_INPUT'
  | 'NEXT_LAYOUT'
  | 'PREVIOUS_LAYOUT'
  | 'SET_LAYOUT'
  | 'SET_TEXT_COLOR'
  | 'SET_TEXT_MAX_LINES'
  | 'SET_TEXT_FONT_SIZE'
  | 'SET_TEXT';

export type MacroDefinition = {
  id: string;
  triggers: string[];
  description: string;
  steps: MacroStep[];
};

export type MacrosConfig = {
  macros: MacroDefinition[];
};

export type MacroState = {
  isListening: boolean;
  activeMacro: MacroDefinition | null;
  isExecuting: boolean;
  currentStepIndex: number;
};

export function macroStepToVoiceCommand(step: MacroStep): VoiceCommand | null {
  const { action, params } = step;

  switch (action) {
    case 'ADD_INPUT':
      if (params?.inputType) {
        return { intent: 'ADD_INPUT', inputType: params.inputType };
      }
      return null;

    case 'REMOVE_INPUT':
      if (params?.inputIndex !== undefined) {
        return { intent: 'REMOVE_INPUT', inputIndex: params.inputIndex };
      }
      return null;

    case 'MOVE_INPUT':
      if (params?.inputIndex !== undefined && params?.direction) {
        return {
          intent: 'MOVE_INPUT',
          inputIndex: params.inputIndex,
          direction: params.direction,
          steps: params.steps ?? 1,
        };
      }
      return null;

    case 'ADD_SHADER':
      if (params?.shader) {
        return {
          intent: 'ADD_SHADER',
          inputIndex: params.inputIndex ?? null,
          shader: params.shader,
          targetColor: params.targetColor,
        };
      }
      return null;

    case 'REMOVE_SHADER':
      if (params?.shader) {
        return {
          intent: 'REMOVE_SHADER',
          inputIndex: params.inputIndex ?? null,
          shader: params.shader,
        };
      }
      return null;

    case 'SELECT_INPUT':
      if (params?.inputIndex !== undefined) {
        return { intent: 'SELECT_INPUT', inputIndex: params.inputIndex };
      }
      return null;

    case 'DESELECT_INPUT':
      return { intent: 'DESELECT_INPUT' };

    case 'NEXT_LAYOUT':
      return { intent: 'NEXT_LAYOUT' };

    case 'PREVIOUS_LAYOUT':
      return { intent: 'PREVIOUS_LAYOUT' };

    case 'SET_TEXT_COLOR':
      if (params?.color) {
        return { intent: 'SET_TEXT_COLOR', color: params.color };
      }
      return null;

    case 'SET_TEXT_MAX_LINES':
      if (params?.maxLines !== undefined) {
        return { intent: 'SET_TEXT_MAX_LINES', maxLines: params.maxLines };
      }
      return null;

    case 'SET_TEXT_FONT_SIZE':
      if (params?.fontSize !== undefined) {
        return { intent: 'SET_TEXT_FONT_SIZE', fontSize: params.fontSize };
      }
      return null;

    default:
      return null;
  }
}
